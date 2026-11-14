# 项目契约：3D 地球教具（高中地理）

## 目标
单文件网页 `dist/earth-3d.html`：可交互 3D 地球 + 5 个联动模型视图，
覆盖高中地理必修一「地球的运动」考点。可离线运行（three.js 与脚本内联，贴图在 ./textures/）。

## 目录与构建
```
earth-3d/
  index.html        模板（引 vendor/three.min.js + src/*.js + styles.css）
  styles.css        UI 样式
  src/astro.js      天文计算（已完成）
  src/helpers.js    三维公共工具（已完成）
  src/app.js        主控：状态、UI、M1 地球场景、模型切换、主循环（lead 写）
  src/m2-sky.js     M2 天球模型        ← 队友 A
  src/m3-ground.js  M3 地面视角        ← 队友 A
  src/m4-chart.js   M4 平面轨迹图      ← 队友 B
  src/m5-cross.js   M5 光照图          ← 队友 B
  src/quiz.js       考点题库           ← 队友 B
  build.mjs         把所有脚本内联成 dist/earth-3d.html（lead 写）
  textures/         earth_day.jpg 等 5 张贴图
  vendor/three.min.js
```
每个 src 文件都是 IIFE，`(function(global){ ... })(window)` 风格，**不写 import/export**，
挂到 `window.MODELS` 或 `window.Quiz` 上。

## 全局对象
- `window.THREE`：three r150 UMD
- `window.Astro`：见 src/astro.js（已提供）
  - `declination(N)`、`subsolarPoint(N,utc)`、`subsolarLon(utc)`
  - `sunState(N, utc, lat, lon)` → `{decl, subsolarLon, hourAngle, alt, az, lst, utc}`
    （alt 高度角，az 方位角：0=北, 90=东）
  - `dayInfo(lat, N)` → `{hours, sunriseLST, sunsetLST, noonAlt, polarDay, polarNight, decl}`
  - `sunriseUTC(lat,N,lon)` → `{sunrise,sunset}`（UTC 小时）
  - `noonAltitude(lat,N)`、`fiveZone(lat)`、`solarTerm(N)`、`sampleDay(lat,lon,N,stepMin)`
  - `latLonToVec3(lat,lon,r)`（返回 THREE.Vector3）、`fmtHours(h)`、`fmtDuration(h)`
  - `dateToN(m,d,y)`、`nToDate(N,y)`、`todayN()`
- `window.H`：helpers.js（已提供）
  - `H.makeLabel(text,{color,size,scale,bg,bold})` → Sprite
  - `H.makeLine(points[], color, {dashed,opacity,dashSize,gapSize})` → Line
  - `H.makeCircleLine(radius, color, {segments,dashed,opacity})` → Line
  - `H.makeSunSprite(size)` → Sprite（加色光晕）
  - `H.latLonToVec3(lat,lon,r)` → Vector3
  - `H.createOrbit(camera, domElement, {target,minDist,maxDist})` → `{update(dt), setAngles(theta,phi,radius), snap(), setTarget(v), dispose(), dom}`
  - `H.PALETTE`：{bg:'#05070f', accent:'#4ea1ff', warm:'#ff8a3d', sun:'#ffd36b',
    grid:'rgba(180,205,255,0.22)', text:'#dbe6ff', day:'#ffd36b', night:'#2b3a63',
    terminator:'#ff7a2f'}
- `window.APP`（lead 提供）
  - `APP.state`：见下
  - `APP.textures`：`{day, night, normal, specular, clouds}`，THREE.Texture 或 null
  - `APP.dom`：整个 3D 画布的容器 div（事件绑定用它）
  - `APP.registerModel(id, factory)`

