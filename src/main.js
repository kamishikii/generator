import './style.css';
import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const NATIVE = Capacitor.isNativePlatform();
const isMobile = NATIVE || matchMedia('(max-width:960px)').matches || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const lowPower = (navigator.hardwareConcurrency || 8) <= 4;

/* ------------------------------------------------------------ fallback -- */
function bootFallback(msg) {
  const boot = $('boot'); if (boot) boot.classList.add('hide');
  $('fallback').classList.add('show');
  $('fbMsg').textContent = msg;
  $('rail').classList.add('locked');
  const c = $('fbCanvas'), x = c.getContext('2d'), W = c.width, H = c.height;
  let t = 0, raf = 0;
  function branch(x0, y0, len, ang, w, d) {
    if (d > 9 || len < 3) return;
    const sway = Math.sin(t * 0.8 + d) * 0.035 * (10 - d);
    const x1 = x0 + Math.cos(ang + sway) * len, y1 = y0 + Math.sin(ang + sway) * len;
    x.strokeStyle = d < 3 ? '#6b5138' : '#4d7a3a';
    x.lineWidth = Math.max(0.7, w);
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    if (d > 5) {
      x.fillStyle = 'rgba(158,240,26,' + (0.10 + Math.random() * 0.16) + ')';
      x.beginPath(); x.arc(x1, y1, 4 + Math.random() * 7, 0, TAU); x.fill();
    }
    branch(x1, y1, len * 0.74, ang - 0.42 - Math.random() * 0.24, w * 0.66, d + 1);
    branch(x1, y1, len * 0.76, ang + 0.38 + Math.random() * 0.26, w * 0.66, d + 1);
  }
  (function loop() {
    t += 0.016;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d2a33'); g.addColorStop(0.62, '#2b1d16'); g.addColorStop(1, '#0a1410');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,176,32,.5)'; x.beginPath(); x.arc(W * 0.78, H * 0.3, 26, 0, TAU); x.fill();
    branch(W / 2, H - 16, 62, -Math.PI / 2, 11, 0);
    raf = requestAnimationFrame(loop);
  })();
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
}

/* -------------------------------------------------------------- native -- */
let hapticsMod = null;
async function buzz(style = 'LIGHT') {
  if (!NATIVE) return;
  try {
    if (!hapticsMod) hapticsMod = await import('@capacitor/haptics');
    await hapticsMod.Haptics.impact({ style: hapticsMod.ImpactStyle[style] || hapticsMod.ImpactStyle.Light });
  } catch (e) { /* вибрация недоступна — не критично */ }
}
function browserDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function saveArtifact({ filename, text, base64, mime, title }) {
  if (NATIVE) {
    try {
      const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'), import('@capacitor/share')
      ]);
      const opts = { path: filename, directory: Directory.Cache, recursive: true };
      if (base64) { opts.data = base64; opts.encoding = Encoding.Base64; }
      else { opts.data = text; opts.encoding = Encoding.UTF8; }
      const res = await Filesystem.writeFile(opts);
      await Share.share({ title, files: [res.uri], dialogTitle: title });
      return 'файл ' + filename + ' отправлен в систему';
    } catch (e) {
      if (String(e && e.message).toLowerCase().includes('cancel')) return null;
      // запасной путь — обычная загрузка
    }
  }
  const blob = base64
    ? await (await fetch('data:' + mime + ';base64,' + base64)).blob()
    : new Blob([text], { type: mime });
  browserDownload(blob, filename);
  return 'сохранено: ' + filename;
}
if (NATIVE) {
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setBackgroundColor({ color: '#0a1411' }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }).catch(() => {});
}

/* --------------------------------------------------------------- rng ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/* ============================================================== start == */
function start() {

/* ------------------------------------------------------------- state -- */
const DEFAULTS = {
  preset: 'oak', seed: 1337,
  height: 13, trunk: 0.66, crown: 2000, seg: 0.30, chaos: 0.50, droop: 0.10, shape: 'sphere',
  leaves: 26000, leafSize: 1.0, leafShape: 'broad', leafColor: '#57bd3f', leafVar: 0.55,
  barkColor: '#6d5439', sunEl: 0.26, sunAz: 135, lightInt: 1.0, fog: 0.024, bloom: 0.62, rays: true,
  wind: 0.35, particles: 700, fireflies: true, grass: true,
  quality: isMobile ? 'draft' : 'game', fov: 42, dist: 26,
  autoRotate: !reduceMotion, wireframe: false, skeleton: false, grid: false, scaleRef: false
};
const P = Object.assign({}, DEFAULTS);
if (isMobile) { P.leaves = 12000; P.crown = 1400; P.particles = 420; P.dist = 28; }
if (lowPower && isMobile) { P.leaves = 8000; P.crown = 1100; }

const PRESETS = {
  oak:    { n: 'Дуб',      e: '🌳', p: { height: 13, trunk: 0.66, crown: 2000, seg: 0.30, chaos: 0.50, droop: 0.10, shape: 'sphere',   leaves: 26000, leafSize: 1.00, leafShape: 'broad',  leafColor: '#57bd3f', leafVar: 0.55, barkColor: '#6d5439', sunEl: 0.26, wind: 0.35 } },
  pine:   { n: 'Сосна',    e: '🌲', p: { height: 19, trunk: 0.42, crown: 1600, seg: 0.34, chaos: 0.22, droop: -0.06, shape: 'cone',    leaves: 22000, leafSize: 1.25, leafShape: 'needle', leafColor: '#2f7d55', leafVar: 0.35, barkColor: '#7a5a3c', sunEl: 0.44, wind: 0.28 } },
  willow: { n: 'Ива',      e: '🌿', p: { height: 12, trunk: 0.74, crown: 2400, seg: 0.26, chaos: 0.60, droop: -0.58, shape: 'sphere',  leaves: 30000, leafSize: 0.95, leafShape: 'needle', leafColor: '#8fc94a', leafVar: 0.50, barkColor: '#5d4c34', sunEl: 0.20, wind: 0.58 } },
  sakura: { n: 'Сакура',   e: '🌸', p: { height: 10, trunk: 0.52, crown: 2000, seg: 0.24, chaos: 0.62, droop: 0.06, shape: 'umbrella', leaves: 24000, leafSize: 0.85, leafShape: 'bloom',  leafColor: '#ff8fc4', leafVar: 0.45, barkColor: '#5a4636', sunEl: 0.18, wind: 0.42 } },
  baobab: { n: 'Баобаб',   e: '🪵', p: { height: 11, trunk: 1.18, crown: 900,  seg: 0.36, chaos: 0.72, droop: 0.22, shape: 'umbrella', leaves: 9000,  leafSize: 1.15, leafShape: 'broad',  leafColor: '#6ea844', leafVar: 0.50, barkColor: '#8a7358', sunEl: 0.36, wind: 0.20 } },
  dead:   { n: 'Сухостой', e: '🥀', p: { height: 14, trunk: 0.60, crown: 1300, seg: 0.26, chaos: 0.86, droop: 0.18, shape: 'sphere',   leaves: 0,     leafSize: 1.00, leafShape: 'broad',  leafColor: '#7a6a4a', leafVar: 0.50, barkColor: '#6a6258', sunEl: 0.07, wind: 0.52, fireflies: true } }
};
const QUALITY = {
  draft: { n: 'Черновик', radial: 4,  maxNodes: 1500, pr: 1.25, shadow: 1024, msaa: 0, leafCap: 16000, blur: 1 },
  game:  { n: 'Игра',     radial: 7,  maxNodes: 3200, pr: 1.5,  shadow: 2048, msaa: 4, leafCap: 36000, blur: 2 },
  cine:  { n: 'Кино',     radial: 10, maxNodes: 5400, pr: 1.75, shadow: 2048, msaa: 4, leafCap: 60000, blur: 2 },
  ultra: { n: 'Ультра',   radial: 14, maxNodes: 8200, pr: 2.0,  shadow: 4096, msaa: 4, leafCap: 90000, blur: 3 }
};
let Q = QUALITY[P.quality];

/* ------------------------------------------------------------- sound -- */
const Sound = {
  ctx: null, on: true, master: null, wg: null, bp: null, buf: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.on = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? 0.85 : 0;
    this.master.connect(this.ctx.destination);
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 2);
    const b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.022 * w) / 1.022; d[i] = last * 3.4; }
    this.buf = b;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    this.bp = this.ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 520; this.bp.Q.value = 0.65;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2100;
    this.wg = this.ctx.createGain(); this.wg.gain.value = 0.02;
    src.connect(this.bp); this.bp.connect(lp); lp.connect(this.wg); this.wg.connect(this.master); src.start();
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.075;
    const lg = this.ctx.createGain(); lg.gain.value = 0.016;
    lfo.connect(lg); lg.connect(this.wg.gain); lfo.start();
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); if (this.ctx) this.setWind(P.wind); },
  setWind(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wg.gain.setTargetAtTime(0.012 + v * 0.105, t, 0.45);
    this.bp.frequency.setTargetAtTime(360 + v * 760, t, 0.5);
  },
  rustle() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf; s.playbackRate.value = 1.7;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 950;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.09); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.85);
    s.connect(hp); hp.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.9);
  },
  tick(f = 680) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.09);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.1);
  },
  setOn(v) { this.on = v; if (this.master) this.master.gain.setTargetAtTime(v ? 0.85 : 0, this.ctx.currentTime, 0.06); }
};

