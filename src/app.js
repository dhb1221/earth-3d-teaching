/* ============================================================
 * app.js — 主控：状态、贴图、模型切换、主循环、UI、题库
 * ============================================================ */
(function (global) {
  'use strict';

  var THREE = global.THREE;
  var Astro = global.Astro;
  var H = global.H;

  /* ---------------- 状态 ---------------- */
  var S = {
    dayOfYear: 173,
    utcHours: 4,
    observerLat: 40,
    observerLon: 116.4,
    playing: false,
    speed: 10,
    model: 'M1',
    view: 'side',
    tz: 8,
    show: { graticule: true, terminator: true, clouds: true, nightLights: true, fiveZones: false }
  };

  var TEX_FILES = {
    day: 'earth_day.jpg',
    night: 'earth_night.png',
    normal: 'earth_normal.jpg',
    specular: 'earth_specular.jpg',
    clouds: 'earth_clouds.png'
  };

  var TEXTURES = {};
  var dom = {};
  var renderer = null;
  var models = {};
  var W = 1, Hh = 1, DPR = 1;
  var dirty = true;
  var lastT = 0;
  var quizTimer = 0;
  var readoutT = 0;
  var hintTimer = 0;

  var IS_3D = { M1: true, M2: true, M3: true };
  var IS_2D = { M4: true, M5: true };

  var MODEL_META = {
    M1: {
      tip: '空间模型：宇宙视角看地球，太阳光平行射来。点击地球可设置观测点。',
      legend: [['#ffd36b', '昼半球'], ['#22305a', '夜半球'], ['#ff7a2f', '晨昏线'],
               ['#ffd36b', '太阳直射点'], ['#4ea1ff', '观测点']]
    },
    M2: {
      tip: '天球模型：站在地面仰望，太阳一日的运行轨迹（太阳视运动）。',
      legend: [['#ffd36b', '太阳视运动轨迹'], ['#ff7a2f', '日出/日落点'],
               ['#4ea1ff', '地平圈'], ['#ff6b8a', '正午位置']]
    },
    M3: {
      tip: '地面视角：看太阳高度与方位，标杆影子的方向和长短实时变化。',
      legend: [['#ffd36b', '太阳'], ['#8fa6cc', '标杆影子'], ['#4ea1ff', '地面方向']]
    },
    M4: {
      tip: '平面轨迹图：把太阳视运动画成一张平面图，适合做题时判断日出日落方位。',
      legend: [['#ffd36b', '昼间轨迹'], ['#ff7a2f', '日出/日落'], ['#5ad8ff', '当前时刻']]
    },
    M5: {
      tip: '光照图：极点上空俯视，一眼看清昼半球、夜半球、晨昏线是晨线还是昏线。',
      legend: [['#f0c46a', '昼半球'], ['#16213f', '夜半球'], ['#ff7a2f', '晨昏线']]
    }
  };

  /* ---------------- DOM ---------------- */
  function $(sel) { return document.querySelector(sel); }
  function $id(id) { return document.getElementById(id); }

  function cacheDom() {
    dom.stage = $id('stage');
    dom.topbar = $id('topbar');
    dom.gl = $id('gl');
    dom.c2d = $id('c2d');
    dom.loading = $id('loading');
    dom.loadText = $id('loadText');
    dom.toast = $id('toast');
    dom.hint = $id('hint');
    dom.tabs = $id('modelTabs');
    dom.viewBtns = $id('viewBtns');
    dom.panel = $id('panel');
    dom.quizPanel = $id('quizPanel');
    dom.quizList = $id('quizList');
    dom.dateRange = $id('dateRange');
    dom.dateOut = $id('dateOut');
    dom.timeRange = $id('timeRange');
    dom.timeOut = $id('timeOut');
    dom.tzSel = $id('tzSel');
    dom.playBtn = $id('playBtn');
    dom.speedSel = $id('speedSel');
    dom.latRange = $id('latRange');
    dom.latOut = $id('latOut');
    dom.lonRange = $id('lonRange');
    dom.lonOut = $id('lonOut');
    dom.readout = $id('readout');
    dom.legend = $id('legend');
    dom.modelTip = $id('modelTip');
    dom.btnPanel = $id('btnPanel');
    dom.btnPanelClose = $id('btnPanelClose');
    dom.btnQuiz = $id('btnQuiz');
    dom.quizClose = $id('quizClose');
    dom.quizRefresh = $id('quizRefresh');
    dom.panelBtn = $id('btnPanel');
  }

  /* ---------------- 提示 ---------------- */
  function toast(msg, ms) {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { dom.toast.classList.remove('show'); }, ms || 1900);
  }

  /* ---------------- 贴图 ---------------- */
  function makeFlat(rgb) {
    var c = document.createElement('canvas');
    c.width = 8; c.height = 4;
    var g = c.getContext('2d');
    g.fillStyle = rgb;
    g.fillRect(0, 0, 8, 4);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  function loadTextures(done) {
    var assets = global.__ASSETS__ || null;
    // ?fast=1：跳过贴图（用纯色占位），自动化测试/弱设备快速启动
    if (/[?&]fast=1/.test(global.location.search)) {
      TEXTURES.day = makeFlat('#27476e');
      TEXTURES.night = makeFlat('#04060c');
      TEXTURES.specular = makeFlat('#000000');
      setTimeout(done, 0);
      return;
    }
    var keys = Object.keys(TEX_FILES);
    var left = keys.length;
    var finished = false;
    var loader = new THREE.TextureLoader();

    function finish() {
      if (finished) return;
      finished = true;
      done();
    }
    var guard = setTimeout(function () {
      keys.forEach(function (k) {
        if (!TEXTURES[k]) TEXTURES[k] = null;
      });
      finish();
    }, 8000);

    keys.forEach(function (k) {
      var src = (assets && assets[k]) ? assets[k] : ('textures/' + TEX_FILES[k]);
      loader.load(src, function (tex) {
        tex.anisotropy = 4;
        tex.wrapS = THREE.RepeatWrapping;
        if (k !== 'day' && k !== 'night') tex.minFilter = THREE.LinearMipmapLinearFilter;
        TEXTURES[k] = tex;
        if (--left <= 0) { clearTimeout(guard); finish(); }
      }, undefined, function (err) {
        console.warn('[earth-3d] 贴图加载失败:', k, err && err.message);
        TEXTURES[k] = null;
        if (--left <= 0) { clearTimeout(guard); finish(); }
      });
    });
  }

  /* ---------------- 尺寸 ---------------- */
  function measure() {
    DPR = Math.min(global.devicePixelRatio || 1, 2);
    // 顶栏是 fixed 的，2D 模型画标题时要知道让开多少
    if (dom.topbar) S._insetTop = Math.round(dom.topbar.getBoundingClientRect().height) + 10;
    W = dom.stage.clientWidth || global.innerWidth;
    Hh = dom.stage.clientHeight || global.innerHeight;
    if (renderer) {
      renderer.setPixelRatio(DPR);
      renderer.setSize(W, Hh, false);
    }
    var c = dom.c2d;
    c.width = Math.max(1, Math.round(W * DPR));
    c.height = Math.max(1, Math.round(Hh * DPR));
    c._dpr = DPR;
    dirty = true;
  }

  /* ---------------- 模型 ---------------- */
  function modelCtx() {
    return {
      THREE: THREE,
      renderer: renderer,
      dom: dom.stage,
      width: W,
      height: Hh,
      textures: TEXTURES,
      state: S,
      Astro: Astro,
      H: H
    };
  }

  function getModel(id) {
    if (models[id]) return models[id];
    var factory = (global.MODELS || {})[id];
    if (typeof factory !== 'function') return null;
    try {
      models[id] = factory(modelCtx());
    } catch (e) {
      console.error('[earth-3d] 模型 ' + id + ' 初始化失败', e);
      return null;
    }
    return models[id];
  }

  function switchModel(id) {
    if (!MODEL_META[id]) return;
    var prev = models[S.model];
    if (prev && prev.deactivate && S.model !== id) {
      try { prev.deactivate(); } catch (e) {}
    }
    S.model = id;
    dirty = true;

    // 顶栏状态
    Array.prototype.forEach.call(dom.tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-model') === id);
    });
    // M5 本身就是俯视图：进入时若有 side 则落到北极俯视，避免按钮高亮与画面不一致
    if (id === 'M5' && S.view === 'side') S.view = 'north';
    dom.viewBtns.classList.toggle('hidden', !(id === 'M1' || id === 'M5'));
    Array.prototype.forEach.call(dom.viewBtns.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === S.view);
    });
    dom.modelTip.textContent = MODEL_META[id].tip;
    renderLegend();

    // 2D / 3D 切换
    var is2d = !!IS_2D[id];
    dom.gl.style.visibility = is2d ? 'hidden' : 'visible';
    dom.c2d.style.visibility = is2d ? 'visible' : 'hidden';

    var m = getModel(id);
    if (!m) {
      toast('「' + dom.tabs.querySelector('[data-model="' + id + '"]').textContent + '」模块还没加载好，稍后再试');
      return;
    }
    if (m.activate) {
      try { m.activate(); } catch (e) { console.error(e); }
    }
    if (m.resize && !is2d) m.resize(W, Hh);
    applyView();
    updateAll();
  }

  function renderLegend() {
    if (!dom.legend) return;
    var meta = MODEL_META[S.model] || MODEL_META.M1;
    var html = '';
    meta.legend.forEach(function (it) {
      html += '<span style="margin-right:12px;white-space:nowrap"><i style="background:' + it[0] + '"></i>' + it[1] + '</span>';
    });
    dom.legend.innerHTML = html;
  }

  /* ---------------- 主循环 ---------------- */
  function resizeAll() {
    measure();
    Object.keys(models).forEach(function (k) {
      if (!IS_2D[k]) {
        models[k].resize && models[k].resize(W, Hh);
      } else {
        models[k].resize && models[k].resize(W, Hh);
      }
    });
    dirty = true;
  }

  function draw2D(m) {
    var c = dom.c2d;
    var g = c.getContext('2d');
    var d = c._dpr || 1;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, W, Hh);
    try {
      m.draw(g, W, Hh, S, Astro);
    } catch (e) {
      console.error('[earth-3d] 2D 绘制失败', e);
    }
  }

  function drawMissing(g) {
    var c = dom.c2d;
    var d = c._dpr || 1;
    var x = c.getContext('2d');
    x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, W, Hh);
    x.fillStyle = 'rgba(160,185,230,.6)';
    x.font = '14px "PingFang SC",sans-serif';
    x.textAlign = 'center';
    x.fillText('该视图暂不可用', W / 2, Hh / 2);
  }

  function frame(t) {
    requestAnimationFrame(frame);
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0.016;
    lastT = t;

    // 播放推进
    if (S.playing) {
      S.utcHours += dt * S.speed;
      while (S.utcHours >= 24) S.utcHours -= 24;
      if (S.utcHours < 0) S.utcHours += 24;
      dirty = true;
      syncModel();                       // 太阳位置/晨昏线逐帧更新
      readoutT += dt;
      if (readoutT > 0.1) {              // 读数面板 10 帧刷新一次，省性能
        readoutT = 0;
        syncTimeUI();
        updateReadout(currentAstro(), Astro.dayInfo(S.observerLat, S.dayOfYear));
      }
    }

    var id = S.model;
    var m = models[id];
    if (!m) m = getModel(id);

    if (m) {
      if (m.tick) {
        try { m.tick(dt, S, Astro); } catch (e) { console.error(e); }
      }
      if (IS_2D[id]) {
        if (dirty) { draw2D(m); }
      } else if (m.scene && m.camera) {
        if (m.scene.children.length && m.scene.getObjectByName('clouds') && S.show.clouds) {
          // 云层缓慢自转（视觉细节）
          var cl = m.scene.getObjectByName('clouds');
          cl.rotation.y += dt * 0.008;
        }
        renderer.render(m.scene, m.camera);
      }
    } else if (dirty) {
      drawMissing();
    }
    dirty = false;
  }

  /* ---------------- 数据更新 ---------------- */
  function currentAstro() {
    return Astro.sunState(S.dayOfYear, S.utcHours, S.observerLat, S.observerLon);
  }

  function applyView() {
    var m = models[S.model] || getModel(S.model);
    if (m && m.setView) {
      try { m.setView(S.view); } catch (e) { console.error('[earth-3d] setView 失败', e); }
    }
  }

  function syncModel() {
    var m = models[S.model] || getModel(S.model);
    if (m && m.update) {
      try { m.update(S, Astro); } catch (e) { console.error('[earth-3d] ' + S.model + ' update 失败', e); }
    }
    return m;
  }

  function updateAll() {
    var astro = currentAstro();
    var info = Astro.dayInfo(S.observerLat, S.dayOfYear);
    syncModel();
    updateReadout(astro, info);
    syncTimeUI();
    dirty = true;
    if (dom.quizPanel.classList.contains('open')) scheduleQuiz();
  }

  function syncTimeUI() {
    if (dom.timeRange) dom.timeRange.value = S.utcHours.toFixed(2);
    if (dom.timeOut) dom.timeOut.textContent = Astro.fmtHours(S.utcHours + S.tz);
    if (dom.dateRange) dom.dateRange.value = S.dayOfYear;
    if (dom.dateOut) {
      var d = Astro.nToDate(S.dayOfYear);
      dom.dateOut.textContent = d.month + '月' + d.day + '日';
    }
    if (dom.latRange) dom.latRange.value = S.observerLat;
    if (dom.latOut) dom.latOut.textContent = fmtLat(S.observerLat);
    if (dom.lonRange) dom.lonRange.value = S.observerLon;
    if (dom.lonOut) dom.lonOut.textContent = fmtLon(S.observerLon);
    if (dom.playBtn) {
      dom.playBtn.textContent = S.playing ? '⏸ 暂停' : '▶ 播放';
      dom.playBtn.classList.toggle('on', S.playing);
    }
    if (dom.speedSel) dom.speedSel.value = String(S.speed);
  }

  function fmtLat(v) {
    if (Math.abs(v) < 0.05) return '0°（赤道）';
    if (Math.abs(v) > 89.95) return (v > 0 ? '90°N 北极点' : '90°S 南极点');
    return Math.abs(v).toFixed(1) + '°' + (v > 0 ? 'N' : 'S');
  }
  function fmtLon(v) {
    var a = Math.abs(v);
    var s = a % 1 === 0 ? a.toFixed(0) : a.toFixed(1);
    return s + '°' + (v > 0 ? 'E' : (v < 0 ? 'W' : ''));
  }

  var DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  function azName(az) {
    var i = Math.round(Astro.norm360(az) / 45) % 8;
    return DIRS[i];
  }

  function updateReadout(astro, info) {
    if (!dom.readout) return;
    var term = Astro.solarTerm(S.dayOfYear);
    var rows = [];
    var subsolarLat = astro.decl;
    rows.push(['太阳直射点', fmtLat(subsolarLat) + ' / ' + fmtLon(astro.subsolarLon)]);
    rows.push(['观测点', fmtLat(S.observerLat) + ' ' + fmtLon(S.observerLon)]);
    rows.push(['地方太阳时', Astro.fmtHours(astro.lst)]);
    rows.push(['区时（时区 ' + (S.tz >= 0 ? '+' : '') + S.tz + '）', Astro.fmtHours(S.utcHours + S.tz)]);
    rows.push(['太阳高度角', astro.alt > 0 ? astro.alt.toFixed(1) + '°' : '在地平线下']);
    rows.push(['太阳方位', astro.alt > 0 ? azName(astro.az) + '（' + astro.az.toFixed(0) + '°）' : '—']);
    var dstr;
    if (info.polarDay) dstr = '极昼（24 小时）';
    else if (info.polarNight) dstr = '极夜（0 小时）';
    else dstr = Astro.fmtDuration(info.hours);
    rows.push(['昼长', dstr]);
    rows.push(['日出 / 日落', info.polarDay ? '太阳不落' : (info.polarNight ? '太阳不出' :
      Astro.fmtHours(info.sunriseLST) + ' / ' + Astro.fmtHours(info.sunsetLST))]);
    rows.push(['正午太阳高度', info.noonAlt.toFixed(1) + '°']);
    rows.push(['五带', Astro.fiveZone(S.observerLat)]);
    rows.push(['节气（近似）', term || '非节气日']);

    var html = '';
    rows.forEach(function (r) {
      html += '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>';
    });
    // 影子（M3 相关，也放一行）
    if (astro.alt > 1) {
      var shadowDir = azName(astro.az + 180);
      html += '<div class="full"><span class="k">标杆影子</span><span class="v">朝 ' +
        shadowDir + '，长 ' + (1.5 / Math.tan(astro.alt * Astro.DEG)).toFixed(1) + ' 米</span></div>';
    }
    dom.readout.innerHTML = html;
  }

  /* ---------------- 题库 ---------------- */
  function renderQuiz() {
    if (!dom.quizList) return;
    var Quiz = global.Quiz;
    if (!Quiz || typeof Quiz.generate !== 'function') {
      dom.quizList.innerHTML = '<div class="q"><div class="qt">题库模块加载中…</div></div>';
      return;
    }
    var list;
    try {
      list = Quiz.generate(S, Astro) || [];
    } catch (e) {
      console.error('[earth-3d] 题库生成失败', e);
      dom.quizList.innerHTML = '<div class="q"><div class="qt">出题失败：' + (e && e.message) + '</div></div>';
      return;
    }
    var html = '';
    list.forEach(function (q, qi) {
      html += '<div class="q" data-q="' + qi + '"><div class="qt">' + (qi + 1) + '. ' + q.q + '</div>';
      html += '<div class="opts">';
      (q.options || []).forEach(function (op, oi) {
        html += '<button class="opt" data-i="' + oi + '">' + String.fromCharCode(65 + oi) + '. ' + op + '</button>';
      });
      html += '</div><div class="ex" style="display:none"></div></div>';
    });
    dom.quizList.innerHTML = html;

    Array.prototype.forEach.call(dom.quizList.querySelectorAll('.q'), function (el) {
      var qi = +el.getAttribute('data-q');
      var q = list[qi];
      var ex = el.querySelector('.ex');
      Array.prototype.forEach.call(el.querySelectorAll('.opt'), function (btn) {
        btn.addEventListener('click', function () {
          if (el.getAttribute('data-done')) return;
          el.setAttribute('data-done', '1');
          var oi = +btn.getAttribute('data-i');
          Array.prototype.forEach.call(el.querySelectorAll('.opt'), function (b) {
            var bi = +b.getAttribute('data-i');
            if (bi === q.answer) b.classList.add('right');
            else if (bi === oi) b.classList.add('wrong');
          });
          ex.style.display = 'block';
          ex.innerHTML = (oi === q.answer ? '✅ 回答正确。' : '❌ 正确答案 ' +
            String.fromCharCode(65 + q.answer) + '。') + (q.explain || '');
        });
      });
    });
  }

  function scheduleQuiz() {
    clearTimeout(quizTimer);
    quizTimer = setTimeout(renderQuiz, 350);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindUI() {
    // 模型 tab
    dom.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-model]');
      if (b) switchModel(b.getAttribute('data-model'));
    });

    // 视角按钮（M1）
    dom.viewBtns.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (!b) return;
      S.view = b.getAttribute('data-view');
      Array.prototype.forEach.call(dom.viewBtns.querySelectorAll('button'), function (x) {
        x.classList.toggle('on', x === b);
      });
      var m = getModel(S.model);
      if (m && m.setView) m.setView(S.view);
      updateAll();
    });

    // 日期
    dom.dateRange.addEventListener('input', function () {
      S.dayOfYear = +dom.dateRange.value;
      updateAll();
    });
    // 时刻
    dom.timeRange.addEventListener('input', function () {
      S.utcHours = +dom.timeRange.value;
      S.playing = false;
      updateAll();
    });
    // 时区
    dom.tzSel.addEventListener('change', function () {
      S.tz = +dom.tzSel.value;
      syncTimeUI();
      updateAll();
    });
    // 播放
    dom.playBtn.addEventListener('click', function () {
      S.playing = !S.playing;
      syncTimeUI();
    });
    dom.speedSel.addEventListener('change', function () {
      S.speed = +dom.speedSel.value;
    });
    // 观测点
    dom.latRange.addEventListener('input', function () {
      S.observerLat = +dom.latRange.value;
      updateAll();
    });
    dom.lonRange.addEventListener('input', function () {
      S.observerLon = +dom.lonRange.value;
      updateAll();
    });

    // 预设
    document.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-preset');
        var map = { chunfen: 80, xiazhi: 172, qiufen: 266, dongzhi: 356 };
        if (k === 'today') S.dayOfYear = Astro.todayN();
        else S.dayOfYear = map[k];
        S.playing = false;
        updateAll();
        toast(b.textContent + '：太阳直射 ' + fmtLat(Astro.declination(S.dayOfYear)));
      });
    });

    // 快捷地点
    document.querySelectorAll('[data-place]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-place').split(',');
        S.observerLat = +p[0];
        S.observerLon = +p[1];
        updateAll();
        toast('观测点：' + b.textContent);
      });
    });

    // 显示开关
    document.querySelectorAll('[data-toggle]').forEach(function (cb) {
      var k = cb.getAttribute('data-toggle');
      cb.checked = !!S.show[k];
      cb.addEventListener('change', function () {
        S.show[k] = cb.checked;
        updateAll();
      });
    });

    // 面板
    dom.panelBtn.addEventListener('click', function () { dom.panel.classList.toggle('open'); });
    dom.btnPanelClose.addEventListener('click', function () { dom.panel.classList.remove('open'); });
    // 题库
    dom.btnQuiz.addEventListener('click', function () {
      dom.quizPanel.classList.toggle('open');
      if (dom.quizPanel.classList.contains('open')) renderQuiz();
    });
    dom.quizClose.addEventListener('click', function () { dom.quizPanel.classList.remove('open'); });
    dom.quizRefresh.addEventListener('click', renderQuiz);

    // 键盘
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); S.playing = !S.playing; syncTimeUI(); }
      if (e.altKey && e.key >= '1' && e.key <= '5') switchModel('M' + e.key);
      if (e.key === 'ArrowRight') { S.utcHours = (S.utcHours + 1) % 24; updateAll(); }
      if (e.key === 'ArrowLeft') { S.utcHours = (S.utcHours + 23) % 24; updateAll(); }
    });

    // 尺寸
    var rsz = null;
    function onResize() {
      clearTimeout(rsz);
      rsz = setTimeout(resizeAll, 120);
    }
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);
  }

  /* ---------------- M1 点击拾取观测点 ---------------- */
  function wirePick() {
    var m = getModel('M1');
    if (m && m.onPick) {
      m.onPick(function (lat, lon) {
        S.observerLat = Math.round(lat * 2) / 2;
        S.observerLon = Math.round(lon);
        updateAll();
        toast('观测点已设为 ' + fmtLat(S.observerLat) + ' ' + fmtLon(S.observerLon));
      });
    }
  }

  /* ---------------- 启动 ---------------- */
  /* ---------------- URL 参数：方便老师分享预设情景 ---------------- */
  // 例：index.html?model=M4&date=172&time=12&lat=40&lon=116.4&view=north&play=1
  function applyUrlParams() {
    var q = {};
    try {
      var raw = String(global.location.search || '').replace(/^\?/, '');
      raw.split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
        var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
        q[k] = v;
      });
    } catch (e) { return; }

    function num(k, min, max) {
      if (q[k] === undefined || q[k] === '') return null;
      var v = parseFloat(q[k]);
      return isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
    }
    var v;
    if ((v = num('date', 1, 366)) !== null) S.dayOfYear = Math.round(v);
    if ((v = num('time', 0, 24)) !== null) S.utcHours = v;
    if ((v = num('lat', -90, 90)) !== null) S.observerLat = v;
    if ((v = num('lon', -180, 180)) !== null) S.observerLon = v;
    if ((v = num('tz', -12, 14)) !== null) S.tz = Math.round(v);
    if (q.view && /^(side|north|south)$/.test(q.view)) S.view = q.view;
    if (q.debug === '1' && dom.loadText) {
      dom.loadText.textContent = 'W=' + W + ' H=' + Hh + ' inset=' + S._insetTop +
        ' stage=' + (dom.stage && dom.stage.clientWidth) + ' docW=' + document.documentElement.clientWidth +
        ' scrollW=' + document.documentElement.scrollWidth;
      dom.loading.classList.remove('hide');
    }
    if (q.model && MODEL_META[q.model]) S.model = q.model;
    if (q.play === '1' || q.play === 'true') S.playing = true;
    if (q.night === '0') S.show.nightLights = false;
    if (q.clouds === '0') S.show.clouds = false;
    if (q.graticule === '0') S.show.graticule = false;
    if (q.terminator === '0') S.show.terminator = false;
    if (q.zones === '1') S.show.fiveZones = true;
    if (q.quiz === '1') { /* 由调用方打开题库 */ S._openQuiz = true; }
  }

  function boot() {
    cacheDom();
    measure();

    // 截图/自动化用：nosplash=1 立刻隐藏启动遮罩并关掉过渡动画，方便稳定截图
    if (/[?&]nosplash=1/.test(global.location.search)) {
      if (dom.loading) dom.loading.classList.add('hide');
      document.body.classList.add('no-hint', 'no-anim');
    }

    // 依次尝试几组参数：有些驱动（软件渲染、老手机）对组合挑食
    var rendererOpts = [
      { antialias: true, alpha: false },
      { antialias: false, alpha: false },
      { antialias: true },
      { antialias: false },
    ];
    var lastErr = null;
    for (var oi = 0; oi < rendererOpts.length && !renderer; oi++) {
      try {
        renderer = new THREE.WebGLRenderer(Object.assign({ canvas: dom.gl }, rendererOpts[oi]));
      } catch (e) {
        lastErr = e;
        console.warn('[earth-3d] WebGL 参数组合 ' + oi + ' 不可用：' + e.message);
      }
    }
    if (!renderer) {
      console.error('[earth-3d] WebGL 初始化失败', lastErr);
      if (dom.loadText) dom.loadText.textContent = '这台设备/浏览器没有开启 WebGL，3D 视图用不了（可换 Chrome 或开启硬件加速）';
      var sp = dom.loading && dom.loading.querySelector('.spin');
      if (sp) sp.style.display = 'none';
      return;
    }
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, Hh, false);
    renderer.setClearColor(0x05070f, 1);
    global.APP.renderer = renderer;

    // 上下文丢失时给出提示而不是黑屏；恢复后自动继续
    dom.gl.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      console.warn('[earth-3d] WebGL 上下文丢失');
      if (global.__glLostHandler) global.__glLostHandler();
      toast('图形上下文丢失（显卡资源紧张或驱动重置），正在尝试恢复…', 4000);
    }, false);
    dom.gl.addEventListener('webglcontextrestored', function () {
      console.warn('[earth-3d] WebGL 上下文已恢复');
      toast('图形上下文已恢复', 1800);
    }, false);

    bindUI();

    loadTextures(function () {
      var missing = Object.keys(TEX_FILES).filter(function (k) { return !TEXTURES[k]; });
      if (missing.length) {
        TEXTURES.day = TEXTURES.day || makeFlat('#27476e');
        TEXTURES.night = TEXTURES.night || makeFlat('#04060c');
        TEXTURES.specular = TEXTURES.specular || makeFlat('#000000');
        console.warn('[earth-3d] 使用占位贴图:', missing.join(','));
        if (missing.indexOf('day') >= 0) toast('贴图没加载到，先用纯色地球顶着（离线打开时请用单文件版）', 3200);
      }
      dom.loading.classList.add('hide');

      applyUrlParams();
      switchModel(S.model || 'M1');
      if (S._openQuiz) { dom.quizPanel.classList.add('open'); renderQuiz(); }
      wirePick();
      updateAll();
      requestAnimationFrame(frame);
      // 手机首帧前布局可能还没稳定，量一次尺寸再重绘，避免 2D 图被裁
      global.addEventListener('load', function () { resizeAll(); });
      setTimeout(function () { resizeAll(); updateAll(); }, 260);

      setTimeout(function () { document.body.classList.add('no-hint'); }, 6500);
      // 桌面：面板默认展开；手机：收起（点 ☰ 打开）
      if (global.innerWidth < 820) dom.panel.classList.remove('open');
      else dom.panel.classList.add('open');
    });
  }

  global.APP = {
    state: S,
    textures: TEXTURES,
    dom: dom,
    renderer: null,
    refresh: updateAll,
    switchModel: switchModel,
    toast: toast,
    fmtLat: fmtLat,
    fmtLon: fmtLon,
    azName: azName,
    getModel: getModel
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
