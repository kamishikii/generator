import './style.css';
import * as THREE from 'three';
import { clamp, lerp, mulberry32, makeNoise3D } from './noise.js';
import { barkTextures, barkJob, groundTextures, rockTextures } from './textures.js';
import { createEngine } from './engine.js';
import { createForest, TREE_KEYS } from './tree.js';
import { createTerrainSystem } from './terrain.js';
import { createWater } from './water.js';
import { collectWorld, partsStats, toOBJ, toGLB } from './export.js';
import { NATIVE, buzz, saveArtifact, initNative } from './native.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const isMobile = NATIVE || matchMedia('(max-width:960px)').matches || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const lowPower = (navigator.hardwareConcurrency || 8) <= 4;

function bootFallback(msg) {
  $('boot').classList.add('hide'); $('fallback').classList.add('show');
  $('fbMsg').textContent = msg; $('rail').classList.add('locked');
  const c = $('fbCanvas'), x = c.getContext('2d'), W = c.width, H = c.height; let t = 0;
  (function loop() {
    t += .016;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d2a33'); g.addColorStop(.62, '#2b1d16'); g.addColorStop(1, '#0a1410');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const br = (x0, y0, len, ang, w, d) => {
      if (d > 9 || len < 3) return;
      const s = Math.sin(t * .8 + d) * .035 * (10 - d);
      const x1 = x0 + Math.cos(ang + s) * len, y1 = y0 + Math.sin(ang + s) * len;
      x.strokeStyle = d < 3 ? '#6b5138' : '#4d7a3a'; x.lineWidth = Math.max(.7, w);
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
      br(x1, y1, len * .74, ang - .45, w * .66, d + 1); br(x1, y1, len * .76, ang + .42, w * .66, d + 1);
    };
    br(W / 2, H - 16, 62, -Math.PI / 2, 11, 0);
    requestAnimationFrame(loop);
  })();
}

const DEFAULTS = {
  preset: 'oak', seed: 1337,
  height: 13, trunk: .62, crown: 1900, detail: .6, chaos: .5, droop: .1, shape: 'sphere',
  barkDepth: .75, moss: .45, roots: .6, barkColor: '#6d5439', barkRes: 256,
  leaves: 26000, leafSize: 1, leafShape: 'cluster', leafColor: '#57bd3f', leafVar: .55, litter: 260, backlight: .45,
  treeCount: 4, scatter: 42, variation: .45,
  relief: 6, tscale: 90, tdetail: .55, tsize: 260, landDetail: .5, pad: 9,
  water: true, waterLevel: -2.2, waves: .6, river: true, riverWidth: 7, riverDepth: 3, riverMeander: .6, riverOffset: 34,
  grassCount: 30000, grassRadius: 16, grassHeight: .6, grassVar: .6, rocks: 40, flowers: 500,
  sunEl: .26, sunAz: 135, lightInt: 1, fog: .014, bloom: .6, rays: true,
  wind: .35, particles: 700, fireflies: true,
  quality: isMobile ? 'draft' : 'game', fov: 45, dist: 40, focusX: 0, focusZ: 0,
  autoRotate: !reduceMotion, wireframe: false, skeleton: false, grid: false, scaleRef: false
};
const P = Object.assign({}, DEFAULTS);
function trim() {
  P.leaves = Math.round(P.leaves * .45); P.crown = Math.round(P.crown * .8);
  P.grassCount = 9000; P.flowers = 200; P.rocks = 20; P.litter = 120;
  P.particles = 380; P.tsize = 190; P.dist = 42; P.treeCount = 3; P.scatter = 32; P.barkRes = 192;
  if (lowPower) { P.leaves = Math.round(P.leaves * .6); P.grassCount = 5000; P.crown = 1100; P.treeCount = 2; }
}
if (isMobile) trim();