/* ---------------------------------------------------------- textures -- */
function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true, rep = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function barkCanvas() {
  const w = 256, h = 512, c = cvs(w, h), x = c.getContext('2d');
  x.fillStyle = '#9c9c9c'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const px = Math.random() * w, lw = 0.6 + Math.random() * 4.2, dark = Math.random() < 0.55;
    x.strokeStyle = dark ? 'rgba(40,34,28,' + (0.05 + Math.random() * 0.20) + ')' : 'rgba(235,228,215,' + (0.03 + Math.random() * 0.13) + ')';
    x.lineWidth = lw; x.beginPath();
    let y = -10, cx = px; x.moveTo(cx, y);
    while (y < h + 10) { y += 14 + Math.random() * 22; cx += (Math.random() - 0.5) * 7; x.lineTo(cx, y); }
    x.stroke();
  }
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h, x0 = Math.random() * w, len = 8 + Math.random() * 40;
    x.strokeStyle = 'rgba(24,20,16,' + (0.16 + Math.random() * 0.3) + ')';
    x.lineWidth = 0.8 + Math.random() * 1.8;
    x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + len, y + (Math.random() - 0.5) * 5); x.stroke();
  }
  const im = x.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(im, 0, 0);
  return c;
}
function normalFrom(src, strength) {
  const w = src.width, h = src.height;
  const sx = src.getContext('2d').getImageData(0, 0, w, h).data;
  const c = cvs(w, h), x = c.getContext('2d'), out = x.createImageData(w, h), o = out.data;
  const L = (i, j) => { const ii = (i + w) % w, jj = (j + h) % h, k = (jj * w + ii) * 4; return (sx[k] * 0.3 + sx[k + 1] * 0.59 + sx[k + 2] * 0.11) / 255; };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (L(i + 1, j) - L(i - 1, j)) * strength, dy = (L(i, j + 1) - L(i, j - 1)) * strength;
    let nx = -dx, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (j * w + i) * 4;
    o[k] = (nx * 0.5 + 0.5) * 255; o[k + 1] = (ny * 0.5 + 0.5) * 255; o[k + 2] = (nz * 0.5 + 0.5) * 255; o[k + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  return c;
}
function leafCanvas(kind) {
  const s = 128, c = cvs(s, s), x = c.getContext('2d');
  const g = x.createLinearGradient(0, s, 0, 0);
  g.addColorStop(0, '#b9c9ae'); g.addColorStop(0.45, '#eef5e6'); g.addColorStop(1, '#ffffff');
  x.fillStyle = g;
  if (kind === 'bloom') {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU - Math.PI / 2, cx = 64 + Math.cos(a) * 26, cy = 64 + Math.sin(a) * 26;
      x.beginPath(); x.ellipse(cx, cy, 25, 20, a, 0, TAU); x.fill();
    }
    x.fillStyle = 'rgba(255,240,200,.95)'; x.beginPath(); x.arc(64, 64, 11, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(190,150,120,.5)'; x.lineWidth = 1.4;
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * 17, 64 + Math.sin(a) * 17); x.stroke(); }
  } else {
    const narrow = kind === 'needle';
    x.beginPath(); x.moveTo(64, 124);
    x.bezierCurveTo(narrow ? 46 : 8, 88, narrow ? 50 : 16, 28, 64, 4);
    x.bezierCurveTo(narrow ? 78 : 112, 28, narrow ? 82 : 120, 88, 64, 124);
    x.closePath(); x.fill();
    x.strokeStyle = 'rgba(112,132,100,.55)'; x.lineWidth = narrow ? 1.6 : 2.2;
    x.beginPath(); x.moveTo(64, 120); x.lineTo(64, 10); x.stroke();
    if (!narrow) {
      x.lineWidth = 1.2;
      for (let i = 1; i < 7; i++) {
        const y = 110 - i * 14, sp = (1 - Math.abs(y - 64) / 70) * 38;
        x.beginPath(); x.moveTo(64, y); x.lineTo(64 - sp, y - 11); x.stroke();
        x.beginPath(); x.moveTo(64, y); x.lineTo(64 + sp, y - 11); x.stroke();
      }
    }
    x.strokeStyle = 'rgba(70,86,60,.35)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(64, 124);
    x.bezierCurveTo(narrow ? 46 : 8, 88, narrow ? 50 : 16, 28, 64, 4);
    x.bezierCurveTo(narrow ? 78 : 112, 28, narrow ? 82 : 120, 88, 64, 124); x.stroke();
  }
  return c;
}
function groundCanvas() {
  const s = 512, c = cvs(s, s), x = c.getContext('2d');
  x.fillStyle = '#2b3327'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 220; i++) {
    const cx = Math.random() * s, cy = Math.random() * s, r = 8 + Math.random() * 70;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const moss = Math.random() < 0.62;
    g.addColorStop(0, moss ? 'rgba(74,104,58,.5)' : 'rgba(58,46,34,.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
  }
  const im = x.getImageData(0, 0, s, s), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 30; d[i] += n; d[i + 1] += n * 1.1; d[i + 2] += n * 0.8; }
  x.putImageData(im, 0, 0);
  return c;
}

/* --------------------------------------------------------- renderer -- */
const canvas = $('gl'), stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;

const isWebGL2 = renderer.capabilities.isWebGL2;
const canHDR = isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
const HDR = canHDR ? THREE.HalfFloatType : THREE.UnsignedByteType;
const maxSamples = isWebGL2 ? (renderer.capabilities.maxSamples || 0) : 0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color('#16323a'), P.fog);
const camera = new THREE.PerspectiveCamera(P.fov, 1, 0.1, 700);

/* ------------------------------------------------------------- wind -- */
const U = { time: { value: 0 }, wind: { value: P.wind }, grow: { value: 0 }, growColor: { value: new THREE.Color('#9ef01a') } };
const WIND_PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec3 wP = ( modelMatrix * mvPosition ).xyz;
float hN = clamp( wP.y / max( uHeight, 0.001 ), 0.0, 1.0 );
float bend = pow( hN, 1.7 ) * uWind;
float gust = 0.62 + 0.38 * sin( uTime * 0.31 + wP.x * 0.05 );
float ph = uTime * 1.15 + wP.x * 0.22 + wP.z * 0.19;
vec3 wDir = normalize( vec3( 1.0, 0.06, 0.34 ) );
mvPosition.xyz += wDir * bend * gust * ( 0.42 * sin( ph ) + 0.16 * sin( ph * 2.7 ) );
mvPosition.xyz += vec3( sin( uTime * 6.7 + wP.y * 3.1 + wP.x * 4.3 ), 0.55 * sin( uTime * 5.3 + wP.z * 3.9 ), cos( uTime * 7.1 + wP.x * 3.3 ) ) * uFlutter * ( 0.25 + hN );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
function windify(mat, flutter, height, keyName) {
  const uF = { value: flutter }, uH = { value: height };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time; sh.uniforms.uWind = U.wind; sh.uniforms.uGrow = U.grow; sh.uniforms.uGrowColor = U.growColor;
    sh.uniforms.uFlutter = uF; sh.uniforms.uHeight = uH;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrow;\nvarying float vGrowH;\nuniform float uTime;uniform float uWind;uniform float uHeight;uniform float uFlutter;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrowH = aGrow;')
      .replace('#include <project_vertex>', WIND_PROJECT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrowH;\nuniform float uGrow;\nuniform vec3 uGrowColor;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif( vGrowH > uGrow ) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat gE = smoothstep( uGrow - 0.04, uGrow, vGrowH ) * step( 0.002, uGrow ) * ( 1.0 - step( 0.998, uGrow ) );\ntotalEmissiveRadiance += uGrowColor * gE * 3.2;');
  };
  mat.customProgramCacheKey = () => 'wind_' + keyName;
  mat.userData.uH = uH;
  return mat;
}

/* -------------------------------------------------------- materials -- */
const barkC = barkCanvas();
const barkMap = tex(barkC), barkNrm = tex(normalFrom(barkC, 2.6), false);
const barkMat = windify(new THREE.MeshStandardMaterial({
  color: new THREE.Color(P.barkColor), map: barkMap, normalMap: barkNrm,
  normalScale: new THREE.Vector2(1.15, 1.15), roughness: 0.92, metalness: 0.0, dithering: true
}), 0, P.height, 'bark');

const leafTex = {
  broad: tex(leafCanvas('broad'), true, false),
  needle: tex(leafCanvas('needle'), true, false),
  bloom: tex(leafCanvas('bloom'), true, false)
};
const leafGeoBase = (() => {
  const g = new THREE.PlaneGeometry(1, 1, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.07 * Math.cos(p.getY(i) * Math.PI));
  g.translate(0, 0.5, 0); g.computeVertexNormals();
  return g;
})();
const leafMat = windify(new THREE.MeshStandardMaterial({
  map: leafTex[P.leafShape], alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.0
}), 0.05, P.height, 'leaf');

const bladeGeo = (() => {
  const g = new THREE.BufferGeometry(), w = 0.035, h = 0.42;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.55, 0.03, w * 0.6, h * 0.55, 0.03, 0, h, 0.09], 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]); g.computeVertexNormals();
  return g;
})();
const grassMat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), 0.09, 0.5, 'grass');

const groundMat = new THREE.MeshStandardMaterial({ map: tex(groundCanvas()), roughness: 1, metalness: 0, color: 0x8fa08a });
groundMat.map.repeat.set(26, 26);
const ground = new THREE.Mesh(new THREE.CircleGeometry(92, 72), groundMat);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const skeletonMat = new THREE.LineBasicMaterial({ color: 0x9ef01a, transparent: true, opacity: 0.55 });

/* -------------------------------------------------------------- sky -- */
const skyU = {
  uHor: { value: new THREE.Color('#ff8a3d') }, uZen: { value: new THREE.Color('#123c4e') },
  uSunC: { value: new THREE.Color('#ffd39a') }, uSunDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() }, uSunI: { value: 1 }
};
const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 20), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `
  uniform vec3 uHor,uZen,uSunC,uSunDir;uniform float uSunI;varying vec3 vDir;
  void main(){
    vec3 d=normalize(vDir);
    vec3 col=mix(uHor,uZen,pow(clamp(d.y,0.0,1.0),0.55));
    col=mix(col*0.42,col,smoothstep(-0.30,0.05,d.y));
    float sd=max(dot(d,normalize(uSunDir)),0.0);
    col+=uSunC*uSunI*(pow(sd,900.0)*26.0+pow(sd,26.0)*0.55+pow(sd,5.0)*0.13);
    col+=(fract(sin(dot(d.xy,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.004;
    gl_FragColor=vec4(col,1.0);
  }`
}));
sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