## 状态（唯一数据源，所有模型共享）
```js
{
  dayOfYear: 173,      // 年积日 1–365（6/22 = 173）
  utcHours: 4,         // UTC 时刻 0–24（北京 12:00 = UTC 4）
  observerLat: 40,     // 观测点纬度 -90–90
  observerLon: 116.4,  // 观测点经度 -180–180
  playing: false, speed: 1,
  model: 'M1',         // M1 M2 M3 M4 M5
  tz: 8,               // 面板显示时区（北京=8）
  show: { graticule: true, terminator: true, clouds: true,
          fiveZones: false, nightLights: true }
}
```
派生量一律现算：`var s = Astro.sunState(S.dayOfYear, S.utcHours, S.observerLat, S.observerLon)`。

## 模型 API

### 3D 模型（M2 / M3）
```js
window.MODELS = window.MODELS || {};
window.MODELS.M2 = function createM2(ctx) {
  // ctx = { THREE, renderer, dom, width, height, textures, state, Astro, H }
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, ctx.width/ctx.height, 0.1, 500);
  return {
    scene: scene,
    camera: camera,
    update: function (state, astro) { /* 状态变化时重算 */ },
    tick: function (dt, state, astro) { /* 每帧，可选 */ },
    activate: function () { /* 切换到此模型时，创建 orbit、绑定事件 */ },
    deactivate: function () { /* 离开时销毁 orbit、移除场景内监听 */ },
    resize: function (w, h) { camera.aspect = w/h; camera.updateProjectionMatrix(); },
    dispose: function () { /* 释放 geometry/material */ }
  };
};
```
主循环：状态变化或每帧调用 `update`/`tick`，然后 `renderer.render(active.scene, active.camera)`。

### 2D 模型（M4 / M5）
```js
window.MODELS.M4 = function createM4(ctx) {
  return {
    draw: function (c2d, width, height, state, astro) { /* 画到 2D canvas */ },
    resize: function (w, h) {},
    dispose: function () {}
  };
};
```
`c2d` 已按 devicePixelRatio 缩放，坐标直接用 CSS 像素；只在状态变化时重绘。

## 坐标系
- **地球坐标系（M1 用）**：y 轴 = 北极，x 轴 = 0° 经线，−z 轴 = 90°E 方向。
  一律用 `Astro.latLonToVec3(lat, lon, r)` 或 `H.latLonToVec3`。
- **地平坐标系（M2 / M3 用）**：x = 东，y = 天顶，z = 北。
  太阳单位方向：`(cos(alt)·sin(az), sin(alt), cos(alt)·cos(az))`。
- 时间：`utcHours` 是 UTC；观测点地方太阳时 = `utcHours + observerLon/15`。
  面板显示用 `utcHours + state.tz`（默认北京时间）。

## 各模块验收标准

### M2 天球模型（src/m2-sky.js）
- 地平圈半径 10，方位刻度每 30°，N/E/S/W 四方向标签（N 在 +z，E 在 +x，S 在 −z，W 在 −x）
- 天顶标签在 (0,10,0)；观测者小标记在原点并带「观测者」标签
- 太阳一日视运动轨迹：用 `Astro.sampleDay(lat, lon, N, 10)` 采样，半径 R=8；
  地平线以上实线金色，以下虚线暗色；轨迹随日期/纬度重建
- 当前太阳：小球 + `H.makeSunSprite` 光晕，位置 = 方向 × 8
- 日出点、日落点：在地平圈上用标记 + 标签「日出 东北 05:12」样式（方位用中文：东/东北/东南/南/西南/西/西北/北）
- 正午点：轨迹最高点，标签「正午 高度 73.4°」
- 观测者到太阳的连线（虚线）+ 高度角数值标签
- 极昼时轨迹闭合成整圈、极夜时太阳不出现的文案
- 相机初始 (13, 9, 15) 看向 (0,3,0)，用 `H.createOrbit`，minDist 8 maxDist 35
- activate 创建 orbit（dom 用 ctx.dom）；deactivate 销毁

