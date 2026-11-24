import './style.css';
import * as THREE from 'three';
import { clamp, lerp, mulberry32, makeNoise3D } from './noise.js';
import { barkTextures, groundTextures, rockTextures } from './textures.js';
import { createEngine } from './engine.js';
import { createTreeSystem } from './tree.js';
import { createTerrainSystem } from './terrain.js';
import { NATIVE, buzz, saveArtifact, initNative } from './native.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const isMobile = NATIVE || matchMedia('(max-width:960px)').matches || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const lowPower = (navigator.hardwareConcurrency || 8) <= 4;

function bootFallback(msg) {
  $('boot').classList.add('hide');
  $('fallback').classList.add('show');
  $('fbMsg').textContent = msg;
  $('rail').classList.add('locked');
  const c = $('fbCanvas'), x = c.getContext('2d'), W = c.width, H = c.height;
  let t = 0;
  function branch(x0, y0, len, ang, w, d) {
    if (d > 9 || len < 3) return;
    const sway = Math.sin(t * .8 + d) * .035 * (10 - d);
    const x1 = x0 + Math.cos(ang + sway) * len, y1 = y0 + Math.sin(ang + sway) * len;
    x.strokeStyle = d < 3 ? '#6b5138' : '#4d7a3a'; x.lineWidth = Math.max(.7, w);
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    if (d > 5) { x.fillStyle = 'rgba(158,240,26,' + (.1 + Math.random() * .16) + ')'; x.beginPath(); x.arc(x1, y1, 4 + Math.random() * 7, 0, 6.283); x.fill(); }
    branch(x1, y1, len * .74, ang - .42 - Math.random() * .24, w * .66, d + 1);
    branch(x1, y1, len * .76, ang + .38 + Math.random() * .26, w * .66, d + 1);
  }
  (function loop() {
    t += .016;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d2a33'); g.addColorStop(.62, '#2b1d16'); g.addColorStop(1, '#0a1410');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,176,32,.5)'; x.beginPath(); x.arc(W * .78, H * .3, 26, 0, 6.283); x.fill();
    branch(W / 2, H - 16, 62, -Math.PI / 2, 11, 0);
    requestAnimationFrame(loop);
  })();
}

/* ------------------------------------------------------------- state -- */
const DEFAULTS = {
  preset: 'oak', seed: 1337,
  height: 13, trunk: .62, crown: 1900, detail: .55, chaos: .5, droop: .1, shape: 'sphere',
  barkDepth: .7, moss: .45, roots: .55, barkColor: '#6d5439',
  leaves: 24000, leafSize: 1, leafShape: 'cluster', leafColor: '#57bd3f', leafVar: .55, backlight: .45,
  relief: 5.5, tscale: 85, tdetail: .55, tsize: 190, pad: 9,
  grassCount: 16000, grassHeight: .55, grassVar: .6, rocks: 36, flowers: 450, litter: 400,
  sunEl: .26, sunAz: 135, lightInt: 1, fog: .022, bloom: .6, rays: true,
  wind: .35, particles: 700, fireflies: true,
  quality: isMobile ? 'draft' : 'game', fov: 42, dist: 30,
  autoRotate: !reduceMotion, wireframe: false, skeleton: false, grid: false, scaleRef: false
};
const P = Object.assign({}, DEFAULTS);
function mobileTrim() {
  P.leaves = Math.round(P.leaves * .5); P.crown = Math.round(P.crown * .8);
  P.grassCount = 5000; P.flowers = 180; P.rocks = 18; P.litter = 160;
  P.particles = 380; P.tsize = 150; P.dist = 32;
  if (lowPower) { P.leaves = Math.round(P.leaves * .6); P.grassCount = 3000; P.crown = 1100; }
}
if (isMobile) mobileTrim();

