/* ============================================================
 * astro.js — 高中地理「地球的运动」天文/地理计算核心
 * 所有角度单位为「度」，时间为小时（0–24 小数）
 * 约定：黄赤交角 23.44°；地球坐标系 y 轴指向北极
 * ============================================================ */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;
  var TILT = 23.44;            // 黄赤交角
  var TROPIC = 23.44;          // 回归线纬度
  var POLAR = 90 - TILT;       // 极圈纬度 66.56

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function norm180(d) { d = norm360(d); return d > 180 ? d - 360 : d; }

  /* ---------- 日期 <-> 年积日 ---------- */
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInYear(y) { return isLeap(y) ? 366 : 365; }
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  /** 月/日 -> 年积日 N（从 1 起算） */
  function dateToN(month, day, year) {
    year = year || 2025;
    var n = 0;
    for (var m = 1; m < month; m++) {
      n += MONTH_DAYS[m - 1] + (m === 2 && isLeap(year) ? 1 : 0);
    }
    return n + day;
  }

  /** 年积日 N -> {month, day} */
  function nToDate(N, year) {
    year = year || 2025;
    var left = Math.round(N), m = 1;
    for (; m <= 12; m++) {
      var d = MONTH_DAYS[m - 1] + (m === 2 && isLeap(year) ? 1 : 0);
      if (left <= d) break;
      left -= d;
    }
    return { month: m, day: left };
  }

  /** 今天的年积日（按真实年份） */
  function todayN(now) {
    now = now || new Date();
    var start = new Date(now.getFullYear(), 0, 1);
    return Math.floor((now - start) / 86400000) + 1;
  }

  /* ---------- 太阳直射点 ---------- */
  /** 太阳赤纬（≈直射点纬度），N 为年积日 */
  function declination(N) {
    return TILT * Math.sin((360 / 365) * (284 + N) * DEG);
  }

  /** 太阳直射点经度：UTC 时刻 h 时，直射点经度 = 180° − 15°·h */
  function subsolarLon(utcHours) {
    return norm180(180 - 15 * utcHours);
  }

  /** 直射点坐标 */
  function subsolarPoint(N, utcHours) {
    return { lat: declination(N), lon: subsolarLon(utcHours) };
  }

  /* ---------- 观测点太阳位置 ---------- */
  /**
   * 观测点太阳状态
   * @param {number} N 年积日
   * @param {number} utcHours UTC 时刻（0–24）
   * @param {number} lat 观测点纬度
   * @param {number} lon 观测点经度
   * @returns {{decl,subsolarLon,hourAngle,alt,az,lst,utc}} 高度角、方位角(0=北,90=东)
   */
  function sunState(N, utcHours, lat, lon) {
    var decl = declination(N);
    var ls = subsolarLon(utcHours);
    var h = norm180(lon - ls);                     // 时角：上午为负，下午为正
    var phi = lat * DEG, dd = decl * DEG, hh = h * DEG;
    var sinAlt = Math.sin(phi) * Math.sin(dd) +
                 Math.cos(phi) * Math.cos(dd) * Math.cos(hh);
    var alt = Math.asin(clamp(sinAlt, -1, 1)) * RAD;
    var az = Math.atan2(
      -Math.cos(dd) * Math.sin(hh),
      Math.sin(dd) * Math.cos(phi) - Math.cos(dd) * Math.sin(phi) * Math.cos(hh)
    ) * RAD;
    return {
      decl: decl,
      subsolarLon: ls,
      hourAngle: h,
      alt: alt,
      az: norm360(az),
      lst: utcHours + lon / 15,                    // 地方太阳时
      utc: utcHours
    };
  }

  /* ---------- 昼夜长短 / 日出日落 / 正午太阳高度 ---------- */
  /**
   * @returns {{hours,sunriseLST,sunsetLST,noonAlt,polarDay,polarNight}}
   *   sunrise/sunset 为地方太阳时；极昼极夜时 hours 为 24/0
   */
  function dayInfo(lat, N) {
    var decl = declination(N);
    var phi = clamp(lat, -89.9, 89.9) * DEG, dd = decl * DEG;
    var x = -Math.tan(phi) * Math.tan(dd);
    var hours, sunriseLST, sunsetLST, polarDay = false, polarNight = false;
    if (x <= -1) { hours = 24; polarDay = true; }
    else if (x >= 1) { hours = 0; polarNight = true; }
    else {
      var H0 = Math.acos(x) * RAD;                 // 半昼弧（度）
      hours = 2 * H0 / 15;
      sunriseLST = 12 - H0 / 15;
      sunsetLST = 12 + H0 / 15;
    }
    var noonAlt = 90 - Math.abs(lat - decl);
    return {
      hours: hours,
      sunriseLST: sunriseLST,
      sunsetLST: sunsetLST,
      noonAlt: noonAlt,
      polarDay: polarDay,
      polarNight: polarNight,
      decl: decl
    };
  }

  /** 日出/日落对应的 UTC 时刻 */
  function sunriseUTC(lat, N, lon) {
    var info = dayInfo(lat, N);
    if (info.polarDay || info.polarNight) return null;
    return { sunrise: info.sunriseLST - lon / 15, sunset: info.sunsetLST - lon / 15 };
  }

  /** 正午太阳高度（教材公式 H = 90° − |φ − δ|） */
  function noonAltitude(lat, N) {
    return 90 - Math.abs(lat - declination(N));
  }

  /* ---------- 五带 ---------- */
  function fiveZone(lat) {
    var a = Math.abs(lat);
    if (a < TROPIC) return '热带';
    if (a < POLAR) return lat > 0 ? '北温带' : '南温带';
    return lat > 0 ? '北寒带' : '南寒带';
  }

  /* ---------- 24 节气（近似） ---------- */
  var TERMS = [
    [6, '小寒'], [20, '大寒'], [35, '立春'], [50, '雨水'],
    [65, '惊蛰'], [80, '春分'], [95, '清明'], [110, '谷雨'],
    [126, '立夏'], [141, '小满'], [157, '芒种'], [172, '夏至'],
    [188, '小暑'], [204, '大暑'], [220, '立秋'], [235, '处暑'],
    [251, '白露'], [266, '秋分'], [281, '寒露'], [296, '霜降'],
    [311, '立冬'], [326, '小雪'], [341, '大雪'], [356, '冬至']
  ];

  /** 最近节气名（相差 ≤2 天才返回） */
  function solarTerm(N) {
    var best = null, bestD = 99;
    for (var i = 0; i < TERMS.length; i++) {
      var diff = Math.abs(TERMS[i][0] - N);
      if (diff > 183) diff = 365 - diff;
      if (diff < bestD) { bestD = diff; best = TERMS[i][1]; }
    }
    return bestD <= 2 ? best : null;
  }

  /* ---------- 采样：一天 24h 的太阳高度/方位（供 M4 绘图） ---------- */
  function sampleDay(lat, lon, N, stepMinutes) {
    stepMinutes = stepMinutes || 10;
    var out = [];
    for (var m = 0; m < 24 * 60; m += stepMinutes) {
      var utc = m / 60;
      var s = sunState(N, utc, lat, lon);
      out.push({ utc: utc, alt: s.alt, az: s.az });
    }
    return out;
  }

  /* ---------- 坐标系转换 ---------- */
  /** 经纬度 -> three.js 单位球坐标（与 SphereGeometry 等距圆柱贴图对齐） */
  function latLonToVec3(lat, lon, r) {
    r = r || 1;
    var phi = lat * DEG, lam = lon * DEG;
    return {
      x: r * Math.cos(phi) * Math.cos(lam),
      y: r * Math.sin(phi),
      z: -r * Math.cos(phi) * Math.sin(lam)
    };
  }

  /** UTC 小时 -> "HH:MM" */
  function fmtHours(h) {
    if (h === null || h === undefined || isNaN(h)) return '—';
    h = ((h % 24) + 24) % 24;
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /** 小时差 -> "x小时y分" */
  function fmtDuration(hours) {
    var h = Math.floor(hours), m = Math.round((hours - h) * 60);
    if (m === 60) { m = 0; h += 1; }
    return h + '小时' + (m ? m + '分' : '');
  }

  global.Astro = {
    DEG: DEG, RAD: RAD, TILT: TILT, TROPIC: TROPIC, POLAR: POLAR,
    clamp: clamp, norm360: norm360, norm180: norm180,
    dateToN: dateToN, nToDate: nToDate, todayN: todayN,
    isLeap: isLeap, daysInYear: daysInYear,
    declination: declination,
    subsolarLon: subsolarLon,
    subsolarPoint: subsolarPoint,
    sunState: sunState,
    dayInfo: dayInfo,
    sunriseUTC: sunriseUTC,
    noonAltitude: noonAltitude,
    fiveZone: fiveZone,
    solarTerm: solarTerm,
    sampleDay: sampleDay,
    latLonToVec3: latLonToVec3,
    fmtHours: fmtHours,
    fmtDuration: fmtDuration
  };
})(typeof window !== 'undefined' ? window : globalThis);
