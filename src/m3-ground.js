/* ============================================================
 * m3-ground.js — M3 地面视角（高中地理「影子 / 太阳高度」教具）
 * 地平坐标系：x = 东，y = 天顶，z = 北
 * 太阳单位方向 = (cos(alt)·sin(az), sin(alt), cos(alt)·cos(az))
 * 方位角 0° = 北，90° = 东。标杆高 1.5，影子方向 = az + 180°。
 * 依赖：全局 THREE、window.H、window.Astro（都由 index.html 先行加载）
 * ============================================================ */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var SKY_R = 200;          // 天空穹顶半径
  var GROUND_R = 60;        // 地面圆盘半径
  var SUN_R = 150;          // 太阳 Sprite 距离
  var POLE_H = 1.5;         // 标杆高度

  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }

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

  /** 可复用的文字标签槽：文本不变就不重建 canvas 贴图 */
  function makeTextSlot(THREE, H, parent, opts) {
    var slot = { parent: parent, text: null, sprite: null, pos: new THREE.Vector3() };
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
   * 工厂：createM3(ctx)
   * ctx = { THREE, renderer, dom, width, height, textures, state, Astro, H }
   * ============================================================ */
  function createM3(ctx) {
    ctx = ctx || {};
    var THREE = ctx.THREE || global.THREE;
    var H = ctx.H || global.H;
    var AU = ctx.Astro || global.Astro || {};
    var dom = ctx.dom || (global.document && global.document.body) || null;
    var PAL = (H && H.PALETTE) || {};
    var textCol = PAL.text || '#dbe6ff';

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.bg || '#05070f');

    var camera = new THREE.PerspectiveCamera(
      45, (ctx.width || 1) / (ctx.height || 1), 0.1, 600
    );
    // 契约：初始位置在原点附近 (0, 1.6, 0)，朝北看（op 方向 = +z）
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 1.6, 10);

    var root = new THREE.Group();
    scene.add(root);

    /* ---------- 天空穹顶（BackSide 球，颜色随太阳高度渐变） ---------- */
    var skyMat = new THREE.MeshBasicMaterial({
      color: 0x05070f,
      side: THREE.BackSide,
      depthWrite: false
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 32, 20), skyMat);
    sky.renderOrder = -1;
    root.add(sky);

    /* ---------- 地面圆盘 + 方向网格 ---------- */
    var groundMat = new THREE.MeshBasicMaterial({ color: 0x0b1322 });
    var ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_R, 72), groundMat);
    ground.rotation.x = -Math.PI / 2;
    root.add(ground);

    var ringR = [15, 30, 45];
    for (var ri = 0; ri < ringR.length; ri++) {
      var ring = H.makeCircleLine(ringR[ri], 0x4a6390, { segments: 96, opacity: 0.18 });
      ring.position.y = 0.01;
      root.add(ring);
    }

    // 十字方向线：北 / 东 / 南 / 西（一条 LineSegments 搞定）
    var crossPts = [];
    var CARD = [['北', 0], ['东', 90], ['南', 180], ['西', 270]];
    for (var ci = 0; ci < CARD.length; ci++) {
      var cdir = altAzToVec3(THREE, 0, CARD[ci][1], GROUND_R);
      crossPts.push(new THREE.Vector3(0, 0.01, 0));
      crossPts.push(new THREE.Vector3(cdir.x, 0.01, cdir.z));
    }
    root.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(crossPts),
      new THREE.LineBasicMaterial({ color: 0x4a6390, transparent: true, opacity: 0.22 })
    ));

    // 半径 30 处的四方向标签
    for (ci = 0; ci < CARD.length; ci++) {
      var cv = altAzToVec3(THREE, 0, CARD[ci][1], 30);
      var cl = H.makeLabel(CARD[ci][0], {
        color: textCol, size: 64, scale: 2.2, bg: 'rgba(10,16,32,0.35)'
      });
      cl.position.set(cv.x, 0.9, cv.z);
      root.add(cl);
    }

    /* ---------- 标杆 ---------- */
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.12, POLE_H, 12),
      new THREE.MeshBasicMaterial({ color: 0xd7e3ff })
    );
    pole.position.y = POLE_H / 2;
    root.add(pole);
    var poleTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb46b })
    );
    poleTop.position.y = POLE_H;
    root.add(poleTop);

    /* ---------- 影子：单位平面片（长度沿局部 +z），靠 scale.z 拉长 ---------- */
    var shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);      // 平铺到地面
    shadowGeo.translate(0, 0, 0.5);       // 从杆底 (0,0,0) 向局部 +z 延伸 0..1
    var shadowMat = new THREE.MeshBasicMaterial({
      color: 0x03060d, transparent: true, opacity: 0.55, depthWrite: false
    });
    var shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.015;
    shadow.visible = false;
    root.add(shadow);

    /* ---------- 太阳（Sprite 光晕，方向 × 150） ---------- */
    var sunSprite = H.makeSunSprite(26);
    root.add(sunSprite);

    // 「影子极长」提示（3D 文字，不做 DOM）
    var longSlot = makeTextSlot(THREE, H, root, {
      color: PAL.sun || '#ffd36b', size: 40, scale: 0.8, bg: 'rgba(255,138,61,0.2)'
    });

    /* ---------- 颜色 ---------- */
    var C_NIGHT = new THREE.Color(0x05070f);    // 近黑
    var C_DUSK = new THREE.Color(0x3a1e2e);     // 日出/日落前后暗紫
    var C_HORIZON = new THREE.Color(0xc25a2c);  // 地平线附近橙红
    var C_DAY = new THREE.Color(0x0d2c66);      // 深蓝
    var C_GND_NIGHT = new THREE.Color(0x070b14);
    var C_GND_DAY = new THREE.Color(0x121c30);

    function updateSky(alt) {
      if (alt <= -12) {
        skyMat.color.copy(C_NIGHT);
      } else if (alt < 0) {
        skyMat.color.copy(C_NIGHT).lerp(C_DUSK, (alt + 12) / 12);
      } else if (alt < 15) {
        var f = alt / 15;
        skyMat.color.copy(C_HORIZON).lerp(C_DAY, f * f * 0.7 + f * 0.3);
      } else {
        skyMat.color.copy(C_DAY);
      }
      var g = Math.max(0, Math.min(1, alt / 25));
      groundMat.color.copy(C_GND_NIGHT).lerp(C_GND_DAY, g);
    }

    /* ---------- update ---------- */
    function update(state, astro) {
      var S = state || ctx.state || {};
      if (astro) AU = astro;
      if (!AU || !AU.sunState) return;

      var N = (S.dayOfYear === undefined) ? 173 : S.dayOfYear;
      var lat = (S.observerLat === undefined) ? 40 : S.observerLat;
      var lon = (S.observerLon === undefined) ? 116.4 : S.observerLon;
      var utc = (S.utcHours === undefined) ? 4 : S.utcHours;

      var st = AU.sunState(N, utc, lat, lon);
      var alt = st.alt, az = st.az;

      updateSky(alt);

      // 太阳位置：方向 × 150；alt < −2° 时隐藏
      var dir = altAzToVec3(THREE, alt, az, SUN_R);
      sunSprite.position.copy(dir);
      sunSprite.visible = alt > -2;

      // 影子：方向 = az + 180°，长度 = 1.5 / tan(alt)，夹在 [0, 40]
      if (alt > 0) {
        var tanA = Math.tan(alt * DEG);
        var len = tanA > 0.0001 ? POLE_H / tanA : 40;
        len = Math.max(0.05, Math.min(40, len));
        shadow.visible = true;
        shadow.rotation.y = (az + 180) * DEG;
        shadow.scale.set(0.3, 1, len);
        shadowMat.opacity = 0.55;
      } else {
        shadow.visible = false;
      }

      // alt < 2° 时影子被 40 m 截断，给出「影子极长」提示
      longSlot.set(
        (alt > 0 && alt < 2) ? '影子极长 · 太阳贴近地平线' : null,
        0, 2.35, 0
      );
    }

    /* ---------- 相机 / 交互 ---------- */
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
        // 契约要求相机在原点附近 (0,1.6,0) 看向北；H.createOrbit 只能围绕 target(0,3,0)
        // 以 radius ≥ minDist 定位相机，所以把「第一人称起点」放到正南 6.5m、
        // 高度 1.55m（约等于人眼高度），视线仍是朝北、地平线落在画面下三分之一。
        camera.position.set(0, 1.55, -6.5);
        camera.lookAt(0, 3, 0);
        orbit = H.createOrbit(camera, dom, {
          target: new THREE.Vector3(0, 3, 0),
          minDist: 5,
          maxDist: 25
        });
        orbit.snap();
      },
      deactivate: function () {
        if (orbit) { orbit.dispose(); orbit = null; }
        camera.position.set(0, 1.6, 0);
        camera.lookAt(0, 1.6, 10);
      },
      resize: function (w, h) {
        camera.aspect = (w || 1) / (h || 1);
        camera.updateProjectionMatrix();
      },
      dispose: function () {
        if (orbit) { orbit.dispose(); orbit = null; }
        disposeTree(root);
      }
    };
  }

  global.MODELS = global.MODELS || {};
  global.MODELS.M3 = createM3;
})(typeof window !== 'undefined' ? window : globalThis);