/* ------------------------------------------------------------ lights -- */
const key = new THREE.DirectionalLight(0xffb066, 3.2);
key.castShadow = true;
key.shadow.mapSize.set(Q.shadow, Q.shadow);
key.shadow.camera.near = 1; key.shadow.camera.far = 220;
key.shadow.bias = -0.0007; key.shadow.normalBias = 0.035;
const keyTarget = new THREE.Object3D(); scene.add(keyTarget);
key.target = keyTarget; scene.add(key);
const rim = new THREE.DirectionalLight(0x38e6ff, 0.95); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffc98a, 0.35); scene.add(fill);
const hemi = new THREE.HemisphereLight(0x2a6f8a, 0x1d2a1c, 0.5); scene.add(hemi);
const amb = new THREE.AmbientLight(0x30443c, 0.16); scene.add(amb);

const SKY_STOPS = [
  { t: 0.00, hor: '#14343f', zen: '#04080e', sun: '#7fb0ff', key: '#6f92cc', ki: 0.75, hi: 0.26, si: 0.55 },
  { t: 0.28, hor: '#ff8a3d', zen: '#123c4e', sun: '#ffd39a', key: '#ffb066', ki: 3.20, hi: 0.50, si: 1.00 },
  { t: 0.62, hor: '#cfe6ea', zen: '#1f6f9e', sun: '#fff3d6', key: '#fff0d0', ki: 3.55, hi: 0.78, si: 0.85 },
  { t: 1.00, hor: '#eaf6f2', zen: '#2a86b8', sun: '#ffffff', key: '#ffffff', ki: 3.85, hi: 0.98, si: 0.70 }
];
const sunDir = new THREE.Vector3();
const cA = new THREE.Color(), cB = new THREE.Color();
function mixCol(a, b, t, out) { cA.set(a); cB.set(b); out.copy(cA).lerp(cB, t); return out; }
function applySky() {
  const t = P.sunEl;
  let i = 0; while (i < SKY_STOPS.length - 2 && t > SKY_STOPS[i + 1].t) i++;
  const s0 = SKY_STOPS[i], s1 = SKY_STOPS[i + 1], k = clamp((t - s0.t) / (s1.t - s0.t), 0, 1);
  mixCol(s0.hor, s1.hor, k, skyU.uHor.value);
  mixCol(s0.zen, s1.zen, k, skyU.uZen.value);
  mixCol(s0.sun, s1.sun, k, skyU.uSunC.value);
  mixCol(s0.key, s1.key, k, key.color);
  skyU.uSunI.value = lerp(s0.si, s1.si, k);
  const el = lerp(0.035, 1.30, t), az = P.sunAz * Math.PI / 180;
  sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
  skyU.uSunDir.value.copy(sunDir);
  const H = P.height;
  keyTarget.position.set(0, H * 0.42, 0);
  key.position.copy(sunDir).multiplyScalar(85).add(keyTarget.position);
  const ext = Math.max(14, H * 1.25), sc = key.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
  key.intensity = lerp(s0.ki, s1.ki, k) * P.lightInt;
  hemi.intensity = lerp(s0.hi, s1.hi, k) * P.lightInt;
  hemi.color.copy(skyU.uZen.value).lerp(new THREE.Color(0xffffff), 0.25);
  rim.position.set(-sunDir.x * 40, H * 0.8 + 8, -sunDir.z * 40); rim.intensity = 0.95 * P.lightInt;
  fill.position.set(-sunDir.z * 30, H * 0.3, sunDir.x * 30); fill.intensity = 0.32 * P.lightInt;
  amb.intensity = 0.16 * P.lightInt;
  scene.fog.color.copy(skyU.uHor.value).lerp(skyU.uZen.value, 0.55).multiplyScalar(0.75);
  scene.fog.density = P.fog;
  renderer.shadowMap.needsUpdate = true;
}

