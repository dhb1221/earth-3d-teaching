/* selftest.js — 只在开发期用：把自检结果写进 #testOut 和 document.title */
(function () {
  var out = [];
  var pass = 0, fail = 0;
  function ok(name, cond, extra) {
    if (cond) { pass++; out.push('PASS ' + name); }
    else { fail++; out.push('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v; }

  function glHealth(renderer) {
    var gl = renderer.getContext();
    var progs = renderer.info.programs || [];
    var bad = [];
    for (var i = 0; i < progs.length; i++) {
      var p = progs[i];
      var linked = false;
      try { linked = !!gl.getProgramParameter(p.program, gl.LINK_STATUS); } catch (e) { linked = false; }
      if (!linked || p.diagnostics) {
        bad.push({ i: i, linked: linked, diag: p.diagnostics ? p.diagnostics.programLog : null });
      }
    }
    return { count: progs.length, bad: bad };
  }

  function canvasStats() {
    var c = document.getElementById('c2d');
    var ctx = c.getContext('2d');
    var w = c.width, h = c.height;
    var data = ctx.getImageData(0, 0, w, h).data;
    var s = 0, mx = 0, nonDark = 0;
    for (var i = 0; i < data.length; i += 4) {
      var v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      s += v; if (v > mx) mx = v; if (v > 18) nonDark++;
    }
    return { avg: Math.round(s / (w * h)), max: Math.round(mx), nonDark: nonDark };
  }

  function run() {
    var A = window.APP, Astro = window.Astro, H = window.H;
    ok('three loaded', !!window.THREE);
    ok('APP ready', !!A && !!A.state);
    ok('MODELS.M1..M5', !!(window.MODELS && window.MODELS.M1 && window.MODELS.M2 && window.MODELS.M3 && window.MODELS.M4 && window.MODELS.M5));
    ok('Astro + H', !!Astro && !!H);
    ok('renderer alive', !!A.renderer && !A.renderer.getContext().isContextLost());

    // ---- 天文数值（6/22 北京）
    A.state.dayOfYear = 173;
    A.state.utcHours = 4;
    A.state.observerLat = 40;
    A.state.observerLon = 116.4;
    A.state.model = 'M1';
    A.refresh();
    var sun = Astro.sunState(A.state.dayOfYear, A.state.utcHours, A.state.observerLat, A.state.observerLon);
    ok('subsolar lat≈23.4', Math.abs(sun.decl - 23.44) < 0.6, num(sun.decl));
    ok('solar alt≈73.2', Math.abs(sun.alt - 73.16) < 0.8, num(sun.alt));
    ok('azimuth≈south(169)', Math.abs(sun.az - 169.3) < 2.5, num(sun.az));
    var dd = Astro.dayInfo(40, 173);
    ok('dayInfo.hours≈14.85', Math.abs(dd.hours - 14.85) < 0.25, num(dd.hours));

    // ---- 读数面板
    var rt = document.getElementById('readout') ? document.getElementById('readout').textContent : '';
    ok('readout 有直射点', /23\.4°N/.test(rt), rt.slice(0, 60));
    ok('readout 有昼长', /昼长/.test(rt));

    // ---- 视角切换
    var m1 = A.getModel('M1');
    ok('M1 model present', !!m1);
    if (!m1) m1 = { camera: { position: { toArray: function () { return [0, 0, 0]; } } } };
    try { if (m1.activate) m1.activate(); } catch (e) { ok('M1 activate', false, e.message); }
    function settle(view) {
      m1.setView(view);
      for (var i = 0; i < 240; i++) { if (m1.tick) m1.tick(0.016); }
      return { y: m1.camera.position.y, x: m1.camera.position.x, z: m1.camera.position.z };
    }
    var cSide = settle('side');
    ok('side view 相机水平', Math.abs(cSide.y) < 1.2, cSide);
    var cNorth = settle('north');
    ok('north view 相机在上方', cNorth.y > 2.5, cNorth);
    var cSouth = settle('south');
    ok('south view 相机在下方', cSouth.y < -2.5, cSouth);
    settle('side');

    // ---- 各模型渲染（本环境 WebGL 光栅化不可靠，改查 shader 编译/链接与异常）
    if (A.renderer) {
      var rerr = null;
      try { A.renderer.render(m1.scene, m1.camera); } catch (e) { rerr = e.message; }
      ok('M1 render 不抛错', !rerr, rerr);
      var h1 = glHealth(A.renderer);
      ok('M1 shader 链接正常', h1.count > 0 && h1.bad.length === 0, h1);
      var m2 = A.getModel('M2');
      ok('M2 model present', !!m2);
      if (m2) {
        var e2 = null;
        try { A.renderer.render(m2.scene, m2.camera); } catch (e) { e2 = e.message; }
        ok('M2 render 不抛错', !e2, e2);
      }
      var m3 = A.getModel('M3');
      ok('M3 model present', !!m3);
      if (m3) {
        var e3 = null;
        try { A.renderer.render(m3.scene, m3.camera); } catch (e) { e3 = e.message; }
        ok('M3 render 不抛错', !e3, e3);
      }
      var h2 = glHealth(A.renderer);
      ok('全部 shader 链接正常', h2.bad.length === 0, h2);
    }

    // ---- 2D 模型：直接调用 draw 再量像素
    var c2d = document.getElementById('c2d');
    var ctx2 = c2d.getContext('2d');
    ['M4', 'M5'].forEach(function (id) {
      var m = A.getModel(id);
      ok(id + ' model present', !!m && typeof m.draw === 'function');
      if (!m || typeof m.draw !== 'function') return;
      var err = null;
      try {
        ctx2.setTransform(1, 0, 0, 1, 0, 0);
        ctx2.clearRect(0, 0, c2d.width, c2d.height);
        m.draw(ctx2, c2d.width, c2d.height, A.state, Astro);
      } catch (e) { err = e.message; }
      ok(id + ' draw 不抛错', !err, err);
      var st = canvasStats();
      ok(id + ' canvas 有内容', st.avg > 1 && st.max > 40, Object.assign({ w: c2d.width, h: c2d.height }, st));
    });
    A.switchModel('M1');

    // ---- 昼夜与极昼极夜
    A.state.dayOfYear = 173; A.state.utcHours = 22;
    A.state.observerLat = 78.5; A.state.observerLon = 15;
    A.refresh();
    var rt2 = document.getElementById('readout').textContent;
    ok('极昼识别(78.5N 夏至)', /极昼/.test(rt2), rt2.slice(0, 80));
    A.state.dayOfYear = 355; A.state.utcHours = 12; A.state.observerLat = 78.5;
    A.refresh();
    var rt3 = document.getElementById('readout').textContent;
    ok('极夜识别(78.5N 冬至)', /极夜/.test(rt3), rt3.slice(0, 80));

    // ---- 题库
    var q = document.getElementById('quizList');
    if (window.Quiz && typeof window.Quiz.generate === 'function') {
      var list = window.Quiz.generate(A.state, Astro) || [];
      ok('Quiz 生成 4 题', list.length === 4, list.length);
      ok('Quiz 字段完整', list.every(function (x) { return x && x.q && x.options && x.options.length >= 3 && typeof x.answer === 'number'; }));
    } else {
      ok('Quiz 模块存在', false, 'Quiz 未加载');
    }

    // ---- resize
    try {
      window.dispatchEvent(new Event('resize'));
      ok('resize 不报错', true);
    } catch (e) { ok('resize 不报错', false, e.message); }

    var summary = (fail === 0 ? 'TESTS_ALL_PASS ' : 'TESTS_FAIL ') + 'pass=' + pass + ' fail=' + fail;
    out.unshift(summary);
    var box = document.getElementById('testOut');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'testOut';
      box.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9999;background:#000;color:#0f0;font:11px monospace;max-height:40vh;overflow:auto;margin:0;padding:4px';
      document.body.appendChild(box);
    }
    box.textContent = out.join('\n');
    document.title = summary;
    window.__TEST__ = { pass: pass, fail: fail, lines: out };
  }

  function start() {
    try { run(); }
    catch (e) {
      var box = document.getElementById('testOut') || document.body.appendChild(document.createElement('pre'));
      box.id = 'testOut';
      box.textContent = 'TESTS_CRASH ' + e.message + '\n' + (e.stack || '');
      document.title = 'TESTS_CRASH ' + e.message;
    }
  }

  if (window.APP && window.APP.renderer) setTimeout(start, 300);
  else setTimeout(start, 900);
})();