const PRESETS = {
  oak: { n: 'Дуб', e: '🌳', p: { height: 13, trunk: .62, crown: 1900, detail: .6, chaos: .5, droop: .1, shape: 'sphere', barkDepth: .75, moss: .45, roots: .6, barkColor: '#6d5439', leaves: 26000, leafSize: 1, leafShape: 'cluster', leafColor: '#57bd3f', leafVar: .55 } },
  pine: { n: 'Сосна', e: '🌲', p: { height: 19, trunk: .4, crown: 1500, detail: .55, chaos: .22, droop: -.06, shape: 'cone', barkDepth: .9, moss: .3, roots: .4, barkColor: '#7a5a3c', leaves: 22000, leafSize: 1.25, leafShape: 'needle', leafColor: '#2f7d55', leafVar: .35 } },
  willow: { n: 'Ива', e: '🌿', p: { height: 12, trunk: .7, crown: 2300, detail: .65, chaos: .6, droop: -.6, shape: 'sphere', barkDepth: .95, moss: .6, roots: .7, barkColor: '#5d4c34', leaves: 30000, leafSize: .95, leafShape: 'needle', leafColor: '#8fc94a', leafVar: .5 } },
  sakura: { n: 'Сакура', e: '🌸', p: { height: 10, trunk: .5, crown: 1900, detail: .62, chaos: .62, droop: .06, shape: 'umbrella', barkDepth: .55, moss: .35, roots: .5, barkColor: '#5a4636', leaves: 24000, leafSize: .9, leafShape: 'bloom', leafColor: '#ff8fc4', leafVar: .45 } },
  baobab: { n: 'Баобаб', e: '🪵', p: { height: 11, trunk: 1.1, crown: 900, detail: .45, chaos: .72, droop: .22, shape: 'umbrella', barkDepth: .35, moss: .15, roots: .9, barkColor: '#8a7358', leaves: 9000, leafSize: 1.15, leafShape: 'broad', leafColor: '#6ea844', leafVar: .5 } },
  dead: { n: 'Сухостой', e: '🥀', p: { height: 14, trunk: .58, crown: 1300, detail: .7, chaos: .86, droop: .18, shape: 'sphere', barkDepth: 1, moss: .7, roots: .8, barkColor: '#6a6258', leaves: 0, leafSize: 1, leafShape: 'broad', leafColor: '#7a6a4a', leafVar: .5 } },
  mix: { n: 'Микс-лес', e: '🌳🌲', p: { treeCount: 8, scatter: 60, variation: .8 } }
};
const QUALITY = {
  draft: { n: 'Черновик', radial: 5, maxNodes: 1800, pr: 1.25, shadow: 1024, msaa: 0, leafCap: 16000, blur: 1, landSeg: 128, grassCap: 14000, heightRes: 192, rockDetail: 1, treeCap: 6 },
  game: { n: 'Игра', radial: 8, maxNodes: 3600, pr: 1.5, shadow: 2048, msaa: 4, leafCap: 40000, blur: 2, landSeg: 192, grassCap: 40000, heightRes: 256, rockDetail: 1, treeCap: 12 },
  cine: { n: 'Кино', radial: 12, maxNodes: 6500, pr: 1.75, shadow: 2048, msaa: 4, leafCap: 70000, blur: 2, landSeg: 320, grassCap: 90000, heightRes: 384, rockDetail: 2, treeCap: 20 },
  ultra: { n: 'Ультра', radial: 16, maxNodes: 11000, pr: 2, shadow: 4096, msaa: 4, leafCap: 110000, blur: 3, landSeg: 448, grassCap: 150000, heightRes: 512, rockDetail: 2, treeCap: 32 },
  prime: { n: 'Прайм', radial: 22, maxNodes: 18000, pr: 2, shadow: 4096, msaa: 4, leafCap: 180000, blur: 3, landSeg: 640, grassCap: 240000, heightRes: 640, rockDetail: 3, treeCap: 48 }
};
let Q = QUALITY[P.quality];

