/* ============================================================
 * m5-cross.js — M5 极地俯视太阳光照图（canvas 2D 逐像素昼夜着色）
 * 依赖：window.Astro；配色取 window.H.PALETTE（缺省用内置兜底）
 * API：window.MODELS.M5 = function createM5(ctx) -> { draw, resize, dispose }
 *
 * 投影（北极上空俯视）：
 *   屏幕 x = 地球 X 轴，屏幕 y(向下) = 地球 Z 轴；可见半球 y_earth ≥ 0；
 *   归一化屏幕圆盘坐标 (u,v)，u = x/R, v = y/R（v 向下为正），
 *   像素对应地球单位矢量 p = (u, sqrt(1-u²-v²), v)（北极俯视）。
 * 南极上空俯视：可见半球 y_earth ≤ 0，屏幕 y 向下 = 地球 −Z 轴，
 *   于是 p = (u, −sqrt(1-u²-v²), −v)，自转方向呈顺时针。
 * 昼：dot(p, sunDir) > 0（暖色 #f5c26b 系）；夜：#16213f 系，边缘平滑过渡。
 * 逐像素结果缓存在离屏 canvas（仅状态变化时重算），再缩放绘制。
 * ============================================================ */
(function (global) {
  'use strict';

  var FONT = '"PingFang SC","Microsoft YaHei",sans-serif';
  var DEG = Math.PI / 180;
  var TROPIC = 23.44;   /* 回归线纬度 */
  var POLAR = 66.56;    /* 极圈纬度 */

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
  function cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function norm3(a) {
    var l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    if (!(l > 1e-9)) return null;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  }
  function headAt(g, x, y, ux, uy, color, size) {
    var s = size || 7, w2 = s * 0.45;
    var bx = x - ux * s, by = y - uy * s;
    var px = -uy, py = ux;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(bx + px * w2, by + py * w2);
    g.lineTo(bx - px * w2, by - py * w2);
    g.closePath();
    g.fill();
  }
  function drawArrow(g, x1, y1, x2, y2, color, lw) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    g.strokeStyle = color;
    g.lineWidth = lw || 1.5;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    headAt(g, x2, y2, ux, uy, color, 7);
  }
  /* 视觉坐标里的圆弧箭头：θ 为“数学正向”（x 右、y 向上）角度，度 */
  function visualArcArrow(g, cx, cy, r, th0, th1, color, lw, headSize) {
    var steps = Math.max(8, Math.round(Math.abs(th1 - th0) / 4));
    var i, th, x, y;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = lw || 1.5;
    g.beginPath();
    for (i = 0; i <= steps; i++) {
      th = (th0 + (th1 - th0) * i / steps) * DEG;
      x = cx + r * Math.cos(th);
      y = cy - r * Math.sin(th);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    var dir = (th1 >= th0) ? 1 : -1;
    var te = th1 * DEG;
    var ex = cx + r * Math.cos(te);
    var ey = cy - r * Math.sin(te);
    /* θ 增大时屏幕切线 = (-sinθ, -cosθ)，θ 减小时取反 */
    headAt(g, ex, ey, -Math.sin(te) * dir, -Math.cos(te) * dir, color, headSize || 7);
  }
  function latStr(v) {
    var a = Math.abs(v);
    if (a < 0.05) return '0°';
    return a.toFixed(1) + '°' + (v > 0 ? 'N' : 'S');
  }
  function lonLabel(deg) {
    var d = ((deg % 360) + 360) % 360;
    if (d < 0.01) return '0°';
    if (Math.abs(d - 180) < 0.01) return '180°';
    return d < 180 ? d.toFixed(0) + '°E' : (360 - d).toFixed(0) + '°W';
  }
  function phenomenon(decl) {
    if (decl > 0.5) return '北极圈极昼 · 南极圈极夜';
    if (decl < -0.5) return '北极圈极夜 · 南极圈极昼';
    return '太阳直射赤道 · 全球昼夜平分';
  }

  /* 逐像素昼夜着色：返回 1:1 圆盘离屏 canvas（圆外透明） */
  function buildShade(doc, sh, view, sun) {
    var cv = doc.createElement('canvas');
    cv.width = sh;
    cv.height = sh;
    var g = cv.getContext('2d');
    var img = g.createImageData(sh, sh);
    var data = img.data;
    var half = (sh - 1) / 2;
    var south = view === 'south';
    /* 昼 #f5c26b / 夜 #16213f */
    var dR = 245, dG = 194, dB = 107;
    var nR = 22, nG = 33, nB = 63;
    var px, py, i, u, v, rr, wq, ye, ze, dot, k, lit, edge, alpha;
    for (py = 0; py < sh; py++) {
      v = (py - half) / half;
      for (px = 0; px < sh; px++) {
        u = (px - half) / half;
        i = (py * sh + px) * 4;
        rr = u * u + v * v;
        if (rr > 1) { data[i + 3] = 0; continue; }
        wq = Math.sqrt(1 - rr);
        ye = south ? -wq : wq;
        ze = south ? -v : v;
        dot = u * sun.x + ye * sun.y + ze * sun.z;
        /* 晨昏线附近平滑过渡（dot ∈ [-0.012, 0.012]） */
        k = (dot + 0.012) / 0.024;
        if (k < 0) k = 0; else if (k > 1) k = 1;
        k = k * k * (3 - 2 * k);
        lit = dot > 0 ? dot * dot : 0;
        data[i] = (nR + (dR - nR) * k + 18 * lit) | 0;
        data[i + 1] = (nG + (dG - nG) * k + 16 * lit) | 0;
        data[i + 2] = (nB + (dB - nB) * k + 24 * lit) | 0;
        edge = (1 - Math.sqrt(rr)) * half;
        alpha = edge >= 1 ? 255 : (edge <= 0 ? 0 : edge * 255);
        data[i + 3] = alpha | 0;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  window.MODELS = window.MODELS || {};
  window.MODELS.M5 = function createM5(ctx) {
    var cache = { key: '', cv: null, view: 'north' };

    return {
      /* app.js 的「侧视/北极/南极」按钮会调用 setView */
      setView: function (view) { cache.view = (view === 'south') ? 'south' : 'north'; },
      draw: function (c2d, width, height, state, astro) {
        var A = astro || global.Astro;
        if (!c2d || !A || !(width > 1) || !(height > 1)) return;

        var P = palette();
        var S = state || {};
        var show = S.show || {};
        /* 视角优先级：state.show.polarView > state.view（north/south）> setView 缓存 */
        var view = 'north';
        if (show.polarView === 'south' || show.polarView === 'north') view = show.polarView;
        else if (S.view === 'south' || S.view === 'north') view = S.view;
        else view = cache.view || 'north';
        var N = clamp(Math.round(num(S.dayOfYear, 172)), 1, 365);
        var utc = num(S.utcHours, 0);

        var w = width, h = height;
        var R = Math.min(w, h) * 0.36;
        var cx = w / 2, cy = h / 2;

        /* 太阳方向（地球坐标系单位矢量）= 直射点方向 */
        var decl = A.declination(N);
        var lonS = A.subsolarLon(utc);
        var cd = Math.cos(decl * DEG), sd = Math.sin(decl * DEG);
        var sun = {
          x: cd * Math.cos(lonS * DEG),
          y: sd,
          z: -cd * Math.sin(lonS * DEG)
        };

        var dateTxt;
        try {
          var dt = A.nToDate(N);
          dateTxt = dt.month + '月' + dt.day + '日';
        } catch (e) {
          dateTxt = '第' + N + '天';
        }

        /* 直射点在屏幕上的单位方向（视觉角度，y 轴向上为正） */
        var su = sun.x, sv = (view === 'south') ? -sun.z : sun.z;
        var sul = Math.sqrt(su * su + sv * sv) || 1;
        su /= sul; sv /= sul;
        var sunTh = Math.atan2(-sv, su) * 180 / Math.PI;   /* 昼半球中心方位 */
        var nightTh = sunTh + 180;                          /* 夜半球中心方位 */
        /* 自转箭头放在背对直射点的斜角上，避开 0°/90°E/180°/90°W 注记 */
        var rotTh = Math.round((nightTh - 45) / 90) * 90 + 45;

        /* 地球单位矢量 / 经纬度 -> 屏幕坐标 */
        function project3(p) {
          var u = p.x;
          var v = (view === 'south') ? -p.z : p.z;
          return { x: cx + u * R, y: cy + v * R, u: u, v: v, yEarth: p.y };
        }
        function projectLatLon(latV, lonV) {
          var ph = latV * DEG, la = lonV * DEG;
          return project3({
            x: Math.cos(ph) * Math.cos(la),
            y: Math.sin(ph),
            z: -Math.cos(ph) * Math.sin(la)
          });
        }
        function ringLabel(text, rad, thetaDeg, color, size) {
          var th = thetaDeg * DEG;
          haloText(c2d, text, cx + rad * Math.cos(th), cy - rad * Math.sin(th), color || P.dim, size || 9, 'center', false);
        }

        c2d.save();
        c2d.clearRect(0, 0, w, h);
        c2d.fillStyle = P.bg;
        c2d.fillRect(0, 0, w, h);
        c2d.lineCap = 'round';
        c2d.lineJoin = 'round';
        c2d.setLineDash([]);

        /* ---------- 1. 逐像素昼夜圆盘（缓存） ---------- */
        var sh = clamp(Math.round(2 * R), 160, 300);
        var key = view + '|' + sh + '|' + sun.x.toFixed(4) + '|' + sun.y.toFixed(4) + '|' + sun.z.toFixed(4);
        if (!cache.cv || cache.key !== key) {
          var doc = (c2d.canvas && c2d.canvas.ownerDocument) || global.document || null;
          if (doc && doc.createElement) {
            cache.cv = buildShade(doc, sh, view, sun);
            cache.key = key;
          }
        }
        if (cache.cv) {
          try { c2d.imageSmoothingEnabled = true; } catch (e4) { /* 忽略 */ }
          c2d.drawImage(cache.cv, cx - R, cy - R, 2 * R, 2 * R);
        } else {
          c2d.beginPath();
          c2d.arc(cx, cy, R, 0, Math.PI * 2);
          c2d.fillStyle = '#16213f';
          c2d.fill();
        }

        /* ---------- 2. 经纬网（经线每 30°、回归线、极圈） ---------- */
        if (show.graticule !== false) {
          var lonI;
          c2d.strokeStyle = 'rgba(180,205,255,0.26)';
          c2d.lineWidth = 1;
          for (lonI = -180; lonI < 180; lonI += 30) {
            var rimPt = projectLatLon(0, lonI);
            c2d.beginPath();
            c2d.moveTo(cx, cy);
            c2d.lineTo(rimPt.x, rimPt.y);
            c2d.stroke();
          }
          var rT = R * Math.cos(TROPIC * DEG);
          var rP = R * Math.cos(POLAR * DEG);
          c2d.strokeStyle = 'rgba(255,211,107,0.45)';
          c2d.lineWidth = 1.2;
          c2d.beginPath();
          c2d.arc(cx, cy, rT, 0, Math.PI * 2);
          c2d.stroke();
          c2d.strokeStyle = 'rgba(78,161,255,0.62)';
          c2d.lineWidth = 1.2;
          c2d.beginPath();
          c2d.arc(cx, cy, rP, 0, Math.PI * 2);
          c2d.stroke();

          /* 环标签落在斜角方向，避开 0°/90°E/180°/90°W 四个正方向注记 */
          function snapDiag(a) { return Math.round((a - 45) / 90) * 90 + 45; }
          var rbNight = snapDiag(nightTh), rbSun = snapDiag(sunTh);
          ringLabel('回归线 23.44°', rT + 10, rbNight + 26, 'rgba(255,224,160,0.9)', 9);
          ringLabel('极圈 66.56°', rP + 11, rbSun, 'rgba(160,200,255,0.9)', 9);
          ringLabel('赤道 0°', R - 14, rbNight - 26, 'rgba(219,230,255,0.85)', 9);

          /* 经线注记：0°、90°E、180°、90°W */
          var mLabels = [0, 90, 180, -90];
          for (var mi = 0; mi < mLabels.length; mi++) {
            var mp = projectLatLon(0, mLabels[mi]);
            var mdx = mp.x - cx, mdy = mp.y - cy;
            var mdl = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
            var lx = clamp(mp.x + mdx / mdl * 13, 16, w - 16);
            var ly = clamp(mp.y + mdy / mdl * 13, 16, h - 16);
            haloText(c2d, lonLabel(mLabels[mi]), lx, ly, 'rgba(219,230,255,0.82)', 9, 'center', false);
          }
        }

        /* ---------- 3. 晨昏线（晨线/昏线） ---------- */
        if (show.terminator !== false) {
          var e1 = norm3(cross3(sun, { x: 0, y: 1, z: 0 }));
          var e2 = e1 ? norm3(cross3(sun, e1)) : null;
          if (e1 && e2) {
            var steps = 240;
            var runs = [], run = null, prevScr = null;
            var si, t, cp3, vis2, f2, cls2, scr2;
            for (si = 0; si <= steps; si++) {
              t = si / steps * Math.PI * 2;
              cp3 = {
                x: e1.x * Math.cos(t) + e2.x * Math.sin(t),
                y: e1.y * Math.cos(t) + e2.y * Math.sin(t),
                z: e1.z * Math.cos(t) + e2.z * Math.sin(t)
              };
              vis2 = (view === 'north') ? (cp3.y >= -0.004) : (cp3.y <= 0.004);
              if (!vis2) { run = null; prevScr = null; continue; }
              /* 光照变化率 = sun·(ω×p)，ω=(0,1,0) 为自转轴；>0 表示正由夜进入昼 → 晨线 */
              f2 = sun.x * cp3.z - sun.z * cp3.x;
              cls2 = f2 > 0;
              scr2 = project3(cp3);
              if (!run) {
                run = { cls: cls2, pts: [] };
                runs.push(run);
              } else if (run.cls !== cls2) {
                var lastPt = run.pts[run.pts.length - 1];
                run = { cls: cls2, pts: [] };
                runs.push(run);
                if (lastPt) run.pts.push(lastPt);
              }
              run.pts.push(scr2);
            }

            c2d.save();
            c2d.shadowColor = 'rgba(255,122,47,0.55)';
            c2d.shadowBlur = 8;
            c2d.strokeStyle = P.terminator;
            c2d.lineWidth = 2.2;
            for (var ri = 0; ri < runs.length; ri++) {
              var rpts = runs[ri].pts;
              if (rpts.length < 2) continue;
              c2d.beginPath();
              c2d.moveTo(rpts[0].x, rpts[0].y);
              for (var rj = 1; rj < rpts.length; rj++) c2d.lineTo(rpts[rj].x, rpts[rj].y);
              c2d.stroke();
            }
            c2d.restore();

            /* 晨线 / 昏线文字（各取最长的一段） */
            var bestM = null, bestE = null;
            for (var li = 0; li < runs.length; li++) {
              var lp = runs[li].pts;
              if (lp.length < 4) continue;
              if (runs[li].cls) {
                if (!bestM || lp.length > bestM.length) bestM = lp;
              } else {
                if (!bestE || lp.length > bestE.length) bestE = lp;
              }
            }
            var putLineLabel = function (pts, text) {
              var mp2 = pts[Math.floor(pts.length / 2)];
              var dx2 = cx - mp2.x, dy2 = cy - mp2.y;
              var dl2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
              haloText(c2d, text, mp2.x + dx2 / dl2 * 19, mp2.y + dy2 / dl2 * 19, '#ffb066', 10, 'center', true);
            };
            if (bestM) putLineLabel(bestM, '晨线');
            if (bestE) putLineLabel(bestE, '昏线');
          }
        }

        /* ---------- 4. 外圈（赤道） ---------- */
        c2d.beginPath();
        c2d.arc(cx, cy, R, 0, Math.PI * 2);
        c2d.strokeStyle = 'rgba(120,160,255,0.85)';
        c2d.lineWidth = 2;
        c2d.stroke();

        /* ---------- 5. 昼/夜半球与太阳直射点 ---------- */
        var du = su, dv = sv;

        drawArrow(c2d, cx + du * 8, cy + dv * 8, cx + du * (R * 0.42), cy + dv * (R * 0.42), 'rgba(255,232,187,0.72)', 1.2);
        haloText(c2d, '昼半球', cx + du * (R * 0.60), cy + dv * (R * 0.60), '#ffe8bb', 10.5, 'center', true);
        haloText(c2d, '夜半球', cx - du * (R * 0.60), cy - dv * (R * 0.60), '#9fb4e6', 10.5, 'center', true);
        haloText(c2d, view === 'north' ? '北极点' : '南极点', cx, cy + 15, 'rgba(219,230,255,0.8)', 9.5, 'center', false);

        var sunVisible = (view === 'north') ? (decl >= -0.05) : (decl <= 0.05);
        var sp = projectLatLon(decl, lonS);
        if (sunVisible) {
          var sg = c2d.createRadialGradient(sp.x, sp.y, 1, sp.x, sp.y, 15);
          sg.addColorStop(0, 'rgba(255,250,220,1)');
          sg.addColorStop(0.35, 'rgba(255,220,130,0.85)');
          sg.addColorStop(1, 'rgba(255,200,90,0)');
          c2d.fillStyle = sg;
          c2d.beginPath();
          c2d.arc(sp.x, sp.y, 15, 0, Math.PI * 2);
          c2d.fill();
          c2d.fillStyle = '#fff6d5';
          c2d.beginPath();
          c2d.arc(sp.x, sp.y, 4.4, 0, Math.PI * 2);
          c2d.fill();
          var sdx = sp.x - cx, sdy = sp.y - cy;
          var sdl = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
          var slx = clamp(sp.x + sdx / sdl * 26, 42, w - 42);
          var sly = clamp(sp.y + sdy / sdl * 26, 32, h - 32);
          haloText(c2d, '直射点 ' + latStr(decl), slx, sly, '#ffe8a8', 10, 'center', true);
        } else {
          var rimX = cx + du * (R - 4), rimY = cy + dv * (R - 4);
          var tailX = cx + du * (R - 30), tailY = cy + dv * (R - 30);
          drawArrow(c2d, tailX, tailY, rimX, rimY, '#ffd98a', 1.4);
          var hlx = clamp(cx + du * (R - 66), 46, w - 46);
          var hly = clamp(cy + dv * (R - 66), 34, h - 34);
          haloText(c2d, '直射点 ' + latStr(decl) + '（背面）', hlx, hly, '#ffe0a0', 10, 'center', true);
        }

        /* ---------- 6. 自转方向箭头（放在背对直射点的斜角，避开其它注记） ---------- */
        var rotColor = 'rgba(78,161,255,0.9)';
        if (view === 'north') {
          /* 北极上空俯视：屏幕逆时针 = 视觉角度增大 */
          visualArcArrow(c2d, cx, cy, R + 18, rotTh - 16, rotTh + 16, rotColor, 1.4, 7);
        } else {
          visualArcArrow(c2d, cx, cy, R + 18, rotTh + 16, rotTh - 16, rotColor, 1.4, 7);
        }
        var midTh = rotTh * DEG;
        haloText(c2d, '自转 ' + (view === 'north' ? '逆时针' : '顺时针'),
          cx + (R + 38) * Math.cos(midTh), cy - (R + 38) * Math.sin(midTh),
          '#8fc2ff', 9.5, 'center', true);

        /* ---------- 7. 标题与底部说明 ---------- */
        var viewTxt = (view === 'north') ? '北极上空俯视' : '南极上空俯视';
        var titleY = Math.max(18, cy - R - 30);
        haloText(c2d, '太阳光照图 · ' + viewTxt, cx, titleY, P.text, 14, 'center', true);
        var footY = Math.min(h - 14, cy + R + 26);
        haloText(c2d, viewTxt + ' · ' + dateTxt + ' · ' + phenomenon(decl), cx, footY, P.text, 10, 'center', false);

        c2d.restore();
      },

      resize: function (w, h) { /* 每帧自适应；缓存键含像素尺寸 */ },

      dispose: function () {
        cache.key = '';
        cache.cv = null;
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
