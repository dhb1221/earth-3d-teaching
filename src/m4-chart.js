/* ============================================================
 * m4-chart.js — M4 太阳视运动平面图（canvas 2D 极坐标：方位-高度）
 * 依赖：window.Astro（天文计算）；配色取 window.H.PALETTE（缺省用内置兜底）
 * API：window.MODELS.M4 = function createM4(ctx) -> { draw, resize, dispose }
 * 说明：只画 canvas 2D；不缓存跨帧状态（save/restore）；devicePixelRatio 由外部处理。
 * 映射：圆心=天顶，外圈=地平线；角度=方位角(北在上、顺时针)；
 *       半径 r = (90 - alt) / 90 * R。
 * ============================================================ */
(function (global) {
  'use strict';

  var FONT = '"PingFang SC","Microsoft YaHei",sans-serif';
  var DEG = Math.PI / 180;
  var DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  var FALLBACK = {
    bg: '#05070f',
    accent: '#4ea1ff',
    warm: '#ff8a3d',
    sun: '#ffd36b',
    grid: 'rgba(180,205,255,0.22)',
    text: '#dbe6ff',
    dim: 'rgba(219,230,255,0.55)',
    day: '#ffd36b',
    night: '#2b3a63',
    terminator: '#ff7a2f'
  };

  function num(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v : d;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function palette() {
    var h = global.H;
    return (h && h.PALETTE) ? h.PALETTE : FALLBACK;
  }
  function setFont(g, size, bold) {
    g.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
  }
  function haloText(g, text, x, y, color, size, align, bold) {
    setFont(g, size, bold);
    g.textAlign = align || 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(5,7,15,0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }
  function dirName(az) {
    var a = ((az % 360) + 360) % 360;
    return DIR8[Math.round(a / 45) % 8];
  }
  function latLabel(lat) {
    var a = Math.abs(lat);
    if (a < 0.05) return '0.0°';
    return a.toFixed(1) + '°' + (lat > 0 ? 'N' : 'S');
  }
  function strokePolyline(g, pts) {
    if (!pts || pts.length < 2) return;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
  }

  window.MODELS = window.MODELS || {};
  window.MODELS.M4 = function createM4(ctx) {
    return {
      draw: function (c2d, width, height, state, astro) {
        var A = astro || global.Astro;
        if (!c2d || !A || !(width > 1) || !(height > 1)) return;

        var P = palette();
        var S = state || {};
        var N = clamp(Math.round(num(S.dayOfYear, 172)), 1, 365);
        var utc = num(S.utcHours, 0);
        var lat = clamp(num(S.observerLat, 40), -90, 90);
        var lon = num(S.observerLon, 116.4);
        var tz = num(S.tz, 8);

        var w = width, h = height;
        var R = Math.min(w, h) * 0.36;
        var cx = w / 2, cy = h / 2;

        var info = A.dayInfo(lat, N);
        var now = A.sunState(N, utc, lat, lon);
        var dateTxt;
        try {
          var dd = A.nToDate(N);
          dateTxt = dd.month + '月' + dd.day + '日';
        } catch (e) {
          dateTxt = '第' + N + '天';
        }

        /* 极坐标 -> 屏幕坐标（az 方位角，alt 高度角） */
        function ptOf(alt, az) {
          var r = (90 - alt) / 90 * R;
          var a = az * DEG;
          return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a), r: r };
        }

        c2d.save();
        c2d.clearRect(0, 0, w, h);
        c2d.fillStyle = P.bg;
        c2d.fillRect(0, 0, w, h);
        c2d.setLineDash([]);
        c2d.lineCap = 'round';

        /* ---------- 1. 天区底色（圆内） ---------- */
        c2d.beginPath();
        c2d.arc(cx, cy, R, 0, Math.PI * 2);
        c2d.fillStyle = 'rgba(12,20,42,0.72)';
        c2d.fill();

        /* ---------- 2. 方位辐条（每 30°） ---------- */
        var k, ang, a0, a1;
        for (k = 0; k < 12; k++) {
          ang = k * 30 * DEG;
          c2d.beginPath();
          c2d.moveTo(cx, cy);
          c2d.lineTo(cx + R * Math.sin(ang), cy - R * Math.cos(ang));
          c2d.strokeStyle = (k % 3 === 0) ? 'rgba(180,205,255,0.20)' : 'rgba(180,205,255,0.09)';
          c2d.lineWidth = 1;
          c2d.stroke();
        }

        /* ---------- 3. 高度圈 30° / 60° ---------- */
        c2d.setLineDash([4, 6]);
        c2d.strokeStyle = P.grid;
        c2d.lineWidth = 1;
        for (k = 1; k <= 2; k++) {
          var rAlt = (k * 30) / 90 * R; /* 30° -> 2R/3, 60° -> R/3 */
          c2d.beginPath();
          c2d.arc(cx, cy, rAlt, 0, Math.PI * 2);
          c2d.stroke();
        }
        c2d.setLineDash([]);

        /* ---------- 4. 地平圈 ---------- */
        c2d.beginPath();
        c2d.arc(cx, cy, R, 0, Math.PI * 2);
        c2d.strokeStyle = 'rgba(120,160,255,0.62)';
        c2d.lineWidth = 1.6;
        c2d.stroke();

        /* 方位刻度（每 30°，四正方向加长） */
        for (k = 0; k < 12; k++) {
          ang = k * 30 * DEG;
          var major = (k % 3 === 0);
          var len = major ? 11 : 6;
          c2d.beginPath();
          c2d.moveTo(cx + R * Math.sin(ang), cy - R * Math.cos(ang));
          c2d.lineTo(cx + (R - len) * Math.sin(ang), cy - (R - len) * Math.cos(ang));
          c2d.strokeStyle = major ? 'rgba(219,230,255,0.75)' : 'rgba(180,205,255,0.35)';
          c2d.lineWidth = major ? 1.8 : 1;
          c2d.stroke();
        }

        /* ---------- 5. 当日太阳轨迹 ---------- */
        var samples = A.sampleDay(lat, lon, N, 10);
        var runs = [];
        var cur = null, prevP = null;
        for (k = 0; k < samples.length; k++) {
          var sp = samples[k];
          var isDay = sp.alt > 0;
          var p = ptOf(sp.alt, sp.az);
          if (!cur || cur.day !== isDay) {
            cur = { day: isDay, pts: [] };
            if (prevP) cur.pts.push(prevP);
            runs.push(cur);
          }
          cur.pts.push(p);
          prevP = p;
        }

        var i, j;
        /* 先画地平线以下（淡虚线，越远越淡；限制在略大于地平圈的范围） */
        for (i = 0; i < runs.length; i++) {
          if (runs[i].day) continue;
          var npts = runs[i].pts;
          c2d.save();
          c2d.beginPath();
          c2d.arc(cx, cy, R * 1.42, 0, Math.PI * 2);
          c2d.clip();
          c2d.setLineDash([4, 5]);
          c2d.lineWidth = 1.2;
          for (j = 1; j < npts.length; j++) {
            var rr = (npts[j].r + npts[j - 1].r) / 2;
            var fade = clamp(1 - (rr - R) / (0.55 * R), 0.16, 1);
            c2d.strokeStyle = 'rgba(255,211,107,' + (0.42 * fade).toFixed(3) + ')';
            c2d.beginPath();
            c2d.moveTo(npts[j - 1].x, npts[j - 1].y);
            c2d.lineTo(npts[j].x, npts[j].y);
            c2d.stroke();
          }
          c2d.restore();
        }
        c2d.setLineDash([]);
        for (i = 0; i < runs.length; i++) {
          if (!runs[i].day) continue;
          c2d.strokeStyle = P.day;
          c2d.lineWidth = 2.4;
          c2d.shadowColor = 'rgba(255,211,107,0.55)';
          c2d.shadowBlur = 10;
          strokePolyline(c2d, runs[i].pts);
          c2d.shadowBlur = 0;
        }

        /* ---------- 6. 日出 / 日落 / 正午 / 当前太阳 ---------- */
        function pointLabel(text, p, outDist, color, size) {
          var dx = p.x - cx, dy = p.y - cy;
          var dl = Math.sqrt(dx * dx + dy * dy) || 1;
          var lx = clamp(p.x + dx / dl * outDist, 44, w - 44);
          var ly = clamp(p.y + dy / dl * outDist, 46, h - 46);
          haloText(c2d, text, lx, ly, color, size || 11, 'center', true);
        }

        if (!info.polarDay && !info.polarNight) {
          var sr = null;
          try { sr = A.sunriseUTC(lat, N, lon); } catch (e2) { sr = null; }
          if (sr) {
            var riseS = A.sunState(N, sr.sunrise, lat, lon);
            var setS = A.sunState(N, sr.sunset, lat, lon);
            var rp = ptOf(0, riseS.az);
            var sp2 = ptOf(0, setS.az);
            /* 地平圈上的日出/日落标记 */
            c2d.fillStyle = 'rgba(255,211,107,0.95)';
            c2d.beginPath();
            c2d.arc(rp.x, rp.y, 3.2, 0, Math.PI * 2);
            c2d.fill();
            c2d.beginPath();
            c2d.arc(sp2.x, sp2.y, 3.2, 0, Math.PI * 2);
            c2d.fill();
            pointLabel('日出 ' + dirName(riseS.az) + ' ' + A.fmtHours(info.sunriseLST), rp, 20, '#ffd98a', 11);
            pointLabel('日落 ' + dirName(setS.az) + ' ' + A.fmtHours(info.sunsetLST), sp2, 20, '#ffb066', 11);
          }
        }

        /* 正午点 */
        var noonS = A.sunState(N, 12 - lon / 15, lat, lon);
        if (info.noonAlt > 0) {
          var np = ptOf(noonS.alt, noonS.az);
          c2d.fillStyle = '#fff4cf';
          c2d.beginPath();
          c2d.arc(np.x, np.y, 3.4, 0, Math.PI * 2);
          c2d.fill();
          c2d.strokeStyle = 'rgba(255,244,207,0.55)';
          c2d.lineWidth = 1;
          c2d.beginPath();
          c2d.arc(np.x, np.y, 6.5, 0, Math.PI * 2);
          c2d.stroke();
          pointLabel('正午 ' + info.noonAlt.toFixed(1) + '°', np, 22, '#fff4cf', 11);
        } else {
          haloText(c2d, '极夜 · 太阳整日不升', cx, cy + R * 0.42, '#9fb4e6', 12, 'center', true);
        }
        if (info.polarDay) {
          haloText(c2d, '极昼 · 太阳整日不落', cx, cy + R * 0.42, '#ffd98a', 12, 'center', true);
        }

        /* 当前时刻：天顶连线 + 呼吸光点 */
        var cp = ptOf(now.alt, now.az);
        c2d.setLineDash([3, 4]);
        c2d.strokeStyle = 'rgba(78,161,255,0.45)';
        c2d.lineWidth = 1;
        c2d.beginPath();
        c2d.moveTo(cx, cy);
        c2d.lineTo(cp.x, cp.y);
        c2d.stroke();
        c2d.setLineDash([]);

        var pulse = 1 + 0.28 * Math.sin(Date.now() / 1000 * 3.2);
        var glowR = 15 * pulse * (now.alt > 0 ? 1 : 0.62);
        var grad = c2d.createRadialGradient(cp.x, cp.y, 1, cp.x, cp.y, glowR);
        grad.addColorStop(0, 'rgba(255,244,200,0.95)');
        grad.addColorStop(0.42, 'rgba(255,211,107,0.55)');
        grad.addColorStop(1, 'rgba(255,211,107,0)');
        c2d.fillStyle = grad;
        c2d.beginPath();
        c2d.arc(cp.x, cp.y, glowR, 0, Math.PI * 2);
        c2d.fill();
        c2d.fillStyle = now.alt > 0 ? '#fff8e0' : 'rgba(255,211,107,0.55)';
        c2d.beginPath();
        c2d.arc(cp.x, cp.y, 3.6, 0, Math.PI * 2);
        c2d.fill();

        /* ---------- 7. 标签：N/E/S/W、天顶、高度圈、地平线 ---------- */
        var card = [
          { t: 'N', a: 0 }, { t: 'E', a: 90 }, { t: 'S', a: 180 }, { t: 'W', a: 270 }
        ];
        for (k = 0; k < card.length; k++) {
          var ca = card[k].a * DEG;
          haloText(c2d, card[k].t,
            cx + (R - 15) * Math.sin(ca), cy - (R - 15) * Math.cos(ca),
            P.text, 13, 'center', true);
        }
        /* 30°/60° 高度圈标注 */
        haloText(c2d, '30°', cx + (2 * R / 3) * Math.sin(135 * DEG), cy - (2 * R / 3) * Math.cos(135 * DEG), P.dim, 9, 'center', false);
        haloText(c2d, '60°', cx + (R / 3) * Math.sin(135 * DEG), cy - (R / 3) * Math.cos(135 * DEG), P.dim, 9, 'center', false);
        haloText(c2d, '地平线', cx, cy + R - 22, P.dim, 9, 'center', false);
        haloText(c2d, '天顶', cx, cy + 13, P.dim, 9, 'center', false);

        /* ---------- 8. 标题与脚注 ---------- */
        var term = null;
        try { term = A.solarTerm(N); } catch (e3) { term = null; }
        var title = '太阳视运动平面图 · ' + latLabel(lat) + ' · ' + dateTxt + (term ? ' · ' + term : '');
        haloText(c2d, title, cx, 22, P.text, 15, 'center', true);

        var dayLenTxt;
        if (info.polarDay) dayLenTxt = '极昼 · 昼长 24 小时';
        else if (info.polarNight) dayLenTxt = '极夜 · 昼长 0 小时';
        else dayLenTxt = '昼长 ' + A.fmtDuration(info.hours);

        c2d.textAlign = 'left';
        c2d.textBaseline = 'alphabetic';
        setFont(c2d, 12, true);
        c2d.fillStyle = P.text;
        c2d.fillText('正午太阳高度 ' + info.noonAlt.toFixed(1) + '°', 14, h - 34);
        setFont(c2d, 11, false);
        c2d.fillStyle = P.dim;
        c2d.fillText(dayLenTxt, 14, h - 16);

        c2d.textAlign = 'right';
        setFont(c2d, 11, false);
        c2d.fillStyle = P.dim;
        c2d.fillText('现在 ' + A.fmtHours(utc) + ' UTC · ' + A.fmtHours(utc + tz), w - 14, h - 34);
        c2d.fillText('高度 ' + now.alt.toFixed(1) + '° · 方位 ' + dirName(now.az), w - 14, h - 16);

        c2d.restore();
      },

      resize: function (w, h) { /* 每帧自适应，无需缓存尺寸 */ },

      dispose: function () { /* 无外部资源 */ }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