/* -------------------------------------------------------- particles -- */
function motes(count, range, color, size, speed, int) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), seed = new Float32Array(count), sz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * range * 0.55;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * range; pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = Math.random(); sz[i] = size * (0.5 + Math.random());
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.time, uPR: { value: 1 }, uRange: { value: range }, uSpeed: { value: speed }, uSway: { value: 0.9 },
      uColor: { value: new THREE.Color(color) }, uInt: { value: int }
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
    attribute float aSeed;attribute float aSize;uniform float uTime,uPR,uRange,uSpeed,uSway;varying float vB;
    void main(){
      vec3 p=position; float t=uTime*uSpeed+aSeed*37.0;
      p.y=mod(p.y+t*0.35,uRange);
      p.x+=sin(t*0.6+aSeed*6.28)*uSway; p.z+=cos(t*0.47+aSeed*4.1)*uSway;
      vec4 mv=modelViewMatrix*vec4(p,1.0);
      gl_PointSize=aSize*uPR*(260.0/max(0.001,-mv.z));
      gl_Position=projectionMatrix*mv;
      vB=0.35+0.65*pow(max(0.0,sin(uTime*2.1+aSeed*24.0)),2.0);
    }`,
    fragmentShader: `
    uniform vec3 uColor;uniform float uInt;varying float vB;
    void main(){
      float d=length(gl_PointCoord-0.5);
      float a=smoothstep(0.5,0.0,d);
      gl_FragColor=vec4(uColor*a*vB*uInt,a);
    }`
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; scene.add(pts);
  return pts;
}
const pollen = motes(1500, 20, '#ffe9b8', 2.6, 0.5, 1.1);
const flies = motes(110, 10, '#ffb020', 5.0, 0.16, 2.6);
flies.material.uniforms.uSway.value = 1.6;

/* ---------------------------------------------------------- helpers -- */
const treeGroup = new THREE.Group(); scene.add(treeGroup);
const grid = new THREE.GridHelper(60, 30, 0x9ef01a, 0x2fbf6a);
grid.material.transparent = true; grid.material.opacity = 0.16;
grid.visible = false; grid.position.y = 0.01; scene.add(grid);
const refGroup = new THREE.Group(); refGroup.visible = false; scene.add(refGroup);
{
  const m = new THREE.MeshStandardMaterial({ color: 0x0e2a24, emissive: 0x38e6ff, emissiveIntensity: 0.22, roughness: 0.5, transparent: true, opacity: 0.62 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 1.05, 6, 12), m); body.position.set(2.4, 0.85, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), m); head.position.set(2.4, 1.62, 0);
  refGroup.add(body, head);
}
let wood = null, skeleton = null, leafMesh = null, grassMesh = null, litterMesh = null;
let nodes = [], tips = [];
const stats = { woodTris: 0, leafTris: 0, nodes: 0, branches: 0, leaves: 0, gen: 0, capped: false };

/* ==================================================== tree generation == */
class Hash {
  constructor(cell) { this.inv = 1 / cell; this.m = new Map(); }
  insert(o) {
    const cx = Math.floor(o.x * this.inv) + 512, cy = Math.floor(o.y * this.inv) + 512, cz = Math.floor(o.z * this.inv) + 512;
    const k = (cx << 20) | (cy << 10) | cz;
    let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); }
    a.push(o);
  }
  near(x, y, z, cb) {
    const cx = Math.floor(x * this.inv), cy = Math.floor(y * this.inv), cz = Math.floor(z * this.inv);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const key = ((cx + i + 512) << 20) | ((cy + j + 512) << 10) | (cz + k + 512);
      const a = this.m.get(key);
      if (a) for (let n = 0; n < a.length; n++) cb(a[n]);
    }
  }
}
function crownPoints(rng) {
  const H = P.height, N = Math.round(P.crown), out = [], shape = P.shape;
  if (shape === 'cone') {
    const y0 = H * 0.20, y1 = H, R = H * 0.30;
    for (let i = 0; i < N; i++) {
      const y = lerp(y0, y1, Math.pow(rng(), 0.75));
      const rr = R * Math.pow(1 - (y - y0) / (y1 - y0), 0.8) * (0.55 + 0.45 * rng());
      const a = rng() * TAU;
      out.push({ x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, active: true });
    }
  } else if (shape === 'umbrella') {
    const top = H * 0.97, R = H * 0.52;
    for (let i = 0; i < N; i++) {
      const a = rng() * TAU, rr = R * Math.sqrt(rng());
      const y = top - 0.20 * H * Math.pow(rr / R, 1.7) + (rng() - 0.5) * H * 0.05;
      out.push({ x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, active: true });
    }
  } else {
    const col = shape === 'column';
    const cy = H * (col ? 0.62 : 0.70);
    const rx = H * (col ? 0.15 : 0.40), ry = H * (col ? 0.40 : 0.30), rz = rx;
    const lobes = [], nl = col ? 3 : 5;
    for (let i = 0; i < nl; i++) {
      const a = rng() * TAU, e = (rng() - 0.5) * 1.1;
      lobes.push({ x: Math.cos(a) * rx * 0.55 * rng(), y: cy + e * ry * 0.5, z: Math.sin(a) * rz * 0.55 * rng(), s: 0.55 + rng() * 0.42 });
    }
    let guard = 0;
    while (out.length < N && guard < N * 14) {
      guard++;
      const L = lobes[(rng() * lobes.length) | 0];
      const u = rng() * 2 - 1, a = rng() * TAU, r = Math.cbrt(rng()), s = Math.sqrt(Math.max(0, 1 - u * u));
      const x = L.x + Math.cos(a) * s * r * rx * L.s, y = L.y + u * r * ry * L.s, z = L.z + Math.sin(a) * s * r * rz * L.s;
      if (y < H * 0.20) continue;
      if (vnoise(x * 0.35, y * 0.35, z * 0.35) < 0.30 && rng() < 0.65) continue;
      out.push({ x, y, z, active: true });
    }
  }
  return out;
}
function growSkeleton(rng) {
  const H = P.height, seg = P.seg, di = seg * 4.2, dk = seg * 1.55;
  const list = [];
  const mk = (x, y, z, parent) => {
    const n = {
      x, y, z, parent, children: [], r: 0,
      dist: parent ? parent.dist + Math.hypot(x - parent.x, y - parent.y, z - parent.z) : 0,
      order: parent ? parent.order + 1 : 0, ax: 0, ay: 0, az: 0, cnt: 0, grow: 0
    };
    list.push(n); if (parent) parent.children.push(n);
    return n;
  };
  const trunkTop = H * (P.shape === 'cone' ? 0.30 : 0.28);
  let cur = mk(0, 0, 0, null);
  const steps = Math.max(3, Math.round(trunkTop / seg));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, bend = P.chaos * 0.35;
    cur = mk(Math.sin(t * 2.1) * bend * H * 0.05 + (rng() - 0.5) * seg * 0.2, trunkTop * t,
             Math.cos(t * 1.7) * bend * H * 0.04 + (rng() - 0.5) * seg * 0.2, cur);
  }
  const pts = crownPoints(rng);
  const nh = new Hash(di); for (const n of list) nh.insert(n);
  const ph = new Hash(dk); for (const p of pts) ph.insert(p);
  const di2 = di * di, dk2 = dk * dk;
  let active = pts.length, capped = false;
  const maxNodes = Q.maxNodes, chaos = P.chaos, droop = P.droop;
  for (let iter = 0; iter < 300; iter++) {
    for (let i = 0; i < list.length; i++) { const n = list[i]; n.ax = 0; n.ay = 0; n.az = 0; n.cnt = 0; }
    let any = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]; if (!p.active) continue;
      let best = null, bd = di2;
      nh.near(p.x, p.y, p.z, n => {
        const dx = p.x - n.x, dy = p.y - n.y, dz = p.z - n.z, d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = n; }
      });
      if (best) {
        const dx = p.x - best.x, dy = p.y - best.y, dz = p.z - best.z, l = Math.hypot(dx, dy, dz) || 1;
        best.ax += dx / l; best.ay += dy / l; best.az += dz / l; best.cnt++; any = true;
      }
    }
    if (!any) break;
    const fresh = [];
    for (let i = 0, len = list.length; i < len; i++) {
      const n = list[i]; if (!n.cnt) continue;
      let dx = n.ax / n.cnt, dy = n.ay / n.cnt, dz = n.az / n.cnt;
      dy += droop * (n.order > 2 ? 0.55 : 0.10) + 0.06;
      dx += (rng() - 0.5) * chaos * 0.85; dy += (rng() - 0.5) * chaos * 0.45; dz += (rng() - 0.5) * chaos * 0.85;
      const l = Math.hypot(dx, dy, dz) || 1;
      const c = mk(n.x + dx / l * seg, Math.max(0.04, n.y + dy / l * seg), n.z + dz / l * seg, n);
      nh.insert(c); fresh.push(c);
    }
    for (const f of fresh) {
      ph.near(f.x, f.y, f.z, p => {
        if (!p.active) return;
        const dx = p.x - f.x, dy = p.y - f.y, dz = p.z - f.z;
        if (dx * dx + dy * dy + dz * dz < dk2) { p.active = false; active--; }
      });
    }
    if (list.length >= maxNodes) { capped = true; break; }
    if (active <= 0) break;
  }
  const EXP = 2.35, tipR = 0.022 * Math.max(0.6, H / 13);
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.children.length === 0) n.r = tipR;
    else { let s = 0; for (const c of n.children) s += Math.pow(c.r, EXP); n.r = Math.pow(s, 1 / EXP); }
    n.r = Math.max(n.r, tipR * 0.55);
  }
  const f = P.trunk / list[0].r;
  let maxD = 0;
  for (const n of list) {
    n.r *= f;
    if (n.y < 1.3) n.r *= 1 + 0.85 * Math.exp(-n.y / 0.42);
    if (n.dist > maxD) maxD = n.dist;
  }
  for (const n of list) n.grow = maxD > 0 ? n.dist / maxD : 0;
  return { list, capped };
}
function collectPaths(root) {
  const paths = [];
  const walk = (first, inc) => {
    const chain = inc ? [inc, first] : [first];
    let cur = first;
    while (cur.children.length === 1) { cur = cur.children[0]; chain.push(cur); }
    paths.push(chain);
    for (const c of cur.children) walk(c, cur);
  };
  walk(root, null);
  return paths;
}
function rootPaths(root, rng) {
  const out = [], n = 6 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + rng() * 0.4, R = root.r;
    out.push([
      { x: 0, y: 0.22, z: 0, r: R * 0.55, dist: 0.05, grow: 0.004, children: [1] },
      { x: Math.cos(a) * R * 1.15, y: 0.05, z: Math.sin(a) * R * 1.15, r: R * 0.36, dist: R * 1.3, grow: 0.02, children: [1] },
      { x: Math.cos(a) * R * 2.3, y: -0.28, z: Math.sin(a) * R * 2.3, r: R * 0.16, dist: R * 2.6, grow: 0.03, children: [] }
    ]);
  }
  return out;
}
function buildWood(paths) {
  const pos = [], nor = [], uv = [], gr = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3(), axis = new THREE.Vector3();
  const chaos = P.chaos;
  for (const chain of paths) {
    if (chain.length < 2) continue;
    const r0 = chain[0].r;
    const radial = Math.max(3, Math.min(18, Math.round(Q.radial * clamp(r0 / 0.22, 0.32, 1.3))));
    T.set(chain[1].x - chain[0].x, chain[1].y - chain[0].y, chain[1].z - chain[0].z).normalize();
    N.set(0, 1, 0); if (Math.abs(T.dot(N)) > 0.9) N.set(1, 0, 0);
    N.crossVectors(T, N).normalize(); prevT.copy(T);
    const base = pos.length / 3, stride = radial + 1, uS = TAU * r0 / 0.55;
    for (let i = 0; i < chain.length; i++) {
      const c = chain[i];
      if (i === 0) T.set(chain[1].x - c.x, chain[1].y - c.y, chain[1].z - c.z);
      else if (i === chain.length - 1) T.set(c.x - chain[i - 1].x, c.y - chain[i - 1].y, c.z - chain[i - 1].z);
      else T.set(chain[i + 1].x - chain[i - 1].x, chain[i + 1].y - chain[i - 1].y, chain[i + 1].z - chain[i - 1].z);
      if (T.lengthSq() < 1e-10) T.copy(prevT);
      T.normalize();
      if (i > 0) {
        axis.crossVectors(prevT, T);
        const l = axis.length();
        if (l > 1e-6) { axis.divideScalar(l); N.applyAxisAngle(axis, Math.acos(clamp(prevT.dot(T), -1, 1))); }
        N.addScaledVector(T, -N.dot(T));
        if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(T, -T.x);
        N.normalize(); prevT.copy(T);
      }
      B.crossVectors(T, N).normalize();
      const vS = c.dist / 0.55;
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const gn = 1 + chaos * 0.17 * (vnoise(ca * 2.2 + r0 * 7, sa * 2.2, c.dist * 1.7) - 0.5) * 2;
        const rr = Math.max(0.004, c.r * gn);
        const nx = N.x * ca + B.x * sa, ny = N.y * ca + B.y * sa, nz = N.z * ca + B.z * sa;
        pos.push(c.x + nx * rr, c.y + ny * rr, c.z + nz * rr);
        nor.push(nx, ny, nz);
        uv.push(j / radial * uS, vS);
        gr.push(c.grow);
      }
    }
    for (let i = 0; i < chain.length - 1; i++) for (let j = 0; j < radial; j++) {
      const a = base + i * stride + j, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const last = chain[chain.length - 1];
    if (!last.children || last.children.length === 0) {
      const ti = pos.length / 3;
      pos.push(last.x + T.x * last.r * 1.7, last.y + T.y * last.r * 1.7, last.z + T.z * last.r * 1.7);
      nor.push(T.x, T.y, T.z);
      uv.push(0.5, last.dist / 0.55 + 0.1);
      gr.push(Math.min(1, last.grow + 0.005));
      const rb = base + (chain.length - 1) * stride;
      for (let j = 0; j < radial; j++) idx.push(rb + j, rb + j + 1, ti);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aGrow', new THREE.Float32BufferAttribute(gr, 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}
function disposeMesh(m) {
  if (!m) return;
  treeGroup.remove(m);
  if (m.isInstancedMesh) m.dispose();
  if (m.geometry) m.geometry.dispose();
}
function buildTree() {
  const t0 = performance.now();
  const rng = mulberry32(P.seed >>> 0);
  const res = growSkeleton(rng);
  nodes = res.list;
  const paths = collectPaths(nodes[0]).concat(rootPaths(nodes[0], rng));
  const geo = buildWood(paths);
  disposeMesh(wood);
  wood = new THREE.Mesh(geo, barkMat);
  wood.castShadow = true; wood.receiveShadow = true; wood.frustumCulled = false;
  treeGroup.add(wood);

  if (skeleton) { treeGroup.remove(skeleton); skeleton.geometry.dispose(); }
  const sp = [];
  for (const n of nodes) if (n.parent) sp.push(n.parent.x, n.parent.y, n.parent.z, n.x, n.y, n.z);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  skeleton = new THREE.LineSegments(sg, skeletonMat);
  skeleton.visible = P.skeleton; skeleton.frustumCulled = false;
  treeGroup.add(skeleton);

  tips = nodes.filter(n => n.children.length === 0 || (n.r < P.trunk * 0.07 && n.order > 4));
  stats.nodes = nodes.length; stats.branches = paths.length;
  stats.woodTris = geo.index.count / 3; stats.capped = res.capped;
  barkMat.userData.uH.value = P.height;
  leafMat.userData.uH.value = P.height;

  buildLeaves(rng);
  buildGround(rng);
  stats.gen = performance.now() - t0;
  U.grow.value = 0; growT = 0;
  key.castShadow = false;
  applySky();
  Sound.rustle();
  updateStatsUI();
}
function buildLeaves(rngIn) {
  const rng = rngIn || mulberry32((P.seed * 7 + 13) >>> 0);
  disposeMesh(leafMesh); leafMesh = null;
  const want = Math.min(Math.round(P.leaves), Q.leafCap);
  stats.leaves = 0; stats.leafTris = 0;
  leafMat.map = leafTex[P.leafShape]; leafMat.needsUpdate = true;
  if (want <= 0 || tips.length === 0) { updateStatsUI(); renderer.shadowMap.needsUpdate = true; return; }
  const geo = leafGeoBase.clone();
  const mesh = new THREE.InstancedMesh(geo, leafMat, want);
  const col = new Float32Array(want * 3), gr = new Float32Array(want);
  const d = new THREE.Object3D(), c = new THREE.Color();
  const base = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  const hs = P.height / 13, needle = P.leafShape === 'needle', crownR = Math.max(1, P.height * 0.42);
  for (let i = 0; i < want; i++) {
    const n = tips[(rng() * tips.length) | 0], p = n.parent || n, t = rng();
    const px = lerp(p.x, n.x, t), py = lerp(p.y, n.y, t), pz = lerp(p.z, n.z, t);
    const j = 0.13 * hs * P.leafSize;
    d.position.set(px + (rng() - 0.5) * j * 2, py + (rng() - 0.5) * j, pz + (rng() - 0.5) * j * 2);
    d.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 1.55 + (needle ? 0.35 : 0), rng() * TAU, (rng() - 0.5) * 0.85, 'YXZ');
    const s = P.leafSize * hs * (0.7 + rng() * 0.6) * 0.20;
    d.scale.set(s * (needle ? 0.34 : 1), s * (needle ? 1.75 : 1), s);
    d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
    const inner = clamp(1 - Math.hypot(px, pz) / crownR, 0, 1);
    c.setHSL((hsl.h + (rng() - 0.5) * 0.07 * P.leafVar + 1) % 1,
      clamp(hsl.s + (rng() - 0.5) * 0.32 * P.leafVar, 0, 1),
      clamp(hsl.l * (0.74 + 0.52 * rng()) * (1 - 0.30 * inner), 0.02, 0.96), THREE.SRGBColorSpace);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    gr[i] = Math.min(1, n.grow + 0.012);
  }
  geo.setAttribute('aGrow', new THREE.InstancedBufferAttribute(gr, 1));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  treeGroup.add(mesh); leafMesh = mesh;
  stats.leaves = want; stats.leafTris = want * 4;
  renderer.shadowMap.needsUpdate = true;
  updateStatsUI();
}
function buildGround(rngIn) {
  const rng = rngIn || mulberry32((P.seed * 31 + 5) >>> 0);
  disposeMesh(grassMesh); disposeMesh(litterMesh);
  grassMesh = null; litterMesh = null;
  if (!P.grass) { renderer.shadowMap.needsUpdate = true; return; }
  const N = isMobile ? 700 : 1500;
  const gg = bladeGeo.clone(), gm = new THREE.InstancedMesh(gg, grassMat, N);
  const gc = new Float32Array(N * 3), ga = new Float32Array(N);
  const d = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * Math.max(4, P.height * 0.55);
    d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    d.rotation.set((rng() - 0.5) * 0.35, rng() * TAU, (rng() - 0.5) * 0.35, 'YXZ');
    const s = 0.6 + rng() * 0.9;
    d.scale.set(s, s * (0.7 + rng() * 0.8), s);
    d.updateMatrix(); gm.setMatrixAt(i, d.matrix);
    c.setHSL(0.24 + rng() * 0.08, 0.35 + rng() * 0.25, 0.16 + rng() * 0.16, THREE.SRGBColorSpace);
    gc[i * 3] = c.r; gc[i * 3 + 1] = c.g; gc[i * 3 + 2] = c.b; ga[i] = 0.985;
  }
  gg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(ga, 1));
  gm.instanceColor = new THREE.InstancedBufferAttribute(gc, 3);
  gm.receiveShadow = true; gm.frustumCulled = false;
  treeGroup.add(gm); grassMesh = gm;

  const M = isMobile ? 260 : 560;
  const lg = leafGeoBase.clone(), lm = new THREE.InstancedMesh(lg, leafMat, M);
  const lc = new Float32Array(M * 3), la = new Float32Array(M);
  const base = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  for (let i = 0; i < M; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * Math.max(4, P.height * 0.5);
    d.position.set(Math.cos(a) * r, 0.02 + rng() * 0.02, Math.sin(a) * r);
    d.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.25, rng() * TAU, 0, 'YXZ');
    const s = 0.16 * (0.7 + rng() * 0.7);
    d.scale.set(s, s, s);
    d.updateMatrix(); lm.setMatrixAt(i, d.matrix);
    c.setHSL((hsl.h * 0.6 + 0.07 + rng() * 0.06) % 1, 0.5 + rng() * 0.3, 0.16 + rng() * 0.16, THREE.SRGBColorSpace);
    lc[i * 3] = c.r; lc[i * 3 + 1] = c.g; lc[i * 3 + 2] = c.b; la[i] = 0.99;
  }
  lg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(la, 1));
  lm.instanceColor = new THREE.InstancedBufferAttribute(lc, 3);
  lm.receiveShadow = true; lm.frustumCulled = false;
  treeGroup.add(lm); litterMesh = lm;
  renderer.shadowMap.needsUpdate = true;
}

/* ============================================================== post == */
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postScene = new THREE.Scene();
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
postQuad.frustumCulled = false; postScene.add(postQuad);
const VS = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
function makeRT(samples) {
  return new THREE.WebGLRenderTarget(2, 2, {
    type: HDR, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: samples > 0, samples: Math.min(samples, maxSamples)
  });
}
let sceneRT = makeRT(Q.msaa || 1);
let brightA = makeRT(0), brightB = makeRT(0), raysRT = makeRT(0);
const brightMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uTh: { value: canHDR ? 0.72 : 0.62 } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tSrc;uniform float uTh;varying vec2 vUv;
  void main(){vec3 c=texture2D(tSrc,vUv).rgb;float l=dot(c,vec3(0.2126,0.7152,0.0722));
  float k=max(0.0,l-uTh)/max(l,1e-4);gl_FragColor=vec4(c*k*smoothstep(0.0,0.4,l),1.0);}`
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;
  void main(){
    vec3 s=texture2D(tSrc,vUv).rgb*0.227027;
    s+=texture2D(tSrc,vUv+uDir*1.3846).rgb*0.316216;
    s+=texture2D(tSrc,vUv-uDir*1.3846).rgb*0.316216;
    s+=texture2D(tSrc,vUv+uDir*3.2307).rgb*0.070270;
    s+=texture2D(tSrc,vUv-uDir*3.2307).rgb*0.070270;
    gl_FragColor=vec4(s,1.0);}`
});
const raysMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uDensity: { value: 0.62 }, uDecay: { value: 0.94 }, uWeight: { value: 0.055 } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tSrc;uniform vec2 uSun;uniform float uDensity,uDecay,uWeight;varying vec2 vUv;
  void main(){
    vec2 uv=vUv;vec2 st=(uv-uSun)*(uDensity/24.0);
    vec3 s=vec3(0.0);float il=1.0;
    for(int i=0;i<24;i++){uv-=st;s+=texture2D(tSrc,clamp(uv,0.0,1.0)).rgb*il*uWeight;il*=uDecay;}
    gl_FragColor=vec4(s,1.0);}`
});
const compMat = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tBloom: { value: null }, tRays: { value: null },
    uBloom: { value: P.bloom }, uRays: { value: 0.6 }, uSunVis: { value: 1 }, uExposure: { value: 1.0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uGrain: { value: reduceMotion ? 0.012 : 0.032 }, uVig: { value: 0.42 }, uAspect: { value: 1 }
  },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `
  uniform sampler2D tScene,tBloom,tRays;
  uniform float uBloom,uRays,uSunVis,uExposure,uTime,uGrain,uVig,uAspect;
  uniform vec2 uRes;varying vec2 vUv;
  vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
  vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(0.0031308,c));}
  void main(){
    vec2 d=vUv-0.5;float r=length(d);
    vec2 ca=d*r*0.0035;
    vec3 base;
    base.r=texture2D(tScene,vUv+ca).r;
    base.g=texture2D(tScene,vUv).g;
    base.b=texture2D(tScene,vUv-ca).b;
    base+=texture2D(tBloom,vUv).rgb*uBloom;
    base+=texture2D(tRays,vUv).rgb*uRays*uSunVis;
    base*=uExposure;
    base=aces(base);
    float v=smoothstep(1.18,0.34,length(d*vec2(uAspect,1.0)));
    base*=mix(1.0,v,uVig);
    float g=fract(sin(dot(vUv*uRes+uTime*60.0,vec2(12.9898,78.233)))*43758.5453);
    base+=(g-0.5)*uGrain;
    gl_FragColor=vec4(srgb(clamp(base,0.0,1.0)),1.0);
  }`
});
function pass(mat, target) {
  postQuad.material = mat;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(postScene, postCam);
}
const sunWorld = new THREE.Vector3(), sunNDC = new THREE.Vector3();
function renderFrame(now) {
  renderer.info.reset();
  sky.position.copy(camera.position);
  renderer.setRenderTarget(sceneRT);
  renderer.clear();
  renderer.render(scene, camera);
  if (P.bloom > 0.004 || P.rays) {
    brightMat.uniforms.tSrc.value = sceneRT.texture;
    pass(brightMat, brightA);
    const w = brightA.width, h = brightA.height;
    for (let i = 0; i < Q.blur; i++) {
      const s = 1 + i * 1.6;
      blurMat.uniforms.tSrc.value = brightA.texture; blurMat.uniforms.uDir.value.set(s / w, 0); pass(blurMat, brightB);
      blurMat.uniforms.tSrc.value = brightB.texture; blurMat.uniforms.uDir.value.set(0, s / h); pass(blurMat, brightA);
    }
    if (P.rays) {
      sunWorld.copy(camera.position).addScaledVector(sunDir, 250);
      sunNDC.copy(sunWorld).project(camera);
      raysMat.uniforms.tSrc.value = brightA.texture;
      raysMat.uniforms.uSun.value.set(sunNDC.x * 0.5 + 0.5, sunNDC.y * 0.5 + 0.5);
      pass(raysMat, raysRT);
      compMat.uniforms.uSunVis.value = (sunNDC.z < 1 ? 1 : 0) * clamp(1.2 - Math.hypot(sunNDC.x, sunNDC.y) * 0.45, 0, 1);
    } else compMat.uniforms.uSunVis.value = 0;
  }
  compMat.uniforms.tScene.value = sceneRT.texture;
  compMat.uniforms.tBloom.value = brightA.texture;
  compMat.uniforms.tRays.value = raysRT.texture;
  compMat.uniforms.uBloom.value = P.bloom;
  compMat.uniforms.uRays.value = P.rays ? 0.6 : 0;
  compMat.uniforms.uTime.value = now * 0.001;
  postQuad.material = compMat;
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(postScene, postCam);
}

