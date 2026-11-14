/* ============================================================
 * build.mjs — 把整个教具内联成单个 HTML（离线可双击打开）
 *   node build.mjs
 * 产出：dist/earth-3d.html（three.js + 脚本 + 样式 + base64 贴图）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');

const SCRIPTS = [
  'vendor/three.min.js',
  'src/astro.js',
  'src/helpers.js',
  'src/m1-earth.js',
  'src/m2-sky.js',
  'src/m3-ground.js',
  'src/m4-chart.js',
  'src/m5-cross.js',
  'src/quiz.js',
  'src/app.js'
];

const TEXTURES = {
  day: 'textures/earth_day.jpg',
  night: 'textures/earth_night.png',
  normal: 'textures/earth_normal.jpg',
  specular: 'textures/earth_specular.jpg',
  clouds: 'textures/earth_clouds.png'
};

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp'
};

function esc(code) {
  // 防止内联脚本里的 </script> 提前闭合
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function kb(n) { return (n / 1024).toFixed(0) + ' KB'; }

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------- 样式 ---------- */
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="styles\.css"\s*\/?>/, '<style>\n' + css + '\n</style>');

/* ---------- 贴图（base64 data URI） ---------- */
const assets = {};
let assetBytes = 0;
for (const [key, rel] of Object.entries(TEXTURES)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn('! 缺少贴图 ' + rel + '（该层会退化为纯色）');
    continue;
  }
  const buf = fs.readFileSync(abs);
  assetBytes += buf.byteLength;
  const mime = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  assets[key] = `data:${mime};base64,${buf.toString('base64')}`;
}

/* ---------- 脚本 ---------- */
const parts = [];
let jsBytes = 0;
const missing = [];
for (const rel of SCRIPTS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    missing.push(rel);
    console.warn('! 缺少脚本 ' + rel + '（跳过，功能会提示不可用）');
    continue;
  }
  const code = fs.readFileSync(abs, 'utf8');
  jsBytes += Buffer.byteLength(code);
  parts.push('/* ===== ' + rel + ' ===== */\n' + esc(code));
}

let bundle = 'window.__ASSETS__ = ' + JSON.stringify(assets) + ';\n' + parts.join('\n;\n');

// 用一段内联脚本替换所有 <script src=...> 标签
const scriptTagRe = /<script src="[^"]*"><\/script>\s*\n?/g;
let replaced = 0;
html = html.replace(scriptTagRe, function () {
  replaced++;
  return '';
});
if (!replaced) throw new Error('index.html 里没找到 <script src> 标签，模板结构变了');
// 用函数形式替换：字符串替换会把 $& / $' 之类的模式当成特殊记号，会破坏脚本内容
html = html.replace('</body>', () => '<script>\n' + bundle + '\n</script>\n</body>');

/* ---------- 输出 ---------- */
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, 'earth-3d.html');
fs.writeFileSync(out, html);

const total = Buffer.byteLength(html);
console.log('✔ 构建完成: ' + path.relative(ROOT, out));
console.log('  脚本 ' + (SCRIPTS.length - missing.length) + ' 个 · ' + kb(jsBytes) +
  ' | 贴图 ' + Object.keys(assets).length + ' 张 · 原图 ' + kb(assetBytes) +
  ' | 成品 ' + (total / 1024 / 1024).toFixed(2) + ' MB');
if (missing.length) console.log('  未包含: ' + missing.join(', '));