const PRESETS = {
  oak: { n: 'Дуб', e: '🌳', p: { height: 13, trunk: .62, crown: 1900, detail: .55, chaos: .5, droop: .1, shape: 'sphere', barkDepth: .75, moss: .45, roots: .6, barkColor: '#6d5439', leaves: 24000, leafSize: 1, leafShape: 'cluster', leafColor: '#57bd3f', leafVar: .55, relief: 5.5, grassHeight: .55, flowers: 450, sunEl: .26, wind: .35 } },
  pine: { n: 'Сосна', e: '🌲', p: { height: 19, trunk: .4, crown: 1500, detail: .5, chaos: .22, droop: -.06, shape: 'cone', barkDepth: .85, moss: .3, roots: .4, barkColor: '#7a5a3c', leaves: 20000, leafSize: 1.25, leafShape: 'needle', leafColor: '#2f7d55', leafVar: .35, relief: 8, grassHeight: .4, flowers: 180, sunEl: .44, wind: .28 } },
  willow: { n: 'Ива', e: '🌿', p: { height: 12, trunk: .7, crown: 2300, detail: .62, chaos: .6, droop: -.6, shape: 'sphere', barkDepth: .9, moss: .6, roots: .7, barkColor: '#5d4c34', leaves: 28000, leafSize: .95, leafShape: 'needle', leafColor: '#8fc94a', leafVar: .5, relief: 3, grassHeight: .7, flowers: 600, sunEl: .2, wind: .58 } },
  sakura: { n: 'Сакура', e: '🌸', p: { height: 10, trunk: .5, crown: 1900, detail: .6, chaos: .62, droop: .06, shape: 'umbrella', barkDepth: .55, moss: .35, roots: .5, barkColor: '#5a4636', leaves: 22000, leafSize: .9, leafShape: 'bloom', leafColor: '#ff8fc4', leafVar: .45, relief: 4, grassHeight: .5, flowers: 900, sunEl: .18, wind: .42 } },
  baobab: { n: 'Баобаб', e: '🪵', p: { height: 11, trunk: 1.1, crown: 900, detail: .4, chaos: .72, droop: .22, shape: 'umbrella', barkDepth: .35, moss: .15, roots: .9, barkColor: '#8a7358', leaves: 8000, leafSize: 1.15, leafShape: 'broad', leafColor: '#6ea844', leafVar: .5, relief: 2.5, grassHeight: .35, flowers: 60, sunEl: .36, wind: .2 } },
  dead: { n: 'Сухостой', e: '🥀', p: { height: 14, trunk: .58, crown: 1300, detail: .65, chaos: .86, droop: .18, shape: 'sphere', barkDepth: 1, moss: .7, roots: .8, barkColor: '#6a6258', leaves: 0, leafSize: 1, leafShape: 'broad', leafColor: '#7a6a4a', leafVar: .5, relief: 7, grassHeight: .8, flowers: 120, sunEl: .07, wind: .52, fireflies: true } }
};
const QUALITY = {
  draft: { n: 'Черновик', radial: 5, maxNodes: 1800, pr: 1.25, shadow: 1024, msaa: 0, leafCap: 16000, blur: 1, landSeg: 96, grassCap: 8000 },
  game: { n: 'Игра', radial: 8, maxNodes: 3400, pr: 1.5, shadow: 2048, msaa: 4, leafCap: 36000, blur: 2, landSeg: 144, grassCap: 22000 },
  cine: { n: 'Кино', radial: 11, maxNodes: 5600, pr: 1.75, shadow: 2048, msaa: 4, leafCap: 60000, blur: 2, landSeg: 192, grassCap: 42000 },
  ultra: { n: 'Ультра', radial: 15, maxNodes: 8600, pr: 2, shadow: 4096, msaa: 4, leafCap: 90000, blur: 3, landSeg: 256, grassCap: 70000 }
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
    this.master = this.ctx.createGain(); this.master.gain.value = this.on ? .85 : 0;
    this.master.connect(this.ctx.destination);
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 2);
    const b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .022 * w) / 1.022; d[i] = last * 3.4; }
    this.buf = b;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    this.bp = this.ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 520; this.bp.Q.value = .65;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2100;
    this.wg = this.ctx.createGain(); this.wg.gain.value = .02;
    src.connect(this.bp); this.bp.connect(lp); lp.connect(this.wg); this.wg.connect(this.master); src.start();
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = .075;
    const lg = this.ctx.createGain(); lg.gain.value = .016;
    lfo.connect(lg); lg.connect(this.wg.gain); lfo.start();
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); if (this.ctx) this.setWind(P.wind); },
  setWind(v) { if (!this.ctx) return; const t = this.ctx.currentTime; this.wg.gain.setTargetAtTime(.012 + v * .105, t, .45); this.bp.frequency.setTargetAtTime(360 + v * 760, t, .5); },
  rustle() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf; s.playbackRate.value = 1.7;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 950;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .09); g.gain.exponentialRampToValueAtTime(.0008, t + .85);
    s.connect(hp); hp.connect(g); g.connect(this.master); s.start(t); s.stop(t + .9);
  },
  tick(f = 680) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.0006, t + .09);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .1);
  },
  setOn(v) { this.on = v; if (this.master) this.master.gain.setTargetAtTime(v ? .85 : 0, this.ctx.currentTime, .06); }
};