/* ============================================================ camera == */
const CAM_HOME = { theta: 0.9, phi: 1.16 };
const cam = {
  theta: CAM_HOME.theta, phi: CAM_HOME.phi, radius: P.dist,
  tTheta: CAM_HOME.theta, tPhi: CAM_HOME.phi, tRadius: P.dist,
  target: new THREE.Vector3(0, 6, 0), tTarget: new THREE.Vector3(0, 6, 0)
};
let lastInteract = performance.now(), dragging = false, pinchDist = 0, hintGone = false;
const pointers = new Map();
function markInteract() {
  lastInteract = performance.now();
  if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); }
}
canvas.addEventListener('pointerdown', e => {
  Sound.resume();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true; canvas.classList.add('drag'); markInteract();
  if (pointers.size === 2) { const p = [...pointers.values()]; pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
});
canvas.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  markInteract();
  if (pointers.size >= 2) {
    const p = [...pointers.values()], d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    if (pinchDist > 0 && d > 0) { cam.tRadius = clamp(cam.tRadius * (pinchDist / d), 4, 80); syncRange('dist', cam.tRadius); }
    pinchDist = d;
  } else {
    cam.tTheta -= dx * 0.006;
    cam.tPhi = clamp(cam.tPhi - dy * 0.005, 0.12, 1.52);
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) { dragging = false; canvas.classList.remove('drag'); }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', endPointer);
canvas.addEventListener('wheel', e => {
  e.preventDefault(); Sound.resume(); markInteract();
  cam.tRadius = clamp(cam.tRadius * Math.exp(clamp(e.deltaY, -160, 160) * 0.0011), 4, 80);
  syncRange('dist', cam.tRadius);
}, { passive: false });
canvas.addEventListener('dblclick', () => resetCamera());
function resetCamera() {
  cam.tTheta = CAM_HOME.theta; cam.tPhi = CAM_HOME.phi; cam.tRadius = P.dist;
  markInteract(); buzz('LIGHT'); Sound.tick(640); toast('Камера в исходной точке');
}
function updateCamera(dt, now) {
  if (P.autoRotate && !dragging && now - lastInteract > 2200) cam.tTheta += dt * 0.055;
  const k = Math.min(1, dt * 8);
  cam.theta += (cam.tTheta - cam.theta) * k;
  cam.phi += (cam.tPhi - cam.phi) * k;
  cam.radius += (cam.tRadius - cam.radius) * k;
  cam.tTarget.set(0, P.height * 0.46, 0);
  cam.target.lerp(cam.tTarget, Math.min(1, dt * 4));
  const breathe = reduceMotion || dragging ? 0 : Math.sin(now * 0.00013) * 0.12;
  const r = cam.radius + breathe;
  camera.position.set(
    cam.target.x + r * Math.sin(cam.phi) * Math.cos(cam.theta),
    Math.max(0.4, cam.target.y + r * Math.cos(cam.phi)),
    cam.target.z + r * Math.sin(cam.phi) * Math.sin(cam.theta));
  camera.lookAt(cam.target);
  if (camera.fov !== P.fov) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
}

/* =============================================================== UI == */
const pct = v => Math.round(v * 100) + '%';
const SCHEMA = [
  { g: 'Каркас дерева', items: [
    { k: 'height', t: 'range', l: 'Высота', min: 4, max: 24, step: 0.5, u: ' м', s: 'tree' },
    { k: 'trunk', t: 'range', l: 'Толщина ствола', min: 0.15, max: 1.4, step: 0.01, u: ' м', s: 'tree' },
    { k: 'crown', t: 'range', l: 'Густота кроны', min: 400, max: 4000, step: 50, u: ' точек', s: 'tree', f: fmt },
    { k: 'seg', t: 'range', l: 'Шаг роста', min: 0.14, max: 0.6, step: 0.01, u: ' м', s: 'tree', hint: 'меньше шаг → больше ветвей и полигонов' },
    { k: 'chaos', t: 'range', l: 'Кривизна ветвей', min: 0, max: 1, step: 0.01, s: 'tree', f: pct },
    { k: 'droop', t: 'range', l: 'Гравитация ветвей', min: -0.8, max: 0.5, step: 0.01, s: 'tree', hint: 'минус → плакучая крона' },
    { k: 'shape', t: 'select', l: 'Форма кроны', opts: [['sphere', 'Шар'], ['cone', 'Конус'], ['umbrella', 'Зонт'], ['column', 'Колонна']], s: 'tree' }
  ] },
  { g: 'Листва', items: [
    { k: 'leaves', t: 'range', l: 'Количество листьев', min: 0, max: 60000, step: 500, s: 'leaf', f: fmt },
    { k: 'leafSize', t: 'range', l: 'Размер листа', min: 0.3, max: 2.2, step: 0.05, s: 'leaf' },
    { k: 'leafShape', t: 'select', l: 'Тип листа', opts: [['broad', 'Широкий'], ['needle', 'Игла'], ['bloom', 'Цветок']], s: 'leaf' },
    { k: 'leafColor', t: 'color', l: 'Цвет листвы', s: 'leaf' },
    { k: 'leafVar', t: 'range', l: 'Разброс оттенка', min: 0, max: 1, step: 0.01, s: 'leaf', f: pct }
  ] },
  { g: 'Кора и свет', items: [
    { k: 'barkColor', t: 'color', l: 'Цвет коры', s: 'live' },
    { k: 'sunEl', t: 'range', l: 'Высота солнца', min: 0, max: 1, step: 0.01, s: 'live', f: pct, hint: '0 — ночь, 26% — золотой час' },
    { k: 'sunAz', t: 'range', l: 'Азимут солнца', min: 0, max: 360, step: 1, u: '°', s: 'live' },
    { k: 'lightInt', t: 'range', l: 'Сила света', min: 0.2, max: 2.5, step: 0.05, s: 'live' },
    { k: 'fog', t: 'range', l: 'Туман', min: 0, max: 0.06, step: 0.002, s: 'live' },
    { k: 'bloom', t: 'range', l: 'Свечение', min: 0, max: 1.6, step: 0.02, s: 'live' },
    { k: 'rays', t: 'toggle', l: 'Объёмные лучи', s: 'live' }
  ] },
  { g: 'Атмосфера', items: [
    { k: 'wind', t: 'range', l: 'Ветер', min: 0, max: 1, step: 0.01, s: 'live', f: pct },
    { k: 'particles', t: 'range', l: 'Пыльца в воздухе', min: 0, max: 1500, step: 25, s: 'live', f: fmt },
    { k: 'fireflies', t: 'toggle', l: 'Светлячки', s: 'live' },
    { k: 'grass', t: 'toggle', l: 'Трава и подстилка', s: 'live' }
  ] },
  { g: 'Камера и вывод', items: [
    { k: 'quality', t: 'select', l: 'Качество рендера', opts: [['draft', 'Черновик'], ['game', 'Игра'], ['cine', 'Кино'], ['ultra', 'Ультра']], s: 'quality' },
    { k: 'fov', t: 'range', l: 'Угол обзора', min: 24, max: 75, step: 1, u: '°', s: 'live' },
    { k: 'dist', t: 'range', l: 'Дистанция камеры', min: 4, max: 80, step: 0.5, u: ' м', s: 'live' },
    { k: 'autoRotate', t: 'toggle', l: 'Облёт камеры', s: 'live' },
    { k: 'wireframe', t: 'toggle', l: 'Каркас (wireframe)', s: 'live' },
    { k: 'skeleton', t: 'toggle', l: 'Скелет роста', s: 'live' },
    { k: 'grid', t: 'toggle', l: 'Сетка сцены', s: 'live' },
    { k: 'scaleRef', t: 'toggle', l: 'Фигура 1.8 м для масштаба', s: 'live' }
  ] }
];
const ALL = SCHEMA.flatMap(s => s.items);
const inputs = {}, outputs = {};
function fmtVal(item, v) { return item.f ? item.f(v) : (item.step < 1 ? Number(v).toFixed(2) : String(v)) + (item.u || ''); }
function refreshOne(item) {
  if (item.t !== 'range') return;
  const el = inputs[item.k];
  el.style.setProperty('--p', ((P[item.k] - item.min) / (item.max - item.min) * 100).toFixed(2));
  outputs[item.k].textContent = fmtVal(item, P[item.k]);
}
function buildUI() {
  const gs = $('groups'); gs.innerHTML = '';
  SCHEMA.forEach((sec, si) => {
    const wrap = document.createElement('div'); wrap.className = 'group';
    const h = document.createElement('h3');
    h.dataset.i = String(si + 1).padStart(2, '0'); h.textContent = sec.g;
    wrap.appendChild(h);
    sec.items.forEach(item => {
      const box = document.createElement('div'); box.className = 'ctl';
      if (item.t === 'range') {
        box.innerHTML = `<div class="head"><label for="i_${item.k}">${item.l}</label><output id="o_${item.k}"></output></div>`;
        const el = document.createElement('input');
        el.type = 'range'; el.id = 'i_' + item.k;
        el.min = item.min; el.max = item.max; el.step = item.step; el.value = P[item.k];
        box.appendChild(el);
        if (item.hint) { const hh = document.createElement('div'); hh.className = 'hint'; hh.textContent = item.hint; box.appendChild(hh); }
        el.addEventListener('input', () => { P[item.k] = parseFloat(el.value); refreshOne(item); onParam(item); });
        el.addEventListener('change', () => buzz('LIGHT'));
        inputs[item.k] = el; outputs[item.k] = box.querySelector('output');
      } else if (item.t === 'select') {
        box.innerHTML = `<div class="head"><label for="i_${item.k}">${item.l}</label></div>`;
        const s = document.createElement('div'); s.className = 'sel';
        const el = document.createElement('select'); el.id = 'i_' + item.k;
        item.opts.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; el.appendChild(o); });
        el.value = P[item.k]; s.appendChild(el); box.appendChild(s);
        el.addEventListener('change', () => { P[item.k] = el.value; Sound.tick(520); buzz('LIGHT'); onParam(item); });
        inputs[item.k] = el;
      } else if (item.t === 'color') {
        box.innerHTML = `<div class="head"><label for="i_${item.k}">${item.l}</label></div>`;
        const row = document.createElement('div'); row.className = 'colrow';
        const el = document.createElement('input'); el.type = 'color'; el.id = 'i_' + item.k; el.value = P[item.k];
        const code = document.createElement('code'); code.textContent = P[item.k];
        row.appendChild(el); row.appendChild(code); box.appendChild(row);
        el.addEventListener('input', () => { P[item.k] = el.value; code.textContent = el.value; onParam(item); });
        inputs[item.k] = el; outputs[item.k] = code;
      } else {
        const b = document.createElement('button');
        b.className = 'sw'; b.type = 'button'; b.setAttribute('role', 'switch');
        b.setAttribute('aria-checked', String(!!P[item.k]));
        b.innerHTML = `<span>${item.l}</span><i></i>`;
        b.addEventListener('click', () => {
          P[item.k] = !P[item.k];
          b.setAttribute('aria-checked', String(P[item.k]));
          Sound.tick(P[item.k] ? 760 : 420); buzz('LIGHT'); onParam(item);
        });
        box.appendChild(b); inputs[item.k] = b;
      }
      wrap.appendChild(box);
    });
    gs.appendChild(wrap);
  });
  const pr = $('presets'); pr.innerHTML = '';
  Object.entries(PRESETS).forEach(([k, v]) => {
    const b = document.createElement('button');
    b.className = 'preset' + (k === P.preset ? ' on' : '');
    b.dataset.k = k;
    b.innerHTML = `<span>${v.e}</span>${v.n}`;
    b.addEventListener('click', () => {
      P.preset = k;
      Object.assign(P, v.p);
      if (isMobile) { P.leaves = Math.round(P.leaves * 0.5); P.crown = Math.round(P.crown * 0.75); }
      syncUI(); applyLive(); queue('tree');
      Sound.tick(820); buzz('MEDIUM');
      toast('Вид: ' + v.n + ' · пересобираю скелет');
    });
    pr.appendChild(b);
  });
  syncUI();
}
function syncUI() {
  ALL.forEach(item => {
    const el = inputs[item.k];
    if (!el) return;
    if (item.t === 'range') { el.value = P[item.k]; refreshOne(item); }
    else if (item.t === 'select') el.value = P[item.k];
    else if (item.t === 'color') { el.value = P[item.k]; outputs[item.k].textContent = P[item.k]; }
    else el.setAttribute('aria-checked', String(!!P[item.k]));
  });
  $('seedVal').textContent = P.seed;
  $('seedName').textContent = P.seed;
  $('presetName').textContent = PRESETS[P.preset].n;
  $('btnWire').classList.toggle('on', P.wireframe);
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.k === P.preset));
}
function syncRange(k, v) {
  P[k] = Math.round(v * 2) / 2;
  const item = ALL.find(i => i.k === k);
  if (item && inputs[k]) { inputs[k].value = P[k]; refreshOne(item); }
}
const dirty = { tree: false, leaf: false };
let pendingAt = 0;
function queue(scope) {
  let msg = 'пересборка листвы…';
  if (scope === 'tree') { dirty.tree = true; msg = 'рост дерева…'; }
  else dirty.leaf = true;
  pendingAt = performance.now();
  $('growText').textContent = msg;
  $('growChip').classList.add('show');
}
function onParam(item) {
  if (item.s === 'tree') queue('tree');
  else if (item.s === 'leaf') queue('leaf');
  else if (item.s === 'quality') {
    Q = QUALITY[P.quality];
    key.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    sceneRT.dispose(); sceneRT = makeRT(Q.msaa || 1);
    resize(); queue('tree');
    toast('Качество: ' + Q.n);
  } else applyLive();
}
function applyLive() {
  barkMat.color.set(P.barkColor);
  barkMat.wireframe = P.wireframe; leafMat.wireframe = P.wireframe; grassMat.wireframe = P.wireframe;
  U.wind.value = P.wind; Sound.setWind(P.wind);
  pollen.geometry.setDrawRange(0, Math.round(P.particles));
  pollen.material.uniforms.uColor.value.set(P.preset === 'sakura' ? '#ffc0dc' : '#ffe9b8');
  flies.visible = P.fireflies;
  if (skeleton) skeleton.visible = P.skeleton;
  grid.visible = P.grid; refGroup.visible = P.scaleRef;
  if (!P.grass && (grassMesh || litterMesh)) {
    disposeMesh(grassMesh); disposeMesh(litterMesh);
    grassMesh = null; litterMesh = null;
    renderer.shadowMap.needsUpdate = true;
  } else if (P.grass && !grassMesh) buildGround();
  cam.tRadius = P.dist;
  $('btnWire').classList.toggle('on', P.wireframe);
  applySky();
}

