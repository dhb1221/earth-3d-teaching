/* ============================================================
 * m1-earth.js — M1 空间模型：宇宙视角的地球 + 平行太阳光
 * 昼夜、直射点、晨昏线、经纬网、五带、观测点标记
 * ============================================================ */
(function (global) {
  'use strict';

  var THREE = global.THREE;
  var Astro = global.Astro;
  var H = global.H;

  var R = 1;          // 地球半径
  var VIEWS = {
    side:  { theta: 0.0,  phi: 1.42, radius: 3.15 },
    north: { theta: 0.0,  phi: 0.12, radius: 3.35 },
    south: { theta: 0.0,  phi: Math.PI - 0.12, radius: 3.35 }
  };

  var VERT = [
    'varying vec3 vN;',
    'varying vec3 vWorld;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = uv;',
    '  vN = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorld = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var EARTH_FRAG = [
    'uniform sampler2D dayMap;',
    'uniform sampler2D nightMap;',
    'uniform sampler2D specMap;',
    'uniform vec3 sunDir;',
    'uniform float softness;',
    'uniform float nightOn;',
    'uniform float zonesOn;',
    'varying vec3 vN;',
    'varying vec3 vWorld;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  float d = dot(n, sunDir);',
    '  float lit = smoothstep(-softness, softness, d);',
    '  vec3 dayC = texture2D(dayMap, vUv).rgb;',
    '  vec3 nightC = texture2D(nightMap, vUv).rgb;',
    // 夜面：城市灯光 + 极暗的地表
    '  vec3 darkC = nightC * (1.35 * nightOn) + dayC * 0.025;',
    '  vec3 col = mix(darkC, dayC * 1.05, lit);',
    // 晨昏线暖色带
    '  float band = smoothstep(-0.24, 0.0, d) * (1.0 - smoothstep(0.0, 0.22, d));',
    '  col += vec3(1.0, 0.40, 0.10) * band * 0.30;',
    // 海洋镜面高光
    '  float specMask = texture2D(specMap, vUv).r;',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  vec3 Hv = normalize(sunDir + V);',
    '  float spec = pow(max(dot(n, Hv), 0.0), 26.0);',
    '  col += vec3(0.65, 0.82, 1.0) * spec * specMask * 0.7 * smoothstep(0.0, 0.18, d);',
    // 边缘大气散射（薄）
    '  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);',
    '  col += vec3(0.30, 0.55, 1.0) * rim * (0.18 + 0.55 * max(d, 0.0));',
    // 五带着色
    '  float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));',
    '  vec3 zc = vec3(1.0, 0.52, 0.22);',
    '  if (abs(lat) >= 23.44 && abs(lat) < 66.56) zc = vec3(0.32, 0.85, 0.52);',
    '  if (abs(lat) >= 66.56) zc = vec3(0.55, 0.72, 1.0);',
    '  col = mix(col, zc * 0.62, zonesOn * 0.34);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var CLOUD_FRAG = [
    'uniform sampler2D cloudMap;',
    'uniform vec3 sunDir;',
    'varying vec3 vN;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 c = texture2D(cloudMap, vUv);',
    '  float d = dot(normalize(vN), sunDir);',
    '  float lit = smoothstep(-0.16, 0.30, d);',
    '  vec3 col = mix(vec3(0.12,0.16,0.28), vec3(1.0), lit);',
    '  float a = c.a * (0.10 + 0.72 * lit);',
    '  if (c.r > 0.98 && c.g > 0.98 && c.b > 0.98) a = c.a;',
    '  gl_FragColor = vec4(col, a * 0.62);',
    '}'
  ].join('\n');

  var ATMO_FRAG = [
    'uniform vec3 sunDir;',
    'varying vec3 vN;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  float d = dot(n, sunDir);',
    '  float glow = pow(1.0 - abs(d), 2.2);',
    '  float lit = 0.25 + 0.75 * smoothstep(-0.45, 0.55, d);',
    '  gl_FragColor = vec4(vec3(0.32,0.62,1.0), glow * lit * 0.55);',
    '}'
  ].join('\n');

  /* ---------- 工具：程序化占位贴图 ---------- */
  function fallbackTexture(r, g, b) {
    var c = document.createElement('canvas');
    c.width = 4; c.height = 2;
    var x = c.getContext('2d');
    x.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    x.fillRect(0, 0, 4, 4);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  function makeStars() {
    var n = 1400;
    var pos = new Float32Array(n * 3);
    var col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var u = Math.random() * 2 - 1;
      var th = Math.random() * Math.PI * 2;
      var r = 60 + Math.random() * 30;
      var s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(th);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(th);
      var k = 0.45 + Math.random() * 0.55;
      col[i * 3] = k * (0.85 + Math.random() * 0.15);
      col[i * 3 + 1] = k * (0.9 + Math.random() * 0.1);
      col[i * 3 + 2] = k;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var mat = new THREE.PointsMaterial({
      size: 0.9, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.9, depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  /* ---------- 经纬网 / 特殊纬线 ---------- */
  function buildGraticule() {
    var group = new THREE.Group();
    var pts = [];
    var r = R * 1.0025;
    var d2r = Math.PI / 180;
    var i, a, lat, lon;

    // 经线：每 30°
    for (lon = -180; lon < 180; lon += 30) {
      var arr = [];
      for (lat = -90; lat <= 90; lat += 3) {
        var p = H.latLonToVec3(lat, lon, r);
        arr.push(p);
      }
      pts.push(arr);
    }
    // 纬线：每 30°
    for (lat = -60; lat <= 60; lat += 30) {
      var brr = [];
      for (a = 0; a <= 360; a += 4) brr.push(H.latLonToVec3(lat, a, r));
      pts.push(brr);
    }
    var geoPts = [];
    pts.forEach(function (line) {
      for (var k = 0; k < line.length - 1; k++) {
        geoPts.push(line[k], line[k + 1]);
      }
    });
    var geo = new THREE.BufferGeometry().setFromPoints(geoPts);
    var mat = new THREE.LineBasicMaterial({ color: 0xb9cdf0, transparent: true, opacity: 0.20 });
    var grid = new THREE.LineSegments(geo, mat);
    grid.name = 'graticule';
    group.add(grid);

    // 赤道（亮）
    var eq = [];
    for (a = 0; a <= 360; a += 2) eq.push(H.latLonToVec3(0, a, R * 1.004));
    var eqLine = H.makeLine(eq, 0xffd36b, { opacity: 0.75 });
    eqLine.name = 'special';
    group.add(eqLine);

    // 南北回归线
    [23.44, -23.44].forEach(function (l) {
      var arr2 = [];
      for (var a2 = 0; a2 <= 360; a2 += 2) arr2.push(H.latLonToVec3(l, a2, R * 1.004));
      var ln = H.makeLine(arr2, 0xff9d4a, { opacity: 0.75, dashed: false });
      ln.name = 'special';
      group.add(ln);
    });
    // 南北极圈
    [66.56, -66.56].forEach(function (l) {
      var arr3 = [];
      for (var a3 = 0; a3 <= 360; a3 += 2) arr3.push(H.latLonToVec3(l, a3, R * 1.004));
      var ln2 = H.makeLine(arr3, 0x5ad8ff, { opacity: 0.7, dashed: false });
      ln2.name = 'special';
      group.add(ln2);
    });
    // 极圈 / 回归线标签
    var labels = [
      ['北回归线 23°26′N', 23.44, -50, 0xffb066],
      ['南回归线 23°26′S', -23.44, -50, 0xffb066],
      ['北极圈 66°34′N', 66.56, -50, 0x7fe0ff],
      ['南极圈 66°34′S', -66.56, -50, 0x7fe0ff],
      ['赤道 0°', 0, -70, 0xffd36b]
    ];
    labels.forEach(function (it) {
      var sp = H.makeLabel(it[0], { color: it[3], size: 34, scale: 0.085 });
      sp.position.copy(H.latLonToVec3(it[1], it[2], R * 1.02));
      sp.name = 'special';
      group.add(sp);
    });
    return group;
  }

  /* ---------- 晨昏线环 ---------- */
  function makeTerminator() {
    var pts = [];
    for (var i = 0; i <= 180; i++) {
      var a = i / 180 * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R * 1.006, Math.sin(a) * R * 1.006, 0));
    }
    var line = H.makeLine(pts, 0xff7a2f, { opacity: 0.95 });
    line.name = 'terminatorLine';
    return line;
  }

  /* ---------- 主工厂 ---------- */
  function createM1(ctx) {
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(42, ctx.width / ctx.height, 0.05, 400);
    camera.position.set(0, 0.42, 3.15);

    scene.add(makeStars());

    // ---------- 地球 ----------
    var tex = ctx.textures || {};
    var dayMap = tex.day || fallbackTexture(30, 60, 110);
    var nightMap = tex.night || fallbackTexture(2, 3, 8);
    var specMap = tex.specular || fallbackTexture(0, 0, 0);
    var cloudMap = tex.clouds || null;

    var earthUniforms = {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      specMap: { value: specMap },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      softness: { value: 0.07 },
      nightOn: { value: 1.0 },
      zonesOn: { value: 0.0 }
    };
    var earthMat = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: VERT,
      fragmentShader: EARTH_FRAG
    });
    var earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), earthMat);
    earth.name = 'earth';
    scene.add(earth);

    // ---------- 云层 ----------
    var cloudMesh = null;
    if (cloudMap) {
      var cloudMat = new THREE.ShaderMaterial({
        uniforms: {
          cloudMap: { value: cloudMap },
          sunDir: earthUniforms.sunDir
        },
        vertexShader: VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false
      });
      cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 64, 64), cloudMat);
      cloudMesh.name = 'clouds';
      scene.add(cloudMesh);
    }

    // ---------- 大气辉光 ----------
    var atmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: earthUniforms.sunDir },
      vertexShader: VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    var atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.14, 48, 48), atmoMat);
    atmo.name = 'atmo';
    scene.add(atmo);

    // ---------- 经纬网 / 五带 ----------
    var gridGroup = buildGraticule();
    scene.add(gridGroup);

    // ---------- 晨昏线 ----------
    var terminator = makeTerminator();
    scene.add(terminator);

    // ---------- 直射点标记 ----------
    var subGroup = new THREE.Group();
    var subDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd36b })
    );
    subGroup.add(subDot);
    var subLabel = H.makeLabel('太阳直射点', { color: '#ffd36b', size: 34, scale: 0.075 });
    subGroup.add(subLabel);
    scene.add(subGroup);

    // ---------- 观测点标记 ----------
    var obsGroup = new THREE.Group();
    var obsDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x4ea1ff })
    );
    obsGroup.add(obsDot);
    var obsLabel = H.makeLabel('观测点', { color: '#7fc4ff', size: 32, scale: 0.07 });
    obsGroup.add(obsLabel);
    var obsStick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.09, 0)]),
      new THREE.LineBasicMaterial({ color: 0x4ea1ff, transparent: true, opacity: 0.7 })
    );
    obsGroup.add(obsStick);
    scene.add(obsGroup);

    // ---------- 地轴 ----------
    var axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.32, 0), new THREE.Vector3(0, 1.32, 0)
      ]),
      new THREE.LineDashedMaterial({
        color: 0x9db4dd, transparent: true, opacity: 0.5, dashSize: 0.08, gapSize: 0.06
      })
    );
    axis.computeLineDistances();
    scene.add(axis);
    var axisLabel = H.makeLabel('地轴', { color: '#9db4dd', size: 30, scale: 0.06 });
    axisLabel.position.set(0, 1.4, 0);
    scene.add(axisLabel);
    var npLabel = H.makeLabel('北极', { color: '#dbe6ff', size: 28, scale: 0.055 });
    npLabel.position.set(0, 1.13, 0.05);
    scene.add(npLabel);

    // ---------- 太阳与平行光线 ----------
    var sunSprite = H.makeSunSprite(7);
    scene.add(sunSprite);
    var rayGroup = new THREE.Group();
    scene.add(rayGroup);
    var rayMat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.22 });
    for (var i = 0; i < 5; i++) {
      var ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)
      ]), rayMat);
      rayGroup.add(ln);
    }

    // ---------- 交互 ----------
    var orbit = null;
    var dragging = false, downX = 0, downY = 0, moved = 0;
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var onStateChanged = null;

    function onPointerDown(e) {
      dragging = true; downX = e.clientX; downY = e.clientY; moved = 0;
    }
    function onPointerMove(e) {
      if (!dragging) return;
      moved = Math.max(moved, Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY));
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      if (moved > 8) return;
      var rect = ctx.dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      var hit = raycaster.intersectObject(earth, false);
      if (hit.length && onStateChanged) {
        var p = hit[0].point.clone().normalize();
        var lat = Math.asin(Math.max(-1, Math.min(1, p.y))) * 180 / Math.PI;
        var lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
        onStateChanged(lat, lon);
      }
    }

    // ---------- 内部更新 ----------
    var sunDir = new THREE.Vector3(1, 0, 0);
    var tmpV = new THREE.Vector3();
    var q = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 0, 1);

    function update(state, astro) {
      var del = astro.declination(state.dayOfYear);
      var lons = astro.subsolarLon(state.utcHours);
      sunDir.copy(H.latLonToVec3(del, lons, 1)).normalize();
      earthUniforms.sunDir.value.copy(sunDir);
      earthUniforms.nightOn.value = state.show && state.show.nightLights ? 1.0 : 0.0;
      earthUniforms.zonesOn.value = state.show && state.show.fiveZones ? 1.0 : 0.0;

      // 晨昏线环：与太阳方向垂直
      q.setFromUnitVectors(up, sunDir);
      terminator.quaternion.copy(q);
      terminator.visible = !!(state.show && state.show.terminator);

      // 直射点
      var sp = H.latLonToVec3(del, lons, R * 1.005);
      subGroup.position.copy(sp);
      subDot.position.set(0, 0, 0);
      subLabel.position.copy(sp.clone().multiplyScalar(0.16));
      subLabel.position.y += 0.02;

      // 观测点
      var op = H.latLonToVec3(state.observerLat, state.observerLon, R * 1.004);
      obsGroup.position.copy(op);
      obsDot.position.set(0, 0, 0);
      obsStick.rotation.set(0, 0, 0);
      obsLabel.position.copy(op.clone().multiplyScalar(0.14));
      obsLabel.position.y += 0.03;

      // 太阳
      tmpV.copy(sunDir).multiplyScalar(24);
      sunSprite.position.copy(tmpV);

      // 平行光线：垂直于 sunDir 的两个方向
      var perp1 = new THREE.Vector3(0, 1, 0).cross(sunDir);
      if (perp1.lengthSq() < 0.01) perp1.set(1, 0, 0);
      perp1.normalize();
      var perp2 = new THREE.Vector3().crossVectors(sunDir, perp1).normalize();
      var children = rayGroup.children;
      for (var k = 0; k < children.length; k++) {
        var off = (k - 2) * 0.62;
        var base = sunDir.clone().multiplyScalar(1.25).addScaledVector(perp1, off);
        var tip = sunDir.clone().multiplyScalar(4.2).addScaledVector(perp1, off);
        var geo = children[k].geometry;
        geo.setFromPoints([base, tip]);
        geo.attributes.position.needsUpdate = true;
      }
      // 云层
      if (cloudMesh) cloudMesh.visible = !!(state.show && state.show.clouds);
      // 经纬网
      gridGroup.visible = !!(state.show && state.show.graticule);
      gridGroup.children.forEach(function (c) {
        if (c.name === 'special') c.visible = !!(state.show && state.show.graticule);
      });
    }

    var api = {
      scene: scene,
      camera: camera,
      update: update,
      tick: function (dt) { if (orbit) orbit.update(dt); },
      setView: function (view) {
        var v = VIEWS[view] || VIEWS.side;
        if (orbit) orbit.setAngles(v.theta, v.phi, v.radius);
      },
      onPick: function (fn) { onStateChanged = fn; },
      activate: function () {
        if (orbit) return;
        orbit = H.createOrbit(camera, ctx.dom, {
          target: new THREE.Vector3(0, 0, 0),
          minDist: 1.35, maxDist: 6.5
        });
        ctx.dom.addEventListener('pointerdown', onPointerDown);
        ctx.dom.addEventListener('pointermove', onPointerMove);
        ctx.dom.addEventListener('pointerup', onPointerUp);
      },
      deactivate: function () {
        if (orbit) { orbit.dispose(); orbit = null; }
        ctx.dom.removeEventListener('pointerdown', onPointerDown);
        ctx.dom.removeEventListener('pointermove', onPointerMove);
        ctx.dom.removeEventListener('pointerup', onPointerUp);
      },
      resize: function (w, h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      },
      dispose: function () {
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        });
      }
    };
    return api;
  }

  global.MODELS = global.MODELS || {};
  global.MODELS.M1 = createM1;
})(typeof window !== 'undefined' ? window : globalThis);
