/* ============================================================
 * m2-sky.js — M2 天球模型（高中地理「太阳视运动」教具）
 * 地平坐标系：x = 东，y = 天顶，z = 北
 * 太阳单位方向 = (cos(alt)·sin(az), sin(alt), cos(alt)·cos(az))
 * 方位角 0° = 北，90° = 东。
 * 依赖：全局 THREE、window.H、window.Astro（都由 index.html 先行加载）
 * ============================================================ */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var HORIZON_R = 10;              // 地平圈半径
  var PATH_R = 8;                  // 太阳一日视运动轨迹半径
  var DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }

  /** 方位角 -> 中文方位（8 分位） */
  function dirName(az) { return DIR8[Math.round(norm360(az) / 45) % 8]; }

  /** 高度角/方位角 -> 地平坐标（x 东 / y 天顶 / z 北） */
  function altAzToVec3(THREE, alt, az, r) {
    var a = alt * DEG, z = az * DEG, ca = Math.cos(a);
    return new THREE.Vector3(
      ca * Math.sin(z) * r,
      Math.sin(a) * r,
      ca * Math.cos(z) * r
    );
  }

  /** 递归释放 geometry / material / 贴图 */
  function disposeTree(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (var i = 0; i < mats.length; i++) {
        if (mats[i].map && mats[i].map.dispose) mats[i].map.dispose();
        if (mats[i].dispose) mats[i].dispose();
      }
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  function clearGroup(g) {
    while (g.children.length) disposeTree(g.children[0]);
  }

  /** 可复用的文字标签槽：文本不变就不重建 canvas 贴图 */
  function makeTextSlot(THREE, H, parent, opts) {
    var slot = {
      parent: parent,
      text: null,
      sprite: null,
      pos: new THREE.Vector3()
    };
    slot.set = function (text, x, y, z) {
      if (x !== undefined) slot.pos.set(x, y, z);
      if (text === slot.text) {
        if (slot.sprite) slot.sprite.position.copy(slot.pos);
        return;
      }
      if (slot.sprite) { disposeTree(slot.sprite); slot.sprite = null; }
      slot.text = text || null;
      if (!text) return;
      var sp = H.makeLabel(text, opts);
      sp.position.copy(slot.pos);
      slot.sprite = sp;
      parent.add(sp);
    };
    slot.clear = function () {
      if (slot.sprite) { disposeTree(slot.sprite); slot.sprite = null; }
      slot.text = null;
    };
    return slot;
  }

  /* ============================================================
   * 工厂：createM2(ctx)
   * ctx = { THREE, renderer, dom, width, height, textures, state, Astro, H }
   * ============================================================ */
  function createM2(ctx) {
    ctx = ctx || {};
    var THREE = ctx.THREE || global.THREE;
    var H = ctx.H || global.H;
    var AU = ctx.Astro || global.Astro || {};
    var dom = ctx.dom || (global.document && global.document.body) || null;
    var PAL = (H && H.PALETTE) || {};
    var accent = PAL.accent || '#4ea1ff';
    var warm = PAL.warm || '#ff8a3d';
    var sunCol = PAL.sun || '#ffd36b';
    var textCol = PAL.text || '#dbe6ff';
    var dayCol = PAL.day || '#ffd36b';
    var nightCol = PAL.night || '#2b3a63';
    var cancelCol = PAL.terminator || '#ff7a2f';

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.bg || '#05070f');

    var camera = new THREE.PerspectiveCamera(
      45, (ctx.width || 1) / (ctx.height || 1), 0.1, 500
    );
    camera.position.set(13, 9, 15);
    camera.lookAt(0, 3, 0);

    var root = new THREE.Group();
    scene.add(root);

    /* ---------- 静态部分：基面 / 地平圈 / 刻度 / 方向 / 天顶 / 观测者 ---------- */
    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(HORIZON_R, 72),
      new THREE.MeshBasicMaterial({
        color: 0x0a1226, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.015;
    root.add(disc);

    root.add(H.makeCircleLine(HORIZON_R, accent, { segments: 128, opacity: 0.9 }));

    // 每 30° 一个方位刻度（刻度线，整条只占 1 个对象）
    var tickPts = [];
    for (var ti = 0; ti < 12; ti++) {
      var ta = ti * 30 * DEG, tdx = Math.sin(ta), tdz = Math.cos(ta);
      tickPts.push(new THREE.Vector3(tdx * 9.3, 0, tdz * 9.3));
      tickPts.push(new THREE.Vector3(tdx * HORIZON_R, 0, tdz * HORIZON_R));
    }
    root.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(tickPts),
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.5 })
    ));

    // N(+z) / E(+x) / S(−z) / W(−x)
    var CARD = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
    for (var ci = 0; ci < CARD.length; ci++) {
      var cv = altAzToVec3(THREE, 0, CARD[ci][1], HORIZON_R + 1.3);
      var cl = H.makeLabel(CARD[ci][0], {
        color: (ci % 2 === 0) ? accent : textCol, size: 52, scale: 1.0
      });
      cl.position.set(cv.x, 0.55, cv.z);
      root.add(cl);
    }

    // 天顶
    root.add(H.makeLine(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, HORIZON_R, 0)],
      accent, { dashed: true, opacity: 0.3, dashSize: 0.22, gapSize: 0.3 }
    ));
    var zenithLabel = H.makeLabel('天顶', { color: textCol, size: 44, scale: 0.66 });
    zenithLabel.position.set(0, 10.8, 0);
    root.add(zenithLabel);

    // 观测者
    var observer = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 12),
      new THREE.MeshBasicMaterial({ color: warm })
    );
    observer.position.set(0, 0.17, 0);
    root.add(observer);
    var observerLabel = H.makeLabel('观测者', {
      color: textCol, size: 40, scale: 0.52, bg: 'rgba(10,16,32,0.6)'
    });
    observerLabel.position.set(0, 0.88, 0);
    root.add(observerLabel);

    /* ---------- 动态部分 ---------- */
    var pathGroup = new THREE.Group();   // 一日轨迹 + 正午点
    var riseGroup = new THREE.Group();   // 日出 / 日落点
    var sunGroup = new THREE.Group();    // 当前太阳 + 连线 + 数值标签
    root.add(pathGroup);
    root.add(riseGroup);
    root.add(sunGroup);

    var polarSlot = makeTextSlot(THREE, H, root, {
      color: dayCol, size: 42, scale: 0.6, bg: 'rgba(255,138,61,0.18)'
    });

    // 当前太阳：小球 + 加色光晕
    var sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 18, 14),
      new THREE.MeshBasicMaterial({ color: sunCol })
    );
    sunGroup.add(sunMesh);
    var sunGlow = H.makeSunSprite(3.6);
    sunGroup.add(sunGlow);

    // 观测者 -> 太阳 的连线（虚线，长度动态更新）
    var sunLine = H.makeLine(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.001, 0)],
      accent, { dashed: true, opacity: 0.55, dashSize: 0.28, gapSize: 0.22 }
    );
    sunGroup.add(sunLine);

    // 太阳方位在地平圈上的投影线
    var azLine = H.makeLine(
      [new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.02, HORIZON_R)],
      sunCol, { dashed: true, opacity: 0.4, dashSize: 0.3, gapSize: 0.26 }
    );
    sunGroup.add(azLine);

    var altSlot = makeTextSlot(THREE, H, sunGroup, {
      color: textCol, size: 38, scale: 0.5, bg: 'rgba(10,16,32,0.55)'
    });
    var azSlot = makeTextSlot(THREE, H, sunGroup, {
      color: textCol, size: 36, scale: 0.46, bg: 'rgba(10,16,32,0.5)'
    });

    /* ---------- 与日期 / 纬度相关：轨迹、日出日落、正午、极昼极夜 ---------- */
    var structKey = '';

    function rebuildStructure(S) {
      var key = S.dayOfYear + '|' + S.observerLat.toFixed(2) + '|' + S.observerLon.toFixed(2);
      if (key === structKey) return;
      structKey = key;

      clearGroup(pathGroup);
      clearGroup(riseGroup);

      var N = S.dayOfYear, lat = S.observerLat, lon = S.observerLon, tz = S.tz;
      var samples = AU.sampleDay(lat, lon, N, 10);

      function addHorizonMark(utcH, title, color) {
        var st = AU.sunState(N, utcH, lat, lon);
        var p = altAzToVec3(THREE, 0, st.az, HORIZON_R);
        var cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.22, 0.66, 10),
          new THREE.MeshBasicMaterial({ color: color })
        );
        cone.position.set(p.x, 0.33, p.z);
        riseGroup.add(cone);
        var lb = H.makeLabel(
          title + ' ' + dirName(st.az) + ' ' + AU.fmtHours(utcH + tz),
          { color: color, size: 38, scale: 0.5, bg: 'rgba(10,16,32,0.5)' }
        );
        lb.position.set(p.x * 1.18, 1.15, p.z * 1.18);
        riseGroup.add(lb);
      }

      /* --- 一日视运动轨迹：地平线以上实线金色 / 以下虚线暗色，首尾闭合成圈 --- */
      var pts = [], alts = [];
      for (var i = 0; i < samples.length; i++) {
        pts.push(altAzToVec3(THREE, samples[i].alt, samples[i].az, PATH_R));
        alts.push(samples[i].alt);
      }
      if (samples.length) { pts.push(pts[0].clone()); alts.push(alts[0]); }

      if (pts.length > 1) {
        var runs = [];
        var run = { above: alts[0] > 0, pts: [pts[0].clone()] };
        for (i = 1; i < pts.length; i++) {
          var above = alts[i] > 0;
          if (above === run.above) { run.pts.push(pts[i]); continue; }
          var a0 = Math.abs(alts[i - 1]), a1 = Math.abs(alts[i]);
          var f = (a0 + a1) > 1e-9 ? a0 / (a0 + a1) : 0.5;
          var cross = pts[i - 1].clone().lerp(pts[i], f);
          cross.y = 0;                                   // 交点严格落在地平线上
          run.pts.push(cross.clone());
          runs.push(run);
          run = { above: above, pts: [cross.clone(), pts[i].clone()] };
        }
        runs.push(run);
        for (i = 0; i < runs.length; i++) {
          if (runs[i].pts.length < 2) continue;
          pathGroup.add(H.makeLine(
            runs[i].pts,
            runs[i].above ? dayCol : nightCol,
            runs[i].above
              ? { opacity: 0.95 }
              : { dashed: true, opacity: 0.75, dashSize: 0.3, gapSize: 0.26 }
          ));
        }
      }

      /* --- 正午点：轨迹最高点 --- */
      var iMax = 0;
      for (i = 1; i < samples.length; i++) {
        if (samples[i].alt > samples[iMax].alt) iMax = i;
      }
      if (samples.length && samples[iMax].alt > 0) {
        var np = altAzToVec3(THREE, samples[iMax].alt, samples[iMax].az, PATH_R);
        var noonDot = new THREE.Mesh(
          new THREE.SphereGeometry(0.19, 12, 10),
          new THREE.MeshBasicMaterial({ color: dayCol })
        );
        noonDot.position.copy(np);
        pathGroup.add(noonDot);
        var noonLabel = H.makeLabel(
          '正午 高度 ' + samples[iMax].alt.toFixed(1) + '°',
          { color: dayCol, size: 38, scale: 0.5, bg: 'rgba(10,16,32,0.5)' }
        );
        noonLabel.position.set(np.x, np.y + 0.75, np.z);
        pathGroup.add(noonLabel);
      }

      /* --- 日出 / 日落点 --- */
      var info = AU.dayInfo(lat, N);
      if (!info.polarDay && !info.polarNight) {
        var ru = AU.sunriseUTC(lat, N, lon);
        if (ru) {
          addHorizonMark(ru.sunrise, '日出', warm);
          addHorizonMark(ru.sunset, '日落', cancelCol);
        }
      }

      /* --- 极昼 / 极夜文案 --- */
      if (info.polarDay) polarSlot.set('极昼 · 太阳整日不落', 0, 12.3, 0);
      else if (info.polarNight) polarSlot.set('极夜 · 太阳整日不升', 0, 12.3, 0);
      else polarSlot.set(null);
    }

    var labelTick = 0;

    /* ---------- 当前太阳（每帧都可能变化，位置直接改，不重建对象） ---------- */
    function updateSun(S) {
      if (!AU || !AU.sunState) return;
      var st = AU.sunState(S.dayOfYear, S.utcHours, S.observerLat, S.observerLon);
      var pos = altAzToVec3(THREE, st.alt, st.az, PATH_R);

      sunMesh.position.copy(pos);
      sunGlow.position.copy(pos);
      sunGlow.material.opacity = st.alt > -2 ? 1 : 0.28;

      var pa = sunLine.geometry.attributes.position;
      pa.setXYZ(1, pos.x, pos.y, pos.z);
      pa.needsUpdate = true;
      sunLine.computeLineDistances();

      var gp = altAzToVec3(THREE, 0, st.az, HORIZON_R);
      var ga = azLine.geometry.attributes.position;
      ga.setXYZ(1, gp.x, 0.02, gp.z);
      ga.needsUpdate = true;
      azLine.computeLineDistances();

      // 数值标签：非播放时精确到 0.1° 且立即刷新；播放时按整度、最多每 8 帧刷新一次，
      // 避免高速播放（60×）时每帧重建 canvas 贴图拖慢手机。
      labelTick++;
      if (!S.playing || labelTick % 8 === 0) {
        altSlot.set(
          '高度角 ' + (S.playing ? Math.round(st.alt) : st.alt.toFixed(1)) + '°',
          pos.x * 0.55, pos.y * 0.55 + 0.45, pos.z * 0.55
        );
        azSlot.set(
          '方位 ' + Math.round(st.az) + '°（' + dirName(st.az) + '）',
          gp.x * 0.62, 0.45, gp.z * 0.62
        );
      }
    }

    function update(state, astro) {
      var S = state || ctx.state || {};
      if (astro) AU = astro;
      if (!AU || !AU.sunState) return;
      var S2 = {
        dayOfYear: (S.dayOfYear === undefined) ? 173 : S.dayOfYear,
        observerLat: (S.observerLat === undefined) ? 40 : S.observerLat,
        observerLon: (S.observerLon === undefined) ? 116.4 : S.observerLon,
        tz: (S.tz === undefined) ? 8 : S.tz,
        utcHours: (S.utcHours === undefined) ? 4 : S.utcHours,
        playing: !!S.playing
      };
      rebuildStructure(S2);
      updateSun(S2);
    }

    var orbit = null;

    return {
      scene: scene,
      camera: camera,
      update: update,
      tick: function (dt) {
        if (orbit) orbit.update(dt);
      },
      activate: function () {
        if (orbit || !dom) return;
        orbit = H.createOrbit(camera, dom, {
          target: new THREE.Vector3(0, 3, 0),
          minDist: 8,
          maxDist: 35
        });
        orbit.snap();
      },
      deactivate: function () {
        if (orbit) { orbit.dispose(); orbit = null; }
      },
      resize: function (w, h) {
        camera.aspect = (w || 1) / (h || 1);
        camera.updateProjectionMatrix();
      },
      dispose: function () {
        if (orbit) { orbit.dispose(); orbit = null; }
        disposeTree(root);
        structKey = '';
      }
    };
  }

  global.MODELS = global.MODELS || {};
  global.MODELS.M2 = createM2;
})(typeof window !== 'undefined' ? window : globalThis);