/* ------------------------------------------------------------ stats -- */
let badgeTarget = 0, badgeShown = 0, toastTimer = 0;
function updateStatsUI() {
  const tree = stats.woodTris + stats.leafTris;
  badgeTarget = tree;
  const p = clamp(tree / 400000, 0, 1), f = $('budgetFill');
  f.style.width = (p * 100).toFixed(1) + '%';
  f.style.background = p < 0.3 ? 'linear-gradient(90deg,var(--moss),var(--lime))'
    : p < 0.62 ? 'linear-gradient(90deg,var(--lime),var(--amber))'
    : 'linear-gradient(90deg,var(--amber),var(--danger))';
  $('budgetPct').textContent = Math.round(p * 100) + '%';
  $('mNodes').textContent = fmt(stats.nodes) + ' / ' + fmt(stats.branches);
  $('mLeaves').textContent = fmt(stats.leaves);
  $('mGen').textContent = stats.gen.toFixed(0) + ' мс';
  if (stats.capped) toast('Лимит узлов ' + fmt(Q.maxNodes) + '. Увеличь шаг роста или качество.', 'warn');
}
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'ov show' + (kind === 'warn' ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------------------------------------------------------- exports -- */
async function exportPNG() {
  const g = U.grow.value;
  U.grow.value = 1;
  renderFrame(performance.now());
  let data;
  try { data = renderer.domElement.toDataURL('image/png'); }
  catch (e) { U.grow.value = g; toast('Браузер запретил экспорт кадра', 'warn'); return; }
  U.grow.value = g;
  const msg = await saveArtifact({
    filename: 'drevo-' + P.preset + '-' + P.seed + '.png',
    base64: data.split(',')[1], mime: 'image/png', title: 'Кадр ДРЕВО'
  });
  if (msg) { toast(msg); buzz('MEDIUM'); Sound.tick(900); }
}
async function exportOBJ() {
  if (!wood) { toast('Дерево ещё не выросло', 'warn'); return; }
  const t0 = performance.now();
  const L = ['# DREVO procedural tree lab', '# preset ' + P.preset + ' seed ' + P.seed, '# tris(wood) ' + stats.woodTris, 'o TreeWood'];
  const g = wood.geometry;
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, uv = g.attributes.uv.array, idx = g.index.array;
  const nv = pos.length / 3;
  for (let i = 0; i < nv; i++) L.push('v ' + pos[i * 3].toFixed(4) + ' ' + pos[i * 3 + 1].toFixed(4) + ' ' + pos[i * 3 + 2].toFixed(4));
  for (let i = 0; i < nv; i++) L.push('vn ' + nor[i * 3].toFixed(3) + ' ' + nor[i * 3 + 1].toFixed(3) + ' ' + nor[i * 3 + 2].toFixed(3));
  for (let i = 0; i < nv; i++) L.push('vt ' + uv[i * 2].toFixed(4) + ' ' + uv[i * 2 + 1].toFixed(4));
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] + 1, b = idx[i + 1] + 1, c = idx[i + 2] + 1;
    L.push('f ' + a + '/' + a + '/' + a + ' ' + b + '/' + b + '/' + b + ' ' + c + '/' + c + '/' + c);
  }
  let note = '';
  if (leafMesh) {
    const cap = Math.min(leafMesh.count, isMobile ? 4000 : 8000);
    L.push('o TreeLeaves');
    const lp = leafGeoBase.attributes.position.array, lu = leafGeoBase.attributes.uv.array, li = leafGeoBase.index.array;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    let off = nv;
    for (let n = 0; n < cap; n++) {
      leafMesh.getMatrixAt(n, m);
      for (let i = 0; i < lp.length / 3; i++) {
        v.set(lp[i * 3], lp[i * 3 + 1], lp[i * 3 + 2]).applyMatrix4(m);
        L.push('v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4));
        L.push('vt ' + lu[i * 2].toFixed(3) + ' ' + lu[i * 2 + 1].toFixed(3));
      }
      for (let i = 0; i < li.length; i += 3) {
        const a = off + li[i] + 1, b = off + li[i + 1] + 1, c = off + li[i + 2] + 1;
        L.push('f ' + a + '/' + a + ' ' + b + '/' + b + ' ' + c + '/' + c);
      }
      off += lp.length / 3;
    }
    note = ' + ' + fmt(cap) + ' листьев' + (leafMesh.count > cap ? ' (лимит экспорта)' : '');
  }
  const msg = await saveArtifact({
    filename: 'drevo-' + P.preset + '-' + P.seed + '.obj',
    text: L.join('\n'), mime: 'text/plain', title: 'Модель дерева OBJ'
  });
  if (msg) { toast('OBJ: ствол' + note + ' · ' + (performance.now() - t0).toFixed(0) + ' мс'); buzz('MEDIUM'); Sound.tick(600); }
}