### M3 地面视角（src/m3-ground.js）
- 地面：半径 60 的圆盘（或方片），深色，带地面纹理感（纯色即可）
- 天空：半径 200 的 BackSide 球，颜色随太阳高度渐变（alt>15° 深蓝、0–15° 橙红渐变、<0° 近黑）
- 太阳：方向 × 150 的 Sprite（`H.makeSunSprite(26)`），随 alt/az 移动；alt<−2° 隐藏
- 标杆：高 1.5，位于原点；影子：在地面上从杆底出发，方向 = az + 180°，
  长度 = 1.5 / tan(alt)，夹在 [0, 40]；alt<2° 时影子极长提示
- 地面四个方向标签：北/东/南/西（半径 30 处）
- 相机：位于原点附近 (0, 1.6, 0)，看向 op 方向（默认朝北），用 H.createOrbit，
  target=(0,3,0)，minDist 5 maxDist 25；activate/deactivate 同 M2
- 角落文字可选：在 update 里更新「影子朝 西南，长度 2.1 米」由 app 面板负责，模块不做 DOM

### M4 平面轨迹图（src/m4-chart.js）
- 画布自适应：正方形居中，半径 = min(w,h)*0.36
- 极坐标：圆心 = 天顶，外圈 = 地平线；角度 = 方位角（北在正上方，顺时针），
  半径 = (90 − alt)/90 × R
- 画方位刻度（每 30° + N/E/S/W 标签）和高度圈（30°、60°）
- 画当日太阳轨迹：`Astro.sampleDay`，alt > 0 的部分亮金色实线，alt ≤ 0 的部分淡虚线
- 标日出/日落点（在地平圈上）、正午点（轨迹最高点）、当前时刻点（呼吸光点）
- 标题：「太阳视运动平面图 · 40.0°N · 6月22日」；左下角显示「正午太阳高度 73.4°」
- 使用 canvas 2D API，颜色用 H.PALETTE，中文字体 "PingFang SC","Microsoft YaHei"

### M5 光照图（src/m5-cross.js）
- 北极上空俯视（可切换到南极上空，加一个 draw 参数或读 state.show 由 app 传）
- 圆心 = 极点；投影：屏幕 x = 地球 X 方向，屏幕 y(向下) = 地球 Z 方向；
  可见半球 y_earth ≥ 0（北极俯视）；像素 p=(x, sqrt(1−x²−z²), z)
- 逐像素着色（画布约 300×300，只在状态变化时重绘，性能可控）：
  `dot(p, sunDir) > 0` 为昼（暖色 #f5c26b 系），否则夜（#16213f 系）；
  边缘加 2px 过渡
- 叠加：赤道（外圈）、南北回归线、南北极圈（同心圆）、每隔 30° 经线、
  晨昏线轮廓（亮橙）、太阳直射点标记、昼半球中心箭头、
  自转方向箭头（北极俯视逆时针）、晨线/昏线文字
- 底部文字：「北极上空俯视 · 6月22日 · 北极圈内极昼」
- 只用 canvas 2D，不引入 3D

### 题库（src/quiz.js）
```js
window.Quiz = {
  generate: function (state, astro) {  // 返回 4 题
    return [{
      q: '此时太阳直射点位于（ ）',
      options: ['北半球', '南半球', '赤道', '无法判断'],
      answer: 0,
      explain: '6月22日太阳直射北回归线附近，位于北半球。'
    }];
  }
};
```
- 题目必须由 state 实时计算生成（不能写死答案）
- 覆盖：直射点位置、昼夜长短、正午太阳高度、极昼极夜、日出方位、地方时/时区
- 题干里带具体数值/地名，解析一句话讲清原因

## 工作纪律
- 只改自己名下的文件，不改别人的
- 不引入外部依赖，不写 ES module
- 每个文件写完后用 `node --check <file>` 验证语法
- 拿不准的 API 先读 src/astro.js / src/helpers.js 源码
- 完成后向 lead 汇报：文件、导出的 API、已知限制