/* ============================================================== boot == */
let E, tree, land, U;
try {
  const probe = document.createElement('canvas');
  if (!(window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl')))) throw new Error('WebGL недоступен');
  boot();
} catch (err) {
  console.error(err);
  bootFallback('Сцена не запустилась: ' + err.message + '. Обнови Android System WebView или открой на другом устройстве.');
}

function boot() {
  U = {
    time: { value: 0 }, wind: { value: P.wind }, grow: { value: 0 }, growColor: { value: new THREE.Color('#9ef01a') },
    sunDir: { value: new THREE.Vector3(1, .3, 0).normalize() }, sunView: { value: new THREE.Vector3() },
    sunColor: { value: new THREE.Color('#ffd39a') }, backlight: { value: P.backlight }
  };
  const canvas = $('gl'), stage = $('stage');
  E = createEngine(canvas, stage, U, { quality: Q, mobile: isMobile, grain: reduceMotion ? .012 : .03 });

  const texNoise = makeNoise3D(90210);
  const barkTex = barkTextures(texNoise, isMobile ? 192 : 256);
  const groundTex = groundTextures(texNoise, isMobile ? 192 : 256);
  const rockTex = rockTextures(texNoise, 128);

  tree = createTreeSystem(U, barkTex, isMobile);
  land = createTerrainSystem(U, groundTex, rockTex, isMobile);
  E.scene.add(land.group); E.scene.add(tree.group);

  const grid = new THREE.GridHelper(80, 40, 0x9ef01a, 0x2fbf6a);
  grid.material.transparent = true; grid.material.opacity = .16; grid.visible = false;
  E.scene.add(grid);
  const ref = new THREE.Group(); ref.visible = false; E.scene.add(ref);
  {
    const m = new THREE.MeshStandardMaterial({ color: 0x0e2a24, emissive: 0x38e6ff, emissiveIntensity: .22, roughness: .5, transparent: true, opacity: .62 });
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(.2, 1.05, 6, 12), m); b.position.set(2.6, .85, 0);
    const h = new THREE.Mesh(new THREE.SphereGeometry(.14, 14, 10), m); h.position.set(2.6, 1.62, 0);
    ref.add(b, h);
  }

  /* --------------------------------------------------------- UI ---- */
  const pct = v => Math.round(v * 100) + '%';
  const SCHEMA = [
    { g: 'Каркас дерева', items: [
      { k: 'height', t: 'range', l: 'Высота', min: 4, max: 26, step: .5, u: ' м', s: 'tree' },
      { k: 'trunk', t: 'range', l: 'Толщина ствола', min: .15, max: 1.4, step: .01, u: ' м', s: 'tree' },
      { k: 'crown', t: 'range', l: 'Густота кроны', min: 400, max: 4000, step: 50, u: ' точек', s: 'tree', f: fmt },
      { k: 'detail', t: 'range', l: 'Детализация ветвей', min: 0, max: 1, step: .01, s: 'tree', f: pct, hint: 'мельче шаг → больше полигонов; предел задаёт качество' },
      { k: 'chaos', t: 'range', l: 'Кривизна ветвей', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'droop', t: 'range', l: 'Гравитация ветвей', min: -.8, max: .5, step: .01, s: 'tree', hint: 'минус → плакучая крона' },
      { k: 'shape', t: 'select', l: 'Форма кроны', opts: [['sphere', 'Шар'], ['cone', 'Конус'], ['umbrella', 'Зонт'], ['column', 'Колонна']], s: 'tree' }
    ] },
    { g: 'Кора и корни', items: [
      { k: 'barkDepth', t: 'range', l: 'Глубина борозд', min: 0, max: 1, step: .01, s: 'tree', f: pct, hint: 'борозды режутся в геометрии, не только в нормали' },
      { k: 'moss', t: 'range', l: 'Мох у основания', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'roots', t: 'range', l: 'Корневые лапы', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'barkColor', t: 'color', l: 'Цвет коры', s: 'live' }
    ] },
    { g: 'Листва', items: [
      { k: 'leaves', t: 'range', l: 'Количество листьев', min: 0, max: 60000, step: 500, s: 'leaf', f: fmt },
      { k: 'leafSize', t: 'range', l: 'Размер листа', min: .3, max: 2.2, step: .05, s: 'leaf' },
      { k: 'leafShape', t: 'select', l: 'Тип листа', opts: [['cluster', 'Кисть (кластер)'], ['broad', 'Широкий'], ['needle', 'Игла'], ['bloom', 'Цветок']], s: 'leaf' },
      { k: 'leafColor', t: 'color', l: 'Цвет листвы', s: 'leaf' },
      { k: 'leafVar', t: 'range', l: 'Разброс оттенка', min: 0, max: 1, step: .01, s: 'leaf', f: pct },
      { k: 'backlight', t: 'range', l: 'Просвет на солнце', min: 0, max: 1.2, step: .02, s: 'live' }
    ] },
    { g: 'Ландшафт', items: [
      { k: 'relief', t: 'range', l: 'Высота рельефа', min: 0, max: 16, step: .25, u: ' м', s: 'terrain' },
      { k: 'tscale', t: 'range', l: 'Масштаб холмов', min: 20, max: 220, step: 5, u: ' м', s: 'terrain' },
      { k: 'tdetail', t: 'range', l: 'Изрезанность', min: 0, max: 1, step: .01, s: 'terrain', f: pct },
      { k: 'tsize', t: 'range', l: 'Размер участка', min: 80, max: 320, step: 10, u: ' м', s: 'terrain' },
      { k: 'pad', t: 'range', l: 'Площадка под деревом', min: 2, max: 24, step: .5, u: ' м', s: 'terrain' }
    ] },
    { g: 'Растительность', items: [
      { k: 'grassCount', t: 'range', l: 'Травинок', min: 0, max: 60000, step: 500, s: 'veg', f: fmt },
      { k: 'grassHeight', t: 'range', l: 'Высота травы', min: .1, max: 1.6, step: .05, u: ' м', s: 'veg' },
      { k: 'grassVar', t: 'range', l: 'Разброс цвета травы', min: 0, max: 1, step: .01, s: 'veg', f: pct },
      { k: 'rocks', t: 'range', l: 'Камней', min: 0, max: 140, step: 2, s: 'veg', f: fmt },
      { k: 'flowers', t: 'range', l: 'Цветов', min: 0, max: 2500, step: 25, s: 'veg', f: fmt },
      { k: 'litter', t: 'range', l: 'Опавших листьев', min: 0, max: 1500, step: 25, s: 'veg', f: fmt }
    ] },
    { g: 'Свет и атмосфера', items: [
      { k: 'sunEl', t: 'range', l: 'Высота солнца', min: 0, max: 1, step: .01, s: 'live', f: pct, hint: '0 — ночь, 26% — золотой час' },
      { k: 'sunAz', t: 'range', l: 'Азимут солнца', min: 0, max: 360, step: 1, u: '°', s: 'live' },
      { k: 'lightInt', t: 'range', l: 'Сила света', min: .2, max: 2.5, step: .05, s: 'live' },
      { k: 'fog', t: 'range', l: 'Туман', min: 0, max: .06, step: .002, s: 'live' },
      { k: 'bloom', t: 'range', l: 'Свечение', min: 0, max: 1.6, step: .02, s: 'live' },
      { k: 'rays', t: 'toggle', l: 'Объёмные лучи', s: 'live' },
      { k: 'wind', t: 'range', l: 'Ветер', min: 0, max: 1, step: .01, s: 'live', f: pct },
      { k: 'particles', t: 'range', l: 'Пыльца в воздухе', min: 0, max: 1500, step: 25, s: 'live', f: fmt },
      { k: 'fireflies', t: 'toggle', l: 'Светлячки', s: 'live' }
    ] },
    { g: 'Камера и вывод', items: [
      { k: 'quality', t: 'select', l: 'Качество рендера', opts: [['draft', 'Черновик'], ['game', 'Игра'], ['cine', 'Кино'], ['ultra', 'Ультра']], s: 'quality' },
      { k: 'fov', t: 'range', l: 'Угол обзора', min: 24, max: 75, step: 1, u: '°', s: 'live' },
      { k: 'dist', t: 'range', l: 'Дистанция камеры', min: 3, max: 160, step: .5, u: ' м', s: 'live' },
      { k: 'autoRotate', t: 'toggle', l: 'Облёт камеры', s: 'live' },
      { k: 'wireframe', t: 'toggle', l: 'Каркас (wireframe)', s: 'live' },
      { k: 'skeleton', t: 'toggle', l: 'Скелет роста', s: 'live' },
      { k: 'grid', t: 'toggle', l: 'Сетка сцены', s: 'live' },
      { k: 'scaleRef', t: 'toggle', l: 'Фигура 1.8 м для масштаба', s: 'live' }
    ] }
  ];
  const ALL = SCHEMA.flatMap(s => s.items);
  const byKey = Object.fromEntries(ALL.map(i => [i.k, i]));
  const registry = {};
  const fmtVal = (item, v) => item.f ? item.f(v) : (item.step < 1 ? Number(v).toFixed(2) : String(v)) + (item.u || '');

  function register(item, el, out) {
    (registry[item.k] = registry[item.k] || []).push({ item, el, out });
  }
  function paint(item, el, out) {
    if (item.t === 'range') {
      el.value = P[item.k];
      el.style.setProperty('--p', ((P[item.k] - item.min) / (item.max - item.min) * 100).toFixed(2));
      if (out) out.textContent = fmtVal(item, P[item.k]);
    } else if (item.t === 'select') el.value = P[item.k];
    else if (item.t === 'color') { el.value = P[item.k]; if (out) out.textContent = P[item.k]; }
    else { el.setAttribute('aria-checked', String(!!P[item.k])); el.classList.toggle('on', !!P[item.k]); }
  }
  function makeControl(item, host, compact) {
    const box = document.createElement('div');
    box.className = compact ? 'dockitem' : 'ctl';
    if (item.t === 'range') {
      box.innerHTML = `<div class="head"><label>${item.l}</label><output></output></div>`;
      const el = document.createElement('input');
      el.type = 'range'; el.min = item.min; el.max = item.max; el.step = item.step;
      box.appendChild(el);
      if (item.hint && !compact) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = item.hint; box.appendChild(h); }
      el.addEventListener('input', () => { P[item.k] = parseFloat(el.value); syncKey(item.k); onParam(item); });
      el.addEventListener('change', () => buzz('LIGHT'));
      register(item, el, box.querySelector('output'));
    } else if (item.t === 'select') {
      if (!compact) box.innerHTML = `<div class="head"><label>${item.l}</label></div>`;
      else box.innerHTML = `<div class="head"><label>${item.l}</label></div>`;
      const s = document.createElement('div'); s.className = 'sel';
      const el = document.createElement('select');
      item.opts.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; el.appendChild(o); });
      s.appendChild(el); box.appendChild(s);
      if (compact) box.classList.add('sel');
      el.addEventListener('change', () => { P[item.k] = el.value; syncKey(item.k); Sound.tick(520); buzz('LIGHT'); onParam(item); });
      register(item, el);
    } else if (item.t === 'color') {
      box.innerHTML = `<div class="head"><label>${item.l}</label></div>`;
      const row = document.createElement('div'); row.className = 'colrow';
      const el = document.createElement('input'); el.type = 'color';
      const code = document.createElement('code');
      row.appendChild(el); row.appendChild(code); box.appendChild(row);
      el.addEventListener('input', () => { P[item.k] = el.value; syncKey(item.k); onParam(item); });
      register(item, el, code);
    } else {
      if (compact) {
        const el = document.createElement('button');
        el.className = 'dockbtn'; el.type = 'button'; el.setAttribute('role', 'switch');
        el.textContent = item.l;
        el.addEventListener('click', () => { P[item.k] = !P[item.k]; syncKey(item.k); Sound.tick(P[item.k] ? 760 : 420); buzz('LIGHT'); onParam(item); });
        register(item, el);
        host.appendChild(el);
        return;
      }
      const el = document.createElement('button');
      el.className = 'sw'; el.type = 'button'; el.setAttribute('role', 'switch');
      el.innerHTML = `<span>${item.l}</span><i></i>`;
      el.addEventListener('click', () => { P[item.k] = !P[item.k]; syncKey(item.k); Sound.tick(P[item.k] ? 760 : 420); buzz('LIGHT'); onParam(item); });
      register(item, el);
      box.appendChild(el);
    }
    host.appendChild(box);
  }
  function syncKey(k) { (registry[k] || []).forEach(r => paint(r.item, r.el, r.out)); }
  function syncUI() {
    ALL.forEach(i => syncKey(i.k));
    $('seedVal').textContent = P.seed; $('seedName').textContent = P.seed;
    $('presetName').textContent = PRESETS[P.preset].n;
    $('btnWire').classList.toggle('on', P.wireframe);
    document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.k === P.preset));
  }

  const groups = $('groups');
  SCHEMA.forEach((sec, si) => {
    const wrap = document.createElement('div'); wrap.className = 'group';
    const h = document.createElement('h3'); h.dataset.i = String(si + 1).padStart(2, '0'); h.textContent = sec.g;
    wrap.appendChild(h);
    sec.items.forEach(item => makeControl(item, wrap, false));
    groups.appendChild(wrap);
  });
  const presets = $('presets');
  Object.entries(PRESETS).forEach(([k, v]) => {
    const b = document.createElement('button');
    b.className = 'preset' + (k === P.preset ? ' on' : ''); b.dataset.k = k;
    b.innerHTML = `<span>${v.e}</span>${v.n}`;
    b.addEventListener('click', () => {
      P.preset = k; Object.assign(P, v.p);
      if (isMobile) { P.leaves = Math.round(P.leaves * .5); P.crown = Math.round(P.crown * .8); P.flowers = Math.round(P.flowers * .4); }
      syncUI(); applyLive(); queue('all'); Sound.tick(820); buzz('MEDIUM');
      toast('Вид: ' + v.n);
    });
    presets.appendChild(b);
  });
  const dock = $('dock');
  ['wind', 'sunEl', 'leaves', 'grassCount', 'relief', 'quality', 'wireframe', 'autoRotate'].forEach(k => makeControl(byKey[k], dock, true));
  const dockBtns = document.createElement('div'); dockBtns.className = 'dockbtns';
  const bDice = document.createElement('button'); bDice.className = 'dockbtn'; bDice.textContent = '⚄ Новое';
  bDice.onclick = () => $('btnRandom').click();
  const bHud = document.createElement('button'); bHud.className = 'dockbtn'; bHud.textContent = '◱ Статы';
  bHud.onclick = () => $('hudToggle').click();
  const bExit = document.createElement('button'); bExit.className = 'dockbtn exit'; bExit.textContent = '✕ Выйти';
  bExit.onclick = () => setViewer(false);
  dockBtns.append(bDice, bHud, bExit); dock.appendChild(dockBtns);

  /* ------------------------------------------------- задания ---- */
  const dirty = { tree: false, leaf: false, terrain: false, veg: false };
  let pendingAt = 0, job = null, jobStart = 0;
  function queue(scope) {
    if (scope === 'all') { dirty.tree = dirty.terrain = dirty.veg = true; }
    else if (scope === 'tree') dirty.tree = true;
    else if (scope === 'leaf') dirty.leaf = true;
    else if (scope === 'terrain') { dirty.terrain = true; dirty.veg = true; dirty.tree = true; }
    else if (scope === 'veg') dirty.veg = true;
    pendingAt = performance.now();
    $('growChip').classList.add('show');
  }
  function* combined() {
    land.prepare(P);
    if (dirty.terrain || dirty.veg) {
      yield* land.build(P, Q, dirty.terrain, tree.leafTex[P.leafShape] || tree.leafTex.broad);
      tree.setBase(land.heightAt(0, 0));
    }
    if (dirty.tree || dirty.leaf) {
      if (dirty.tree) yield* tree.build(P, Q, land.heightAt);
      else yield* tree.build(P, Q, land.heightAt);
    }
    dirty.tree = dirty.leaf = dirty.terrain = dirty.veg = false;
    return true;
  }
  function onParam(item) {
    if (item.s === 'live') applyLive();
    else if (item.s === 'quality') {
      Q = QUALITY[P.quality]; E.setQuality(Q); queue('all'); toast('Качество: ' + Q.n);
    } else queue(item.s);
  }
  function applyLive() {
    tree.setColor(P.barkColor);
    tree.setWire(P.wireframe); land.setWire(P.wireframe);
    tree.setSkeleton(P.skeleton);
    U.wind.value = P.wind; U.backlight.value = P.backlight;
    Sound.setWind(P.wind);
    E.flies.visible = P.fireflies;
    grid.visible = P.grid; ref.visible = P.scaleRef;
    const base = land.heightAt(0, 0);
    grid.position.y = base + .02; ref.position.y = base;
    E.setParticles(P.particles, base);
    E.pollen.material.uniforms.uColor.value.set(P.preset === 'sakura' ? '#ffc0dc' : '#ffe9b8');
    E.cam.tRadius = P.dist;
    E.applySky(P, base);
    $('btnWire').classList.toggle('on', P.wireframe);
  }

  /* ------------------------------------------------- кнопки ---- */
  let toastTimer = 0;
  function toast(msg, kind) {
    const t = $('toast'); t.textContent = msg;
    t.className = 'ov show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }
  function setViewer(on) {
    document.body.classList.toggle('viewer', on);
    $('btnViewer').textContent = on ? '⤡' : '⤢';
    $('btnViewer').classList.toggle('on', on);
    if (on) { $('hud').classList.add('collapsed'); $('hudToggle').setAttribute('aria-expanded', 'false'); }
    buzz('MEDIUM'); Sound.tick(on ? 880 : 440);
    requestAnimationFrame(() => E.resize());
    setTimeout(() => E.resize(), 260);
  }
  $('btnViewer').onclick = () => setViewer(!document.body.classList.contains('viewer'));
  $('hudToggle').onclick = () => {
    const c = $('hud').classList.toggle('collapsed');
    $('hudToggle').setAttribute('aria-expanded', String(!c));
    Sound.tick(600); buzz('LIGHT');
  };
  $('btnCam').onclick = () => { E.resetCamera(); Sound.tick(640); buzz('LIGHT'); toast('Камера в исходной точке'); };
  $('btnWire').onclick = () => { P.wireframe = !P.wireframe; syncUI(); applyLive(); Sound.tick(600); buzz('LIGHT'); };
  $('btnDice2').onclick = () => $('btnRandom').click();
  $('seedMinus').onclick = () => { P.seed = Math.max(1, P.seed - 1); syncUI(); queue('all'); Sound.tick(500); buzz('LIGHT'); };
  $('seedPlus').onclick = () => { P.seed++; syncUI(); queue('all'); Sound.tick(560); buzz('LIGHT'); };
  $('seedDice').onclick = () => { P.seed = 1 + ((Math.random() * 99999) | 0); syncUI(); queue('all'); Sound.tick(700); buzz('MEDIUM'); };
  $('btnRandom').onclick = () => {
    const r = Math.random;
    P.seed = 1 + ((r() * 99999) | 0);
    P.height = Math.round(clamp(P.height * (.85 + r() * .35), 4, 26) * 2) / 2;
    P.trunk = Math.round(clamp(P.trunk * (.8 + r() * .45), .15, 1.4) * 100) / 100;
    P.chaos = Math.round(clamp(P.chaos + (r() - .5) * .4, 0, 1) * 100) / 100;
    P.droop = Math.round(clamp(P.droop + (r() - .5) * .35, -.8, .5) * 100) / 100;
    P.relief = Math.round(clamp(P.relief * (.7 + r() * .8), 0, 16) * 4) / 4;
    P.tscale = Math.round(clamp(P.tscale * (.75 + r() * .6), 20, 220) / 5) * 5;
    const c = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl, THREE.SRGBColorSpace);
    c.setHSL((hsl.h + (r() - .5) * .1 + 1) % 1, clamp(hsl.s + (r() - .5) * .15, .15, 1), clamp(hsl.l + (r() - .5) * .1, .15, .8), THREE.SRGBColorSpace);
    P.leafColor = '#' + c.getHexString(THREE.SRGBColorSpace);
    syncUI(); applyLive(); queue('all'); Sound.tick(880); buzz('MEDIUM');
    toast('Новое дерево и ландшафт · seed ' + P.seed);
  };
  $('btnReset').onclick = () => {
    Object.assign(P, DEFAULTS);
    if (isMobile) mobileTrim();
    Q = QUALITY[P.quality]; E.setQuality(Q);
    E.resetCamera(); syncUI(); applyLive(); queue('all');
    Sound.tick(440); buzz('MEDIUM'); toast('Все параметры сброшены');
  };
  $('btnPng').onclick = async () => {
    const g = U.grow.value; U.grow.value = 1;
    E.render(performance.now(), P);
    let data;
    try { data = E.renderer.domElement.toDataURL('image/png'); }
    catch (e) { U.grow.value = g; toast('Экспорт кадра запрещён', 'warn'); return; }
    U.grow.value = g;
    const msg = await saveArtifact({ filename: `drevo-${P.preset}-${P.seed}.png`, base64: data.split(',')[1], mime: 'image/png', title: 'Кадр ДРЕВО' });
    if (msg) { toast(msg); buzz('MEDIUM'); Sound.tick(900); }
  };
  function objFromMesh(mesh, name, out, offset) {
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, idx = g.index;
    if (!pos || !idx) return offset;
    out.push('o ' + name);
    const m = mesh.matrixWorld;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      out.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`);
      if (nor) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); out.push(`vn ${n.x.toFixed(3)} ${n.y.toFixed(3)} ${n.z.toFixed(3)}`); }
      if (uv) out.push(`vt ${uv.getX(i).toFixed(4)} ${uv.getY(i).toFixed(4)}`);
    }
    for (let i = 0; i < idx.count; i += 3) {
      const a = offset + idx.getX(i) + 1, b = offset + idx.getX(i + 1) + 1, c = offset + idx.getX(i + 2) + 1;
      out.push(nor && uv ? `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}` : `f ${a} ${b} ${c}`);
    }
    return offset + pos.count;
  }
  $('btnObj').onclick = async () => {
    if (!tree.wood) { toast('Дерево ещё не выросло', 'warn'); return; }
    const t0 = performance.now();
    tree.group.updateMatrixWorld(true);
    const L = ['# DREVO tree', `# preset ${P.preset} seed ${P.seed}`];
    let off = objFromMesh(tree.wood, 'TreeWood', L, 0);
    let note = '';
    if (tree.leaves) {
      const cap = Math.min(tree.leaves.count, isMobile ? 4000 : 8000);
      const lg = tree.leaves.geometry, lp = lg.attributes.position, lu = lg.attributes.uv, li = lg.index;
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      L.push('o TreeLeaves');
      for (let i = 0; i < cap; i++) {
        tree.leaves.getMatrixAt(i, m);
        m.premultiply(tree.group.matrixWorld);
        for (let j = 0; j < lp.count; j++) {
          v.fromBufferAttribute(lp, j).applyMatrix4(m);
          L.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`);
          L.push(`vt ${lu.getX(j).toFixed(3)} ${lu.getY(j).toFixed(3)}`);
        }
        for (let j = 0; j < li.count; j += 3) {
          const a = off + li.getX(j) + 1, b = off + li.getX(j + 1) + 1, c = off + li.getX(j + 2) + 1;
          L.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
        }
        off += lp.count;
      }
      note = ' + ' + fmt(cap) + ' листьев';
    }
    const msg = await saveArtifact({ filename: `drevo-${P.preset}-${P.seed}.obj`, text: L.join('\n'), mime: 'text/plain', title: 'Модель дерева' });
    if (msg) { toast('OBJ дерева: ствол' + note + ' · ' + (performance.now() - t0).toFixed(0) + ' мс'); buzz('MEDIUM'); }
  };
  $('btnObjLand').onclick = async () => {
    if (!land.land) { toast('Ландшафт ещё не построен', 'warn'); return; }
    const t0 = performance.now();
    land.group.updateMatrixWorld(true);
    const L = ['# DREVO terrain', `# seed ${P.seed} size ${P.tsize}`];
    let off = objFromMesh(land.land, 'Terrain', L, 0);
    if (land.rocks) {
      const rg = land.rocks.geometry, rp = rg.attributes.position, ri = land.rocks.index || rg.index;
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      L.push('o Rocks');
      for (let i = 0; i < land.rocks.count; i++) {
        land.rocks.getMatrixAt(i, m);
        for (let j = 0; j < rp.count; j++) {
          v.fromBufferAttribute(rp, j).applyMatrix4(m);
          L.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`);
        }
        for (let j = 0; j < ri.count; j += 3) L.push(`f ${off + ri.getX(j) + 1} ${off + ri.getX(j + 1) + 1} ${off + ri.getX(j + 2) + 1}`);
        off += rp.count;
      }
    }
    const msg = await saveArtifact({ filename: `drevo-terrain-${P.seed}.obj`, text: L.join('\n'), mime: 'text/plain', title: 'Ландшафт OBJ' });
    if (msg) { toast('OBJ ландшафта · ' + fmt(land.stats.tris) + ' трис · ' + (performance.now() - t0).toFixed(0) + ' мс'); buzz('MEDIUM'); }
  };

  const sb = $('soundBtn');
  sb.onclick = () => {
    Sound.resume(); Sound.setOn(!Sound.on);
    sb.classList.toggle('on', Sound.on); sb.classList.toggle('off', !Sound.on);
    sb.setAttribute('aria-pressed', String(Sound.on));
    sb.querySelector('.txt').textContent = Sound.on ? 'ЗВУК' : 'ТИХО';
    buzz('LIGHT'); if (Sound.on) Sound.tick(760);
  };
  addEventListener('pointerdown', () => Sound.resume(), { once: true });
  addEventListener('keydown', e => {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && document.body.classList.contains('viewer')) setViewer(false);
    else if (k === 'f') setViewer(!document.body.classList.contains('viewer'));
    else if (k === 'h') $('hudToggle').click();
    else if (k === 'r') $('btnRandom').click();
    else if (k === 'w') $('btnWire').click();
    else if (k === ' ') { e.preventDefault(); P.autoRotate = !P.autoRotate; syncUI(); }
    else if (k === 'arrowleft') E.cam.tTheta -= .12;
    else if (k === 'arrowright') E.cam.tTheta += .12;
    else if (k === 'arrowup') E.cam.tPhi = clamp(E.cam.tPhi - .08, .08, 1.53);
    else if (k === 'arrowdown') E.cam.tPhi = clamp(E.cam.tPhi + .08, .08, 1.53);
  });
  E.hooks.interact = () => { Sound.resume(); $('hint').classList.add('gone'); };
  E.hooks.zoom = v => { P.dist = Math.round(v * 2) / 2; syncKey('dist'); };
  if (!isMobile) $('hintText').textContent = 'тяни — орбита · колесо — зум · F — полный экран · H — статы · R — новое';

  /* ------------------------------------------------- цикл ---- */
  let growT = 1, last = performance.now(), fpsAcc = 0, fpsN = 0, msAcc = 0, hudAt = 0, booted = false;
  let rafId = 0, running = false, badgeShown = 0;
  const gustBars = [...$('gust').children];

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;

    if (!job && (dirty.tree || dirty.leaf || dirty.terrain || dirty.veg) && now - pendingAt > 130) {
      job = combined(); jobStart = now;
      U.grow.value = 0; growT = 0;
      E.key.castShadow = false;
    }
    if (job) {
      const t0 = performance.now();
      let r;
      try {
        do { r = job.next(); } while (!r.done && performance.now() - t0 < 6);
      } catch (err) {
        console.error(err); job = null;
        dirty.tree = dirty.leaf = dirty.terrain = dirty.veg = false;
        toast('Ошибка генерации: ' + err.message, 'err');
      }
      if (job && r && !r.done && r.value) {
        $('growText').textContent = r.value.label || 'генерация';
        $('growPct').textContent = Math.round((r.value.p || 0) * 100) + '%';
      }
      if (job && r && r.done) {
        job = null;
        applyLive();
        Sound.rustle();
        E.markShadows();
        if (tree.stats.auto) toast('Шаг роста увеличен до ' + tree.stats.seg.toFixed(2) + ' м — подними качество для большей детализации', 'warn');
      }
    }
    if (growT < 1) {
      growT = Math.min(1, growT + dt / 1.5);
      U.grow.value = 1 - Math.pow(1 - growT, 3);
      if (growT >= 1) {
        $('growChip').classList.remove('show');
        E.key.castShadow = true; E.markShadows();
      }
    }
    U.time.value = now * .001;
    const base = land.heightAt(0, 0);
    E.updateCamera(dt, now, P, base, reduceMotion);

    const t0 = performance.now();
    E.render(now, P);
    msAcc += performance.now() - t0;
    fpsAcc += dt; fpsN++;

    const treeTris = tree.stats.woodTris + tree.stats.leafTris;
    badgeShown += (treeTris - badgeShown) * Math.min(1, dt * 6);
    $('triNum').textContent = fmt(badgeShown);

    if (now - hudAt > 240) {
      const fps = fpsN / Math.max(.001, fpsAcc);
      const el = $('mFps');
      el.textContent = fps.toFixed(0);
      el.style.color = fps > 50 ? 'var(--ok)' : fps > 28 ? 'var(--warn)' : 'var(--danger)';
      $('mMs').textContent = (msAcc / fpsN).toFixed(1) + ' мс';
      $('mTris').textContent = fmt(E.renderer.info.render.triangles);
      $('mCalls').textContent = E.renderer.info.render.calls;
      $('mNodes').textContent = fmt(tree.stats.nodes) + ' / ' + fmt(tree.stats.branches);
      $('mSeg').textContent = tree.stats.seg.toFixed(2) + ' м' + (tree.stats.auto ? ' авто' : '');
      $('mLeaves').textContent = fmt(tree.stats.leaves);
      $('mGrass').textContent = fmt(land.stats.grass) + ' / ' + fmt(land.stats.flowers);
      $('mLand').textContent = fmt(land.stats.tris);
      $('mGen').textContent = (tree.stats.ms + land.stats.ms).toFixed(0) + ' мс';
      const gust = .55 + .45 * Math.sin(now * .00031);
      $('mWind').textContent = P.wind.toFixed(2) + ' / ' + gust.toFixed(2);
      $('hudMini').textContent = fps.toFixed(0) + ' fps · ' + fmt(treeTris) + ' трис';
      for (let i = 0; i < gustBars.length; i++) gustBars[i].style.height = (18 + Math.abs(Math.sin(now * .002 + i * .7)) * 82 * P.wind * gust).toFixed(0) + '%';
      const p = clamp(treeTris / 400000, 0, 1), f = $('budgetFill');
      f.style.width = (p * 100).toFixed(1) + '%';
      f.style.background = p < .3 ? 'linear-gradient(90deg,var(--moss),var(--lime))' : p < .62 ? 'linear-gradient(90deg,var(--lime),var(--amber))' : 'linear-gradient(90deg,var(--amber),var(--danger))';
      $('budgetPct').textContent = Math.round(p * 100) + '%';
      hudAt = now; fpsAcc = 0; fpsN = 0; msAcc = 0;
    }
    if (!booted) {
      booted = true;
      $('boot').classList.add('hide');
      setTimeout(() => { const b = $('boot'); if (b) b.style.display = 'none'; }, 700);
    }
  }
  function startLoop() { if (running) return; running = true; last = performance.now(); rafId = requestAnimationFrame(frame); }
  function stopLoop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  let resizePending = false;
  new ResizeObserver(() => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => { resizePending = false; E.resize(); });
  }).observe(stage);
  addEventListener('orientationchange', () => setTimeout(() => E.resize(), 250));
  E.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); stopLoop(); toast('Контекст WebGL потерян — перезапусти приложение', 'err'); });
  E.renderer.domElement.addEventListener('webglcontextrestored', () => { E.resize(); E.markShadows(); startLoop(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
    else { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); }
  });
  initNative({
    onBack: exit => { if (document.body.classList.contains('viewer')) setViewer(false); else exit(); },
    onActive: () => { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); },
    onInactive: () => { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
  });

  /* ------------------------------------------------- старт ---- */
  syncUI();
  E.resize();
  land.prepare(P);
  applyLive();
  queue('all');
  startLoop();
  setTimeout(() => $('hint').classList.add('gone'), 9000);
}