const Sound = {
  ctx: null, on: true, master: null, wg: null, bp: null, buf: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { this.on = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.on ? .85 : 0; this.master.connect(this.ctx.destination);
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 2), b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .022 * w) / 1.022; d[i] = last * 3.4; }
    this.buf = b;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    this.bp = this.ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 520; this.bp.Q.value = .65;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2100;
    this.wg = this.ctx.createGain(); this.wg.gain.value = .02;
    src.connect(this.bp); this.bp.connect(lp); lp.connect(this.wg); this.wg.connect(this.master); src.start();
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = .075;
    const lg = this.ctx.createGain(); lg.gain.value = .016; lfo.connect(lg); lg.connect(this.wg.gain); lfo.start();
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); if (this.ctx) this.setWind(P.wind); },
  setWind(v) { if (!this.ctx) return; const t = this.ctx.currentTime; this.wg.gain.setTargetAtTime(.012 + v * .105, t, .45); this.bp.frequency.setTargetAtTime(360 + v * 760, t, .5); },
  rustle() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime, s = this.ctx.createBufferSource();
    s.buffer = this.buf; s.playbackRate.value = 1.7;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 950;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.11, t + .09); g.gain.exponentialRampToValueAtTime(.0008, t + .8);
    s.connect(hp); hp.connect(g); g.connect(this.master); s.start(t); s.stop(t + .85);
  },
  tick(f = 680) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.0006, t + .09);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .1);
  },
  setOn(v) { this.on = v; if (this.master) this.master.gain.setTargetAtTime(v ? .85 : 0, this.ctx.currentTime, .06); }
};

