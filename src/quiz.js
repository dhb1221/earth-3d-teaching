/* ============================================================
 * quiz.js — 高中地理「地球的运动」实时题库
 * API：window.Quiz.generate(state, astro) -> 4 道题
 *      每题 { q, options[4], answer(正确项索引), explain(一句话解析) }
 *
 * 覆盖考点：太阳直射点位置 / 昼夜长短 / 正午太阳高度 /
 *          极昼极夜 / 日出方位 / 地方时·时区
 * 全部由 state 现算，不写死；同一 state 必得同一套题（种子由 state 派生），
 * 改日期、时刻、观测点或时区就会换一批题。
 * 依赖：window.Astro（只调用其公开函数）
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 小工具 ---------------- */
  function num(v, d) {
    v = +v;
    return isFinite(v) ? v : d;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function norm180(d) { d = norm360(d); return d > 180 ? d - 360 : d; }

  var DIRS = ['正北方', '东北方', '正东方', '东南方', '正南方', '西南方', '正西方', '西北方'];

  /** 方位角(0=北,90=东) -> 八方位中文 */
  function azName(az) {
    return DIRS[Math.round(norm360(az) / 45) % 8];
  }

  /** 纬度 -> "23.4°N" / "0°（赤道）" */
  function latStr(v) {
    var a = Math.abs(v);
    if (a < 0.05) return '0°（赤道）';
    return a.toFixed(1) + '°' + (v > 0 ? 'N' : 'S');
  }

  /** 经度 -> "116.4°E" / "0°经线" / "180°经线" */
  function lonStr(v) {
    v = norm180(v);
    var a = Math.abs(v);
    if (a < 0.5) return '0°经线';
    if (a > 179.5) return '180°经线';
    var s = a.toFixed(1);
    if (/\.0$/.test(s)) s = s.slice(0, -2);
    return s + '°' + (v > 0 ? 'E' : 'W');
  }

  /** 小时 -> "HH:MM"（优先用 Astro.fmtHours） */
  function fmtHM(h, A) {
    if (A && typeof A.fmtHours === 'function') return A.fmtHours(h);
    h = ((h % 24) + 24) % 24;
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /** 小时数 -> "13小时42分"（优先用 Astro.fmtDuration） */
  function fmtDur(hours, A) {
    if (A && typeof A.fmtDuration === 'function') return A.fmtDuration(hours);
    var h = Math.floor(hours), m = Math.round((hours - h) * 60);
    if (m === 60) { m = 0; h += 1; }
    return h + '小时' + (m ? m + '分' : '');
  }

  /** 时区 -> 中文名称 */
  function tzText(tz) {
    if (tz === 8) return '北京时间';
    if (tz === 0) return '世界时';
    return (tz > 0 ? '东' + tz + '区时间' : '西' + (-tz) + '区时间');
  }

  /** 年积日 -> "6月22日" */
  function dateStr(A, N) {
    try {
      var d = A.nToDate(N);
      return d.month + '月' + d.day + '日';
    } catch (e) {
      return '第 ' + N + ' 天';
    }
  }

  /* ---------------- 确定性随机（同 state 同题） ---------------- */
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------------- 组题：正确项 + 干扰项 -> 4 选 1 ---------------- */
  function pack(stem, correct, distractors) {
    var opts = [correct];
    var i, d;
    for (i = 0; i < distractors.length && opts.length < 4; i++) {
      d = distractors[i];
      if (typeof d !== 'string') continue;
      d = d.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (!d || opts.indexOf(d) >= 0) continue;
      opts.push(d);
    }
    var pad = ['以上选项都不正确', '条件不足，无法判断'];
    for (i = 0; i < pad.length && opts.length < 4; i++) {
      if (opts.indexOf(pad[i]) < 0) opts.push(pad[i]);
    }
    return { stem: stem, options: opts, correct: correct };
  }

  function finalize(raw, rng) {
    var p = pack(raw.stem, raw.correct, raw.distractors || []);
    var opts = shuffle(p.options.slice(), rng);
    return {
      q: p.stem,
      options: opts,
      answer: opts.indexOf(p.correct),
      explain: raw.explain || ''
    };
  }

  /* =================================================================
   * ① 太阳直射点位置
   * ================================================================= */
  function buildSubsolar(ctx, A) {
    var decl = ctx.decl;
    var lonS = ctx.lonS;
    var correct = latStr(decl) + '，' + lonStr(lonS);
    var dist = [
      latStr(-decl) + '，' + lonStr(lonS),                     // 南北搞反
      latStr(decl) + '，' + lonStr(lonS + 180),                // 经度差 180°
      latStr(decl) + '，' + lonStr(lonS + 90),                 // 经度差 90°
      latStr(90 - Math.abs(decl)) + '，' + lonStr(lonS),       // 把余纬当直射纬度
      latStr(decl >= 0 ? -23.44 : 23.44) + '，' + lonStr(lonS), // 把另一条回归线当直射点
      latStr(decl) + '，' + lonStr(ctx.lon)                    // 把观测点经度当直射经度
    ];
    return {
      stem: '现在是 ' + ctx.date + ' ' + fmtHM(ctx.utc, A) + '（世界时），此时太阳直射点位于？',
      correct: correct,
      distractors: dist,
      explain: '直射点纬度＝太阳赤纬≈' + decl.toFixed(1) + '°；经度＝180°−15°×' +
        ctx.utc.toFixed(1) + '＝' + lonStr(lonS) + '，该经线此刻地方时为 12:00。'
    };
  }

  /* =================================================================
   * ② 昼夜长短 + 极昼极夜（两问合一，保证每次都能考到）
   * ================================================================= */
  function buildDayLength(ctx, A) {
    var info = ctx.info;
    var h = info.hours;
    var decl = ctx.decl;
    var lim = 90 - Math.abs(decl);
    var hemi = decl >= 0 ? '北' : '南';

    function dayLabel(v) {
      if (v >= 23.99) return '24 小时（极昼）';
      if (v <= 0.01) return '0 小时（极夜）';
      if (Math.abs(v - 12) < 0.02) return '12 小时（昼夜等长）';
      return fmtDur(v, A);
    }
    var limTxt = latStr(decl >= 0 ? lim : -lim);
    var limTxtWrong = latStr(decl >= 0 ? -lim : lim);
    function pair(dayV, limStr) {
      return dayLabel(dayV) + '；极昼最低纬度 ' + limStr;
    }

    var correct = pair(h, limTxt);
    var dist = [
      pair(12, limTxt),                                                   // 误以为昼夜平分
      pair(24 - h, limTxt),                                               // 用了另一半球
      pair(h, latStr(decl >= 0 ? 23.44 : -23.44)),                        // 把回归线当极圈
      pair(h, limTxtWrong),                                                // 南北极圈搞反
      pair(clamp(h + 2, 0.5, 23.5), limTxt),
      pair(24, limTxt)
    ];

    var ex;
    if (info.polarDay) {
      ex = '太阳直射 ' + latStr(decl) + '，90°−|δ|＝' + lim.toFixed(1) + '°；该地已在极昼范围内，太阳整日不落，昼长 24 小时。';
    } else if (info.polarNight) {
      ex = '太阳直射 ' + latStr(decl) + '，90°−|δ|＝' + lim.toFixed(1) + '°；该地出现极夜，太阳整日不升，昼长为 0。';
    } else {
      ex = '太阳直射 ' + latStr(decl) + '，由 cos H₀＝−tanφ·tanδ 得昼长＝' + fmtDur(h, A) +
        '（' + h.toFixed(1) + ' 小时）；出现极昼的最低纬度＝90°−|δ|＝' + lim.toFixed(1) + '°，即 ' +
        limTxt + (hemi === '北' ? ' 及以北' : ' 及以南') + '。';
    }

    return {
      stem: '观测点位于 ' + latStr(ctx.lat) + '，' + ctx.date +
        ' 这一天：该地的昼长约为 ＿＿，当日出现极昼的最低纬度是 ＿＿。',
      correct: correct,
      distractors: dist,
      explain: ex
    };
  }

  /* =================================================================
   * ③ 正午太阳高度
   * ================================================================= */
  function buildNoonAlt(ctx, A) {
    var lat = ctx.lat;
    var decl = ctx.decl;
    var H = 90 - Math.abs(lat - decl);
    var i, v;

    var correct;
    if (H <= 0.05) correct = '0°（极夜，太阳整日在地平线以下）';
    else correct = H.toFixed(1) + '°';

    var vals = [
      90 - Math.abs(lat + decl),          // δ 符号搞错
      90 - lat - decl,                    // 展开绝对值时符号错
      90 - Math.abs(lat) - Math.abs(decl),
      Math.abs(lat - decl),               // 只算纬度差
      90 - Math.abs(lat),                 // 漏掉 δ
      H + 23.44,
      Math.abs(H - 23.44),
      H + 10,
      H - 10,
      H + 20,
      H - 20,
      90 - H,
      45
    ];
    var dist = [];
    for (i = 0; i < vals.length; i++) {
      v = vals[i];
      if (!isFinite(v)) continue;
      if (v < 0.5 || v > 90) continue;
      if (H > 0.05 && Math.abs(v - H) < 0.6) continue;
      dist.push(v.toFixed(1) + '°');
    }

    var where;
    if (Math.abs(lat - decl) < 0.15) where = '正上方（天顶）';
    else where = lat > decl ? '正南方' : '正北方';

    var ex;
    if (H <= 0.05) {
      ex = 'H＝90°−|φ−δ|＝' + H.toFixed(1) + '°＜0，正午太阳仍在地平线以下，该地出现极夜。';
    } else {
      ex = 'H＝90°−|φ−δ|＝90°−|' + lat.toFixed(1) + '°−(' + decl.toFixed(1) + '°)|＝' + H.toFixed(1) +
        '°；正午太阳位于' + where + '。';
    }

    return {
      stem: '观测点位于 ' + latStr(lat) + '，' + ctx.date + '（当日太阳直射 ' + latStr(decl) + '），该地正午太阳高度约为？',
      correct: correct,
      distractors: dist,
      explain: ex
    };
  }

  /* =================================================================
   * ④ 日出方位 + 地方时·时区
   *    有日出日落时：日出方位 + 对应区时
   *    极昼/极夜时：太阳最高时方位 + 对应区时
   * ================================================================= */
  function buildRiseOrLocal(ctx, A) {
    var tzTx = tzText(ctx.tz);
    var info = ctx.info;
    var lat = ctx.lat;
    var decl = ctx.decl;
    var lon = ctx.lon;
    var tz = ctx.tz;

    /* —— 极昼 / 极夜 —— */
    if (info.polarDay || info.polarNight) {
      var noonZone = 12 - lon / 15 + tz;
      var sunDir = lat > decl ? '正南方' : '正北方';
      var other = sunDir === '正南方' ? '正北方' : '正南方';
      var c2 = sunDir + '，' + tzText2(tzTx, fmtHM(noonZone, A));
      var d2 = [
        other + '，' + tzText2(tzTx, fmtHM(noonZone, A)),
        sunDir + '，' + tzText2(tzTx, fmtHM(noonZone + 2, A)),
        sunDir + '，' + tzText2(tzTx, fmtHM(noonZone - 2, A)),
        '正东方，' + tzText2(tzTx, fmtHM(noonZone, A)),
        sunDir + '，' + tzText2(tzTx, fmtHM(noonZone + 1, A))
      ];
      return {
        stem: '观测点位于 ' + latStr(lat) + '，' + ctx.date + ' 该地出现' +
          (info.polarDay ? '极昼' : '极夜') + '。当地太阳最高时（地方太阳时 12:00），太阳位于该地的 ＿＿ 方向，此时' +
          tzTx + '约为 ＿＿。',
        correct: c2,
        distractors: d2,
        explain: '该地当日' + (info.polarDay ? '极昼，太阳整日不落' : '极夜，太阳整日在地平线以下') +
          '；正午太阳位于' + sunDir + '（观测点纬度 ' + latStr(lat) + (lat > decl ? ' 高于' : ' 低于') +
          '直射点纬度 ' + latStr(decl) + '）；地方时 12:00 对应世界时 ' + fmtHM(12 - lon / 15, A) +
          '，换算成' + tzTx + '为 ' + fmtHM(noonZone, A) + '。'
      };
    }

    /* —— 有日出：日出方位 + 区时 —— */
    var ru = A.sunriseUTC(lat, ctx.N, lon);
    if (!ru) ru = { sunrise: 12 - lon / 15, sunset: 12 - lon / 15 };

    var s0 = A.sunState(ctx.N, ru.sunrise, lat, lon);
    var az = norm360(s0.az);
    var azT = azName(az);
    var zoneT = ru.sunrise + tz;

    var correct = azT + '，' + tzText2(tzTx, fmtHM(zoneT, A));
    var dist = [
      azName(az + 45) + '，' + tzText2(tzTx, fmtHM(zoneT, A)),
      azName(az - 45) + '，' + tzText2(tzTx, fmtHM(zoneT - 1, A)),
      azName(az + 180) + '，' + tzText2(tzTx, fmtHM(zoneT, A)),
      azT + '，' + tzText2(tzTx, fmtHM(zoneT + 2, A)),
      azName(az + 90) + '，' + tzText2(tzTx, fmtHM(zoneT + 1, A))
    ];

    var ex = '当日太阳直射 ' + latStr(decl) + '，' + ctx.date + ' 该地日出方位约 ' + az.toFixed(0) + '°（' + azT +
      '），日出地方太阳时 ' + fmtHM(info.sunriseLST, A) + '；地方时与' + tzTx + '相差 ' +
      ((lon / 15 - tz) >= 0 ? '+' : '') + (lon / 15 - tz).toFixed(1) + ' 小时，故日出对应' +
      tzTx + ' ' + fmtHM(zoneT, A) + '。';

    return {
      stem: '观测点位于 ' + latStr(lat) + '（' + lonStr(lon) + '），' + ctx.date +
        ' 这天该地日出时，太阳位于 ＿＿ 方向，此时' + tzTx + '约为 ＿＿。',
      correct: correct,
      distractors: dist,
      explain: ex
    };
  }

  /* 选项里的时区标注：'（北京时间 05:12）' */
  function tzText2(tzTx, hm) {
    return '（' + tzTx + ' ' + hm + '）';
  }

  /* =================================================================
   * 入口
   * ================================================================= */
  function generate(state, astro) {
    var A = astro || global.Astro;
    if (!A) return [];
    var S = state || {};

    var N = clamp(Math.round(num(S.dayOfYear, 172)), 1, 365);
    var utc = num(S.utcHours, 4);
    utc = ((utc % 24) + 24) % 24;
    var lat = clamp(num(S.observerLat, 40), -90, 90);
    var lon = norm180(num(S.observerLon, 116.4));
    var tz = clamp(Math.round(num(S.tz, 8)), -12, 14);

    var seedStr = N + '|' + Math.round(utc * 60) + '|' + Math.round(lat * 10) + '|' +
      Math.round(lon) + '|' + tz;
    var rng = mulberry32(hashStr(seedStr));

    var ctx = {
      N: N,
      utc: utc,
      lat: lat,
      lon: lon,
      tz: tz,
      date: dateStr(A, N),
      decl: A.declination(N),
      lonS: A.subsolarLon(utc),
      info: A.dayInfo(lat, N),
      rng: rng
    };

    var raws = [
      buildSubsolar(ctx, A),
      buildDayLength(ctx, A),
      buildNoonAlt(ctx, A),
      buildRiseOrLocal(ctx, A)
    ];

    var out = [];
    for (var i = 0; i < raws.length; i++) {
      if (raws[i]) out.push(finalize(raws[i], rng));
    }
    return out;
  }

  global.Quiz = { generate: generate };

})(typeof window !== 'undefined' ? window : globalThis);
