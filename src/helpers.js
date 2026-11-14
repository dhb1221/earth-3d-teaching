/* ============================================================
 * helpers.js — 公共三维工具（依赖 three.min.js 的全局 THREE）
 * 供 app.js 与各模型模块共用
 * ============================================================ */
(function (global) {
  'use strict';

  var PALETTE = {
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

  /* ---------- 文字标签（canvas 贴图精灵） ---------- */
  function makeLabel(text, opts) {
    opts = opts || {};
    var fs = opts.size || 48;
    var pad = 14;
    var c = document.createElement('canvas');
    var g = c.getContext('2d');
    g.font = (opts.bold === false ? '' : 'bold ') + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    var w = Math.ceil(g.measureText(text).width) + pad * 2;
    var h = fs + pad * 2;
    c.width = w; c.height = h;
    g = c.getContext('2d');
    if (opts.bg) {
      g.fillStyle = opts.bg;
      roundRect(g, 1, 1, w - 2, h - 2, 12);
      g.fill();
    }
    g.font = (opts.bold === false ? '' : 'bold ') + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = opts.color || PALETTE.text;
    g.fillText(text, w / 2, h / 2 + 1);
    var tex = new global.THREE.CanvasTexture(c);
    tex.minFilter = global.THREE.LinearFilter;
    var mat = new global.THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest !== false
    });
    var sp = new global.THREE.Sprite(mat);
    var scale = opts.scale || 0.5;
    sp.scale.set(scale * w / h, scale, 1);
    return sp;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------- 线条 ---------- */
  function makeLine(points, color, opts) {
    opts = opts || {};
    var geo = new global.THREE.BufferGeometry().setFromPoints(points);
    var mat;
    if (opts.dashed) {
      mat = new global.THREE.LineDashedMaterial({
        color: color, dashSize: opts.dashSize || 0.25, gapSize: opts.gapSize || 0.18,
        transparent: true, opacity: opts.opacity === undefined ? 1 : opts.opacity
      });
    } else {
      mat = new global.THREE.LineBasicMaterial({
        color: color, transparent: true,
        opacity: opts.opacity === undefined ? 1 : opts.opacity
      });
    }
    var line = new global.THREE.Line(geo, mat);
    if (opts.dashed) line.computeLineDistances();
    return line;
  }

  function makeCircleLine(radius, color, opts) {
    opts = opts || {};
    var pts = [];
    var n = opts.segments || 128;
    for (var i = 0; i <= n; i++) {
      var a = i / n * Math.PI * 2;
      pts.push(new global.THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    var l = makeLine(pts, color, opts);
    if (opts.dashed) l.computeLineDistances();
    return l;
  }

  /* ---------- 太阳光晕精灵 ---------- */
  function makeSunSprite(size) {
    var s = size || 3;
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.18, 'rgba(255,230,150,0.95)');
    grd.addColorStop(0.45, 'rgba(255,170,60,0.45)');
    grd.addColorStop(1, 'rgba(255,140,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    var tex = new global.THREE.CanvasTexture(c);
    var mat = new global.THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, blending: global.THREE.AdditiveBlending
    });
    var sp = new global.THREE.Sprite(mat);
    sp.scale.set(s, s, 1);
    return sp;
  }

  /* ---------- 经纬度 -> 单位球坐标 ---------- */
  function latLonToVec3(lat, lon, r) {
    r = r === undefined ? 1 : r;
    var p = lat * Math.PI / 180, l = lon * Math.PI / 180;
    return new global.THREE.Vector3(
      r * Math.cos(p) * Math.cos(l),
      r * Math.sin(p),
      -r * Math.cos(p) * Math.sin(l)
    );
  }

  /* ---------- 轻量轨道控制（自带阻尼 / 触摸） ---------- */
  function createOrbit(camera, dom, opts) {
    opts = opts || {};
    var target = opts.target ? opts.target.clone() : new global.THREE.Vector3();
    var minDist = opts.minDist || 2;
    var maxDist = opts.maxDist || 40;
    var rotSpeed = opts.rotateSpeed || 0.006;
    var zoomSpeed = opts.zoomSpeed || 0.0015;
    var sph = new global.THREE.Spherical().setFromVector3(
      camera.position.clone().sub(target)
    );
    var cur = { theta: sph.theta, phi: sph.phi, radius: sph.radius };
    var goal = { theta: sph.theta, phi: sph.phi, radius: sph.radius };
    var dragging = false, lastX = 0, lastY = 0, pinchDist = 0;
    var listeners = [];

    function onPointerDown(e) {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      dom.style.cursor = 'grabbing';
      if (dom.setPointerCapture && e.pointerId !== undefined) {
        try { dom.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }
    function onPointerMove(e) {
      if (!dragging || pinchDist) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      goal.theta -= dx * rotSpeed * 2;
      goal.phi -= dy * rotSpeed * 2;
      goal.phi = Math.max(0.08, Math.min(Math.PI - 0.08, goal.phi));
    }
    function onPointerUp() { dragging = false; dom.style.cursor = 'grab'; }
    function onWheel(e) {
      e.preventDefault();
      goal.radius *= 1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * zoomSpeed, 0.35);
      goal.radius = Math.max(minDist, Math.min(maxDist, goal.radius));
    }
    function dist(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function onTouchStart(e) {
      if (e.touches.length === 2) { pinchDist = dist(e.touches); dragging = false; }
      else if (e.touches.length === 1) {
        dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      }
    }
    function onTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var d = dist(e.touches);
        if (pinchDist > 0) {
          goal.radius *= pinchDist / d;
          goal.radius = Math.max(minDist, Math.min(maxDist, goal.radius));
        }
        pinchDist = d;
      } else if (e.touches.length === 1 && dragging) {
        var t = e.touches[0];
        var dx = t.clientX - lastX, dy = t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        goal.theta -= dx * rotSpeed * 2;
        goal.phi -= dy * rotSpeed * 2;
        goal.phi = Math.max(0.08, Math.min(Math.PI - 0.08, goal.phi));
      }
    }
    function onTouchEnd() { pinchDist = 0; dragging = false; }
    function add(ev, fn, el) {
      el = el || dom;
      el.addEventListener(ev, fn, { passive: false });
      listeners.push([el, ev, fn]);
    }
    add('pointerdown', onPointerDown);
    add('pointermove', onPointerMove);
    add('pointerup', onPointerUp);
    add('pointercancel', onPointerUp);
    add('pointerleave', onPointerUp);
    add('wheel', onWheel);
    add('touchstart', onTouchStart);
    add('touchmove', onTouchMove);
    add('touchend', onTouchEnd);

    var api = {
      update: function (dt) {
        var k = Math.min(1, (dt || 0.016) * 8);
        cur.theta += (goal.theta - cur.theta) * k;
        cur.phi += (goal.phi - cur.phi) * k;
        cur.radius += (goal.radius - cur.radius) * k;
        var s = new global.THREE.Spherical(cur.radius, cur.phi, cur.theta);
        camera.position.setFromSpherical(s).add(target);
        camera.lookAt(target);
      },
      setAngles: function (theta, phi, radius) {
        if (theta !== undefined) goal.theta = theta;
        if (phi !== undefined) goal.phi = phi;
        if (radius !== undefined) goal.radius = Math.max(minDist, Math.min(maxDist, radius));
      },
      snap: function () { cur.theta = goal.theta; cur.phi = goal.phi; cur.radius = goal.radius; },
      setTarget: function (v) { target.copy(v); },
      dispose: function () {
        listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
        listeners.length = 0;
      },
      dom: dom
    };
    dom.style.cursor = 'grab';
    return api;
  }

  global.H = {
    PALETTE: PALETTE,
    makeLabel: makeLabel,
    makeLine: makeLine,
    makeCircleLine: makeCircleLine,
    makeSunSprite: makeSunSprite,
    latLonToVec3: latLonToVec3,
    createOrbit: createOrbit,
    roundRect: roundRect
  };
})(typeof window !== 'undefined' ? window : globalThis);