let E, forest, land, water, U;
try {
  const probe = document.createElement('canvas');
  if (!(window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl')))) throw new Error('WebGL недоступен');
  boot();
} catch (err) { console.error(err); bootFallback('Сцена не запустилась: ' + err.message); }

function boot() {
  U = {
    time: { value: 0 }, wind: { value: P.wind }, grow: { value: 0 }, growColor: { value: new THREE.Color('#9ef01a') },
    sunDir: { value: new THREE.Vector3(1, .3, 0).normalize() }, sunView: { value: new THREE.Vector3() }, backlight: { value: P.backlight }
  };
  const canvas = $('gl'), stage = $('stage');
  E = createEngine(canvas, stage, U, { quality: Q, mobile: isMobile, grain: reduceMotion ? .012 : .03 });
  const texNoise = makeNoise3D(90210);
  const barkTex = barkTextures(texNoise, P.barkRes);
  forest = createForest(U, barkTex, isMobile);
  land = createTerrainSystem(U, groundTextures(texNoise, isMobile ? 192 : 256), rockTextures(texNoise, 128), isMobile);
  water = createWater(U);
  E.scene.add(land.group); E.scene.add(forest.group); E.scene.add(water.mesh);
  const grid = new THREE.GridHelper(200, 100, 0x9ef01a, 0x2fbf6a);
  grid.material.transparent = true; grid.material.opacity = .14; grid.visible = false; E.scene.add(grid);
  const ref = new THREE.Group(); ref.visible = false; E.scene.add(ref);
  { const m = new THREE.MeshStandardMaterial({ color: 0x0e2a24, emissive: 0x38e6ff, emissiveIntensity: .22, transparent: true, opacity: .62 });
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(.2, 1.05, 6, 12), m); b.position.set(2.6, .85, 0);
    const h = new THREE.Mesh(new THREE.SphereGeometry(.14, 14, 10), m); h.position.set(2.6, 1.62, 0); ref.add(b, h); }

  let selected = null;
  const target = () => selected ? selected.p : P;
  const isTreeKey = i => i.s === 'tree' || i.s === 'leaf';
  const getVal = i => isTreeKey(i) ? target()[i.k] : P[i.k];

  /* ---------------- UI ---------------- */
  const pct = v => Math.round(v * 100) + '%';
  const SCHEMA = [
    { g: 'Лес', items: [
      { k: 'treeCount', t: 'range', l: 'Деревьев', min: 1, max: 48, step: 1, s: 'forest', f: fmt, hint: 'лимит зависит от качества' },
      { k: 'scatter', t: 'range', l: 'Разброс по участку', min: 6, max: 240, step: 2, u: ' м', s: 'forest' },
      { k: 'variation', t: 'range', l: 'Разнообразие деревьев', min: 0, max: 1, step: .01, s: 'forest', f: pct }
    ] },
    { g: 'Каркас дерева', items: [
      { k: 'height', t: 'range', l: 'Высота', min: 4, max: 30, step: .5, u: ' м', s: 'tree' },
      { k: 'trunk', t: 'range', l: 'Толщина ствола', min: .15, max: 1.6, step: .01, u: ' м', s: 'tree' },
      { k: 'crown', t: 'range', l: 'Густота кроны', min: 400, max: 8000, step: 50, s: 'tree', f: fmt },
      { k: 'detail', t: 'range', l: 'Детализация ветвей', min: 0, max: 1, step: .01, s: 'tree', f: pct, hint: 'предел детализации задаёт качество рендера' },
      { k: 'chaos', t: 'range', l: 'Кривизна', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'droop', t: 'range', l: 'Гравитация ветвей', min: -.8, max: .5, step: .01, s: 'tree' },
      { k: 'shape', t: 'select', l: 'Форма кроны', opts: [['sphere', 'Шар'], ['cone', 'Конус'], ['umbrella', 'Зонт'], ['column', 'Колонна']], s: 'tree' }
    ] },
    { g: 'Кора и корни', items: [
      { k: 'barkDepth', t: 'range', l: 'Глубина борозд', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'barkRes', t: 'select', l: 'Разрешение текстуры коры', opts: [[192, '192×384'], [256, '256×512'], [384, '384×768'], [512, '512×1024'], [768, '768×1536']], s: 'bark' },
      { k: 'moss', t: 'range', l: 'Мох у основания', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'roots', t: 'range', l: 'Корневые лапы', min: 0, max: 1, step: .01, s: 'tree', f: pct },
      { k: 'barkColor', t: 'color', l: 'Цвет коры', s: 'tree' }
    ] },
    { g: 'Листва', items: [
      { k: 'leaves', t: 'range', l: 'Листьев на дерево', min: 0, max: 180000, step: 1000, s: 'leaf', f: fmt },
      { k: 'leafSize', t: 'range', l: 'Размер листа', min: .3, max: 2.4, step: .05, s: 'leaf' },
      { k: 'leafShape', t: 'select', l: 'Тип листа', opts: [['cluster', 'Кисть'], ['broad', 'Широкий'], ['needle', 'Игла'], ['bloom', 'Цветок']], s: 'leaf' },
      { k: 'leafColor', t: 'color', l: 'Цвет листвы', s: 'leaf' },
      { k: 'leafVar', t: 'range', l: 'Разброс оттенка', min: 0, max: 1, step: .01, s: 'leaf', f: pct },
      { k: 'litter', t: 'range', l: 'Опавших листьев', min: 0, max: 1200, step: 20, s: 'leaf', f: fmt },
      { k: 'backlight', t: 'range', l: 'Просвет на солнце', min: 0, max: 1.2, step: .02, s: 'live' }
    ] },
    { g: 'Ландшафт', items: [
      { k: 'tsize', t: 'range', l: 'Размер участка', min: 80, max: 900, step: 10, u: ' м', s: 'terrain' },
      { k: 'relief', t: 'range', l: 'Высота рельефа', min: 0, max: 40, step: .5, u: ' м', s: 'terrain' },
      { k: 'tscale', t: 'range', l: 'Масштаб холмов', min: 20, max: 400, step: 5, u: ' м', s: 'terrain' },
      { k: 'tdetail', t: 'range', l: 'Изрезанность', min: 0, max: 1, step: .01, s: 'terrain', f: pct },
      { k: 'landDetail', t: 'range', l: 'Сетка ландшафта', min: 0, max: 1, step: .01, s: 'terrain', f: pct, hint: 'выше → мельче полигоны земли' },
      { k: 'pad', t: 'range', l: 'Площадка под первым деревом', min: 2, max: 30, step: .5, u: ' м', s: 'terrain' }
    ] },
    { g: 'Реки и озёра', items: [
      { k: 'water', t: 'toggle', l: 'Вода', s: 'water' },
      { k: 'waterLevel', t: 'range', l: 'Уровень воды', min: -20, max: 12, step: .2, u: ' м', s: 'water', hint: 'озёра появляются там, где рельеф ниже уровня' },
      { k: 'waves', t: 'range', l: 'Волны', min: 0, max: 1, step: .01, s: 'live', f: pct },
      { k: 'river', t: 'toggle', l: 'Река', s: 'terrain' },
      { k: 'riverWidth', t: 'range', l: 'Ширина русла', min: 2, max: 40, step: .5, u: ' м', s: 'terrain' },
      { k: 'riverDepth', t: 'range', l: 'Глубина русла', min: .5, max: 14, step: .25, u: ' м', s: 'terrain' },
      { k: 'riverMeander', t: 'range', l: 'Извилистость', min: 0, max: 1, step: .01, s: 'terrain', f: pct },
      { k: 'riverOffset', t: 'range', l: 'Смещение русла', min: -160, max: 160, step: 2, u: ' м', s: 'terrain' }
    ] },
    { g: 'Трава и камни', items: [
      { k: 'grassCount', t: 'range', l: 'Травинок', min: 0, max: 240000, step: 1000, s: 'veg', f: fmt },
      { k: 'grassRadius', t: 'range', l: 'Радиус травы', min: 4, max: 160, step: 1, u: ' м', s: 'veg', hint: 'меньше радиус → гуще ковёр' },
      { k: 'grassHeight', t: 'range', l: 'Высота травы', min: .1, max: 2, step: .05, u: ' м', s: 'veg' },
      { k: 'grassVar', t: 'range', l: 'Разброс цвета', min: 0, max: 1, step: .01, s: 'veg', f: pct },
      { k: 'rocks', t: 'range', l: 'Камней', min: 0, max: 200, step: 2, s: 'veg', f: fmt },
      { k: 'flowers', t: 'range', l: 'Цветов', min: 0, max: 4000, step: 25, s: 'veg', f: fmt }
    ] },
    { g: 'Свет и атмосфера', items: [
      { k: 'sunEl', t: 'range', l: 'Высота солнца', min: 0, max: 1, step: .01, s: 'live', f: pct },
      { k: 'sunAz', t: 'range', l: 'Азимут солнца', min: 0, max: 360, step: 1, u: '°', s: 'live' },
      { k: 'lightInt', t: 'range', l: 'Сила света', min: .2, max: 2.5, step: .05, s: 'live' },
      { k: 'fog', t: 'range', l: 'Туман', min: 0, max: .05, step: .001, s: 'live' },
      { k: 'bloom', t: 'range', l: 'Свечение', min: 0, max: 1.6, step: .02, s: 'live' },
      { k: 'rays', t: 'toggle', l: 'Объёмные лучи', s: 'live' },
      { k: 'wind', t: 'range', l: 'Ветер', min: 0, max: 1, step: .01, s: 'live', f: pct },
      { k: 'particles', t: 'range', l: 'Пыльца', min: 0, max: 1500, step: 25, s: 'live', f: fmt },
      { k: 'fireflies', t: 'toggle', l: 'Светлячки', s: 'live' }
    ] },
    { g: 'Камера и вывод', items: [
      { k: 'quality', t: 'select', l: 'Качество', opts: [['draft', 'Черновик'], ['game', 'Игра'], ['cine', 'Кино'], ['ultra', 'Ультра'], ['prime', 'Прайм']], s: 'quality' },
      { k: 'fov', t: 'range', l: 'Угол обзора', min: 24, max: 80, step: 1, u: '°', s: 'live' },
      { k: 'dist', t: 'range', l: 'Дистанция', min: 3, max: 700, step: 1, u: ' м', s: 'live' },
      { k: 'autoRotate', t: 'toggle', l: 'Облёт камеры', s: 'live' },
      { k: 'wireframe', t: 'toggle', l: 'Каркас', s: 'live' },
      { k: 'skeleton', t: 'toggle', l: 'Скелет роста', s: 'live' },
      { k: 'grid', t: 'toggle', l: 'Сетка', s: 'live' },
      { k: 'scaleRef', t: 'toggle', l: 'Фигура 1.8 м', s: 'live' }
    ] }
  ];
  const ALL = SCHEMA.flatMap(s => s.items);
  const byKey = Object.fromEntries(ALL.map(i => [i.k, i]));
  const registry = {};
  const fmtVal = (i, v) => i.f ? i.f(v) : (i.step < 1 ? Number(v).toFixed(2) : String(v)) + (i.u || '');
  function paint(i, el, out) {
    const v = getVal(i);
    if (i.t === 'range') { el.value = v; el.style.setProperty('--p', ((v - i.min) / (i.max - i.min) * 100).toFixed(2)); if (out) out.textContent = fmtVal(i, v); }
    else if (i.t === 'select') el.value = String(v);
    else if (i.t === 'color') { el.value = v; if (out) out.textContent = v; }
    else { el.setAttribute('aria-checked', String(!!v)); el.classList.toggle('on', !!v); }
  }
  function syncKey(k) { (registry[k] || []).forEach(r => paint(r.item, r.el, r.out)); }
  function syncUI() {
    ALL.forEach(i => syncKey(i.k));
    $('seedVal').textContent = P.seed; $('seedName').textContent = P.seed;
    $('presetName').textContent = PRESETS[P.preset].n;
    $('treeCount').textContent = forest.trees.length;
    $('btnWire').classList.toggle('on', P.wireframe);
    document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.k === P.preset));
    $('selChip').classList.toggle('show', !!selected);
    if (selected) $('selText').textContent = 'дерево #' + selected.id;
  }
  function makeControl(i, host, compact) {
    const box = document.createElement('div'); box.className = compact ? 'dockitem' : 'ctl';
    if (i.t === 'toggle' && compact) {
      const el = document.createElement('button'); el.className = 'dockbtn'; el.textContent = i.l;
      el.setAttribute('role', 'switch');
      el.onclick = () => { setVal(i, !getVal(i)); Sound.tick(700); buzz('LIGHT'); onParam(i); };
      (registry[i.k] = registry[i.k] || []).push({ item: i, el }); host.appendChild(el); return;
    }
    if (i.t === 'range') {
      box.innerHTML = `<div class="head"><label>${i.l}</label><output></output></div>`;
      const el = document.createElement('input'); el.type = 'range'; el.min = i.min; el.max = i.max; el.step = i.step;
      box.appendChild(el);
      if (i.hint && !compact) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = i.hint; box.appendChild(h); }
      el.addEventListener('input', () => { setVal(i, parseFloat(el.value)); syncKey(i.k); onParam(i); });
      el.addEventListener('change', () => buzz('LIGHT'));
      (registry[i.k] = registry[i.k] || []).push({ item: i, el, out: box.querySelector('output') });
    } else if (i.t === 'select') {
      box.innerHTML = `<div class="head"><label>${i.l}</label></div>`;
      const s = document.createElement('div'); s.className = 'sel';
      const el = document.createElement('select');
      i.op