/* --------------------------------------------------------- buttons -- */
function newSeed() { P.seed = 1 + ((Math.random() * 99999) | 0); syncUI(); queue('tree'); Sound.tick(700); buzz('MEDIUM'); }
$('seedMinus').onclick = () => { P.seed = Math.max(1, P.seed - 1); syncUI(); queue('tree'); Sound.tick(500); buzz('LIGHT'); };
$('seedPlus').onclick = () => { P.seed++; syncUI(); queue('tree'); Sound.tick(560); buzz('LIGHT'); };
$('seedDice').onclick = newSeed;
$('btnDice2').onclick = () => $('btnRandom').click();
$('btnCam').onclick = resetCamera;
$('btnWire').onclick = () => { P.wireframe = !P.wireframe; syncUI(); applyLive(); Sound.tick(600); buzz('LIGHT'); toast(P.wireframe ? 'Каркас включён' : 'Каркас выключен'); };
$('btnRandom').onclick = () => {
  const r = Math.random;
  P.seed = 1 + ((r() * 99999) | 0);
  P.height = Math.round(clamp(P.height * (0.85 + r() * 0.35), 4, 24) * 2) / 2;
  P.trunk = Math.round(clamp(P.trunk * (0.8 + r() * 0.45), 0.15, 1.4) * 100) / 100;
  P.chaos = Math.round(clamp(P.chaos + (r() - 0.5) * 0.4, 0, 1) * 100) / 100;
  P.droop = Math.round(clamp(P.droop + (r() - 0.5) * 0.35, -0.8, 0.5) * 100) / 100;
  const c = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL((hsl.h + (r() - 0.5) * 0.10 + 1) % 1, clamp(hsl.s + (r() - 0.5) * 0.15, 0.15, 1), clamp(hsl.l + (r() - 0.5) * 0.1, 0.15, 0.8), THREE.SRGBColorSpace);
  P.leafColor = '#' + c.getHexString(THREE.SRGBColorSpace);
  syncUI(); applyLive(); queue('tree');
  Sound.tick(880); buzz('MEDIUM');
  toast('Новое дерево · seed ' + P.seed);
};
$('btnReset').onclick = () => {
  Object.assign(P, DEFAULTS);
  if (isMobile) { P.leaves = 12000; P.crown = 1400; P.particles = 420; P.dist = 28; }
  if (lowPower && isMobile) { P.leaves = 8000; P.crown = 1100; }
  Q = QUALITY[P.quality];
  key.shadow.mapSize.set(Q.shadow, Q.shadow);
  if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
  sceneRT.dispose(); sceneRT = makeRT(Q.msaa || 1);
  cam.tTheta = CAM_HOME.theta; cam.tPhi = CAM_HOME.phi; cam.tRadius = P.dist;
  syncUI(); applyLive(); resize(); queue('tree');
  Sound.tick(440); buzz('MEDIUM'); toast('Все параметры сброшены');
};
$('btnPng').onclick = exportPNG;
$('btnObj').onclick = exportOBJ;

const sb = $('soundBtn');
sb.onclick = () => {
  Sound.resume(); Sound.setOn(!Sound.on);
  sb.classList.toggle('on', Sound.on);
  sb.classList.toggle('off', !Sound.on);
  sb.setAttribute('aria-pressed', String(Sound.on));
  sb.querySelector('.txt').textContent = Sound.on ? 'ЗВУК' : 'ТИХО';
  buzz('LIGHT');
  if (Sound.on) Sound.tick(760);
};
const fsb = $('fsBtn');
if (NATIVE || !document.documentElement.requestFullscreen) fsb.style.display = 'none';
fsb.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen().catch(() => toast('Полный экран недоступен', 'warn'));
};
document.addEventListener('fullscreenchange', () => {
  fsb.classList.toggle('on', !!document.fullscreenElement);
  resize();
});
addEventListener('keydown', e => {
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'r') $('btnRandom').click();
  else if (k === 'w') $('btnWire').click();
  else if (k === ' ') { e.preventDefault(); P.autoRotate = !P.autoRotate; syncUI(); Sound.tick(520); }
  else if (k === 'arrowleft') { cam.tTheta -= 0.12; markInteract(); }
  else if (k === 'arrowright') { cam.tTheta += 0.12; markInteract(); }
  else if (k === 'arrowup') { cam.tPhi = clamp(cam.tPhi - 0.08, 0.12, 1.52); markInteract(); }
  else if (k === 'arrowdown') { cam.tPhi = clamp(cam.tPhi + 0.08, 0.12, 1.52); markInteract(); }
  else if (k === '+' || k === '=') { cam.tRadius = clamp(cam.tRadius * 0.9, 4, 80); syncRange('dist', cam.tRadius); }
  else if (k === '-') { cam.tRadius = clamp(cam.tRadius * 1.1, 4, 80); syncRange('dist', cam.tRadius); }
});
addEventListener('pointerdown', () => Sound.resume(), { once: true });
if (!isMobile) $('hintText').innerHTML = 'тяни — орбита · колесо — зум · R — новое дерево · W — каркас';

/* ---------------------------------------------------------- resize -- */
function resize() {
  const r = stage.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
  const pr = Math.min(devicePixelRatio || 1, Q.pr, isMobile ? 1.5 : 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const bw = Math.max(2, Math.floor(w * pr)), bh = Math.max(2, Math.floor(h * pr));
  sceneRT.setSize(bw, bh);
  brightA.setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
  brightB.setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
  raysRT.setSize(Math.max(2, bw >> 2), Math.max(2, bh >> 2));
  compMat.uniforms.uRes.value.set(bw, bh);
  compMat.uniforms.uAspect.value = w / h;
  pollen.material.uniforms.uPR.value = pr;
  flies.material.uniforms.uPR.value = pr;
}
let resizePending = false;
new ResizeObserver(() => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; resize(); });
}).observe(stage);
addEventListener('orientationchange', () => setTimeout(resize, 250));
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  stopLoop();
  toast('Контекст WebGL потерян — перезапусти приложение', 'warn');
});
canvas.addEventListener('webglcontextrestored', () => {
  renderer.shadowMap.needsUpdate = true;
  resize(); startLoop();
});

/* ------------------------------------------------------------ loop -- */
let growT = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, hudAt = 0, msAcc = 0, booted = false;
let rafId = 0, running = false;
const gustBars = [...$('gust').children];
function frame(now) {
  if (!running) return;
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if ((dirty.tree || dirty.leaf) && now - pendingAt > 150) {
    const needTree = dirty.tree;
    dirty.tree = false; dirty.leaf = false;
    if (needTree) buildTree(); else buildLeaves();
    applyLive();
    if (!needTree) $('growChip').classList.remove('show');
  }
  if (growT < 1) {
    growT = Math.min(1, growT + dt / 1.7);
    U.grow.value = 1 - Math.pow(1 - growT, 3);
    if (growT >= 1) {
      $('growChip').classList.remove('show');
      key.castShadow = true;
      renderer.shadowMap.needsUpdate = true;
    }
  }
  U.time.value = now * 0.001;
  updateCamera(dt, now);

  const t0 = performance.now();
  renderFrame(now);
  msAcc += performance.now() - t0;

  fpsAcc += dt; fpsN++;
  badgeShown += (badgeTarget - badgeShown) * Math.min(1, dt * 6);
  $('triNum').textContent = fmt(badgeShown);

  if (now - hudAt > 250) {
    const fps = fpsN / Math.max(0.001, fpsAcc), el = $('mFps');
    el.textContent = fps.toFixed(0);
    el.style.color = fps > 50 ? 'var(--ok)' : fps > 28 ? 'var(--warn)' : 'var(--danger)';
    $('mMs').textContent = (msAcc / fpsN).toFixed(1) + ' мс';
    $('mTris').textContent = fmt(renderer.info.render.triangles);
    $('mCalls').textContent = renderer.info.render.calls;
    const gust = 0.62 + 0.38 * Math.sin(now * 0.00031);
    $('mWind').textContent = P.wind.toFixed(2) + ' / ' + gust.toFixed(2);
    for (let i = 0; i < gustBars.length; i++) {
      gustBars[i].style.height = (18 + Math.abs(Math.sin(now * 0.002 + i * 0.7)) * 82 * P.wind * gust).toFixed(0) + '%';
    }
    hudAt = now; fpsAcc = 0; fpsN = 0; msAcc = 0;
  }
  if (!booted) {
    booted = true;
    $('boot').classList.add('hide');
    setTimeout(() => { const b = $('boot'); if (b) b.style.display = 'none'; }, 700);
  }
}
function startLoop() {
  if (running) return;
  running = true;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}
function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
  else { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); }
});
if (NATIVE) {
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); }
      else { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
    });
    App.addListener('backButton', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else App.exitApp();
    });
  }).catch(() => {});
}

/* ----------------------------------------------------------- start -- */
buildUI();
resize();
applyLive();
buildTree();
U.grow.value = 0; growT = 0;
cam.target.set(0, P.height * 0.46, 0);
startLoop();
toast(PRESETS[P.preset].n + ': ' + fmt(stats.woodTris + stats.leafTris) + ' треугольников за ' + stats.gen.toFixed(0) + ' мс');
setTimeout(() => { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }, 9000);

}

/* ============================================================== boot == */
try {
  const probe = document.createElement('canvas');
  const ok = !!(window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl')));
  if (!ok) throw new Error('WebGL не поддерживается этим WebView');
  start();
} catch (err) {
  console.error(err);
  bootFallback('WebGL-сцена не запустилась: ' + err.message + '. Показан 2D-эскиз того же алгоритма ветвления. Обнови Android System WebView или запусти на другом устройстве.');
}
