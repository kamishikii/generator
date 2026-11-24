
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
      i.opts.forEach(([v, n]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = n; el.appendChild(o); });
      s.appendChild(el); box.appendChild(s);
      el.addEventListener('change', () => { setVal(i, isNaN(+el.value) ? el.value : +el.value); syncKey(i.k); Sound.tick(520); buzz('LIGHT'); onParam(i); });
      (registry[i.k] = registry[i.k] || []).push({ item: i, el });
    } else if (i.t === 'color') {
      box.innerHTML = `<div class="head"><label>${i.l}</label></div>`;
      const row = document.createElement('div'); row.className = 'colrow';
      const el = document.createElement('input'); el.type = 'color'; const code = document.createElement('code');
      row.append(el, code); box.appendChild(row);
      el.addEventListener('input', () => { setVal(i, el.value); syncKey(i.k); onParam(i); });
      (registry[i.k] = registry[i.k] || []).push({ item: i, el, out: code });
    } else {
      const el = document.createElement('button'); el.className = 'sw'; el.setAttribute('role', 'switch');
      el.innerHTML = `<span>${i.l}</span><i></i>`;
      el.onclick = () => { setVal(i, !getVal(i)); syncKey(i.k); Sound.tick(700); buzz('LIGHT'); onParam(i); };
      (registry[i.k] = registry[i.k] || []).push({ item: i, el }); box.appendChild(el);
    }
    host.appendChild(box);
  }
  function setVal(i, v) { if (isTreeKey(i)) target()[i.k] = v; else P[i.k] = v; }

  SCHEMA.forEach((sec, si) => {
    const wrap = document.createElement('div'); wrap.className = 'group';
    const h = document.createElement('h3'); h.dataset.i = String(si + 1).padStart(2, '0'); h.textContent = sec.g;
    wrap.appendChild(h); sec.items.forEach(i => makeControl(i, wrap, false));
    $('groups').appendChild(wrap);
  });
  Object.entries(PRESETS).forEach(([k, v]) => {
    const b = document.createElement('button'); b.className = 'preset'; b.dataset.k = k;
    b.innerHTML = `<span>${v.e}</span>${v.n}`;
    b.onclick = () => {
      P.preset = k; Object.assign(target(), v.p);
      if (isMobile && v.p.leaves) target().leaves = Math.round(v.p.leaves * .45);
      if (k === 'mix') { selected = null; forest.select(null); }
      syncUI(); applyLive(); queue(selected ? 'one' : 'all'); Sound.tick(820); buzz('MEDIUM'); toast('Вид: ' + v.n);
    };
    $('presets').appendChild(b);
  });
  ['wind', 'sunEl', 'waterLevel', 'grassCount', 'treeCount', 'quality', 'wireframe', 'autoRotate'].forEach(k => makeControl(byKey[k], $('dock'), true));
  const db = document.createElement('div'); db.className = 'dockbtns';
  const b1 = document.createElement('button'); b1.className = 'dockbtn'; b1.textContent = '⚄ Мир'; b1.onclick = () => $('btnRandom').click();
  const b2 = document.createElement('button'); b2.className = 'dockbtn'; b2.textContent = '◱ Статы'; b2.onclick = () => $('hudToggle').click();
  const b3 = document.createElement('button'); b3.className = 'dockbtn exit'; b3.textContent = '✕ Выйти'; b3.onclick = () => setViewer(false);
  db.append(b1, b2, b3); $('dock').appendChild(db);

  const EXP = { wood: true, leaves: true, land: true, rocks: true, grass: false, water: true, leafCap: isMobile ? 6000 : 20000, grassCap: isMobile ? 8000 : 30000 };
  [['wood', 'стволы'], ['leaves', 'листва'], ['land', 'земля'], ['rocks', 'камни'], ['grass', 'трава'], ['water', 'вода']].forEach(([k, l]) => {
    const b = document.createElement('button'); b.className = 'exptog' + (EXP[k] ? ' on' : ''); b.textContent = l;
    b.onclick = () => { EXP[k] = !EXP[k]; b.classList.toggle('on', EXP[k]); buzz('LIGHT'); updateExpInfo(); };
    $('expToggles').appendChild(b);
  });
  function updateExpInfo() {
    const parts = collectWorld({ forest, terrain: land, water }, EXP);
    const s = partsStats(parts);
    $('expInfo').textContent = `${s.meshes} мешей · ${fmt(s.verts)} вершин · ${fmt(s.tris)} треугольников`;
    return parts;
  }

  /* ---------------- деревья ---------------- */
  function treeParams(base, rng, variation) {
    const p = {};
    for (const k of TREE_KEYS) p[k] = base[k];
    p.seed = 1 + ((rng() * 999999) | 0);
    p.height = clamp(base.height * (1 + (rng() - .5) * variation * .8), 4, 30);
    p.trunk = clamp(base.trunk * (1 + (rng() - .5) * variation * .6), .15, 1.6);
    p.crown = Math.round(clamp(base.crown * (1 + (rng() - .5) * variation * .7), 300, 8000));
    p.chaos = clamp(base.chaos + (rng() - .5) * variation * .5, 0, 1);
    p.droop = clamp(base.droop + (rng() - .5) * variation * .3, -.8, .5);
    p.leaves = Math.round(clamp(base.leaves * (1 + (rng() - .5) * variation * .6), 0, 180000));
    const c = new THREE.Color(base.leafColor), hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl, THREE.SRGBColorSpace);
    c.setHSL((hsl.h + (rng() - .5) * .09 * variation + 1) % 1, clamp(hsl.s + (rng() - .5) * .2 * variation, .1, 1), clamp(hsl.l + (rng() - .5) * .14 * variation, .12, .85), THREE.SRGBColorSpace);
    p.leafColor = '#' + c.getHexString(THREE.SRGBColorSpace);
    if (variation > .55 && rng() < .35) {
      const kinds = ['cluster', 'broad', 'needle', 'bloom'];
      p.leafShape = kinds[(rng() * kinds.length) | 0];
      p.shape = ['sphere', 'cone', 'umbrella'][(rng() * 3) | 0];
    }
    return p;
  }
  function placeTrees() {
    const rng = mulberry32(P.seed * 31 + 7);
    const want = Math.min(Math.round(P.treeCount), Q.treeCap);
    while (forest.trees.length > want) forest.drop(forest.trees[forest.trees.length - 1]);
    const spots = [];
    const okSpot = (x, z, minD) => {
      if (land.heightAt(x, z) < (P.water ? P.waterLevel + .4 : -1e9)) return false;
      if (land.normalAt(x, z).y < .74) return false;
      for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < minD) return false;
      return true;
    };
    for (let i = 0; i < forest.trees.length; i++) {
      const t = forest.trees[i];
      t.p = treeParams(P, rng, i === 0 ? 0 : P.variation);
      if (i === 0) { t.x = 0; t.z = 0; }
      spots.push([t.x, t.z]);
    }
    while (forest.trees.length < want) {
      const i = forest.trees.length;
      const p = treeParams(P, rng, P.variation);
      let x = 0, z = 0, tries = 0;
      const minD = Math.max(4, p.height * .55);
      do {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * P.scatter;
        x = Math.cos(a) * r; z = Math.sin(a) * r; tries++;
      } while (!okSpot(x, z, minD) && tries < 120);
      const t = forest.newTree(p, x, z);
      spots.push([x, z]);
      if (i === 0) { t.x = 0; t.z = 0; }
    }
    forest.trees.forEach(t => { t.baseY = land.heightAt(t.x, t.z); t.group.position.set(t.x, t.baseY, t.z); });
  }

  /* ---------------- очередь заданий ---------------- */
  const dirty = { all: false, one: null, terrain: false, veg: false, bark: false };
  let pendingAt = 0, job = null;
  function queue(scope) {
    if (scope === 'all') dirty.all = true;
    else if (scope === 'one') dirty.one = selected;
    else if (scope === 'terrain') { dirty.terrain = true; dirty.veg = true; dirty.all = true; }
    else if (scope === 'veg') dirty.veg = true;
    else if (scope === 'water') { dirty.veg = true; dirty.all = true; }
    else if (scope === 'forest') dirty.all = true;
    else if (scope === 'bark') dirty.bark = true;
    pendingAt = performance.now(); $('growChip').classList.add('show');
  }
  function* combined() {
    if (dirty.bark) {
      const t = yield* barkJob(makeNoise3D(90210), P.barkRes);
      forest.setBark(t); dirty.bark = false;
    }
    land.prepare(P);
    if (dirty.terrain || dirty.veg) {
      yield* land.build(P, Q, dirty.terrain);
      water.update(P, land.heightTex, land.hMin, land.hMax);
      dirty.terrain = dirty.veg = false;
    }
    if (dirty.all) {
      placeTrees();
      for (const t of forest.trees) yield* forest.build(t, Q, land.heightAt, P.waterLevel);
      dirty.all = false; dirty.one = null;
    } else if (dirty.one) {
      yield* forest.build(dirty.one, Q, land.heightAt, P.waterLevel);
      dirty.one = null;
    }
    forest.setSkeleton(P.skeleton);
    if (selected) forest.select(selected);
    syncUI();
    return true;
  }
  function onParam(i) {
    if (i.s === 'live') applyLive();
    else if (i.s === 'quality') { Q = QUALITY[P.quality]; E.setQuality(Q); queue('all'); queue('terrain'); toast('Качество: ' + Q.n + (P.quality === 'prime' && isMobile ? ' — тяжело для телефона' : ''), P.quality === 'prime' && isMobile ? 'warn' : ''); }
    else if (i.s === 'tree' || i.s === 'leaf') queue(selected ? 'one' : 'all');
    else queue(i.s);
  }
  function applyLive() {
    forest.setWire(P.wireframe); land.setWire(P.wireframe);
    forest.setSkeleton(P.skeleton);
    U.wind.value = P.wind; U.backlight.value = P.backlight; Sound.setWind(P.wind);
    E.flies.visible = P.fireflies; grid.visible = P.grid; ref.visible = P.scaleRef;
    const base = land.heightAt(0, 0);
    grid.position.y = base + .02; ref.position.y = base;
    E.setParticles(P.particles, base);
    E.pollen.material.uniforms.uColor.value.set(P.preset === 'sakura' ? '#ffc0dc' : '#ffe9b8');
    E.cam.tRadius = P.dist;
    water.update(P, land.heightTex, land.hMin, land.hMax);
    E.applySky(P, base, Math.max(P.scatter, P.grassRadius) * 1.15 + P.height);
    $('btnWire').classList.toggle('on', P.wireframe);
  }

  /* ---------------- перетаскивание ---------------- */
  const hitPoint = new THREE.Vector3();
  function rayTerrain(o, d) {
    let t = 0, step = 1.5;
    for (let i = 0; i < 320; i++) {
      const nt = t + step * (1 + t * .012);
      const x = o.x + d.x * nt, y = o.y + d.y * nt, z = o.z + d.z * nt;
      if (y - land.heightAt(x, z) < 0) {
        let a = t, b = nt;
        for (let k = 0; k < 20; k++) {
          const m = (a + b) / 2;
          const yy = o.y + d.y * m;
          if (yy - land.heightAt(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m;
        }
        const tt = (a + b) / 2;
        return hitPoint.set(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt);
      }
      t = nt; if (t > 1600) break;
    }
    return null;
  }
  let dragTree = null, dragMoved = false;
  stage.addEventListener('pointerdown', e => {
    if (e.target !== canvas) return;
    Sound.resume();
    const { o, d } = E.pointerRay(e.clientX, e.clientY);
    const t = forest.pick(o, d);
    if (t) {
      e.stopPropagation(); e.preventDefault();
      dragTree = t; dragMoved = false; selectTree(t);
      canvas.classList.add('grabtree');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      buzz('MEDIUM'); Sound.tick(520);
      $('hint').classList.add('gone');
    }
  }, true);
  stage.addEventListener('pointermove', e => {
    if (!dragTree) return;
    e.stopPropagation();
    const { o, d } = E.pointerRay(e.clientX, e.clientY);
    const p = rayTerrain(o, d);
    if (p) {
      dragMoved = true;
      const lim = P.tsize * .46;
      const x = clamp(p.x, -lim, lim), z = clamp(p.z, -lim, lim);
      forest.move(dragTree, x, z, land.heightAt(x, z));
    }
  }, true);
  const endDrag = e => {
    if (!dragTree) return;
    e.stopPropagation();
    const t = dragTree; dragTree = null;
    canvas.classList.remove('grabtree');
    if (dragMoved) { queue('one'); dirty.one = t; toast('Дерево #' + t.id + ' пересажено'); buzz('LIGHT'); }
  };
  stage.addEventListener('pointerup', endDrag, true);
  stage.addEventListener('pointercancel', endDrag, true);
  canvas.addEventListener('dblclick', e => {
    const { o, d } = E.pointerRay(e.clientX, e.clientY);
    if (forest.pick(o, d)) return;
    const p = rayTerrain(o, d); if (!p) return;
    plantAt(p.x, p.z);
  });
  function selectTree(t) { selected = t; forest.select(t); syncUI(); }
  function plantAt(x, z) {
    if (forest.trees.length >= Q.treeCap) { toast('Лимит деревьев для качества ' + Q.n, 'warn'); return; }
    const rng = mulberry32((Math.random() * 1e6) | 0);
    const t = forest.newTree(treeParams(P, rng, P.variation), x, z);
    t.baseY = land.heightAt(x, z); t.group.position.set(x, t.baseY, z);
    selectTree(t); dirty.one = t; pendingAt = performance.now(); $('growChip').classList.add('show');
    P.treeCount = forest.trees.length; syncKey('treeCount'); syncUI();
    toast('Посажено дерево #' + t.id); buzz('MEDIUM'); Sound.tick(880);
  }
  $('btnPlant').onclick = () => {
    const a = Math.random() * 6.283, r = 6 + Math.random() * Math.max(8, P.scatter * .6);
    plantAt(Math.cos(a) * r, Math.sin(a) * r);
  };
  $('selNone').onclick = () => { selectTree(null); syncUI(); };
  $('selDel').onclick = () => {
    if (!selected) return;
    if (forest.trees.length <= 1) { toast('Последнее дерево удалить нельзя', 'warn'); return; }
    forest.drop(selected); selectTree(null);
    P.treeCount = forest.trees.length; syncKey('treeCount'); syncUI(); E.markShadows(); toast('Дерево удалено');
  };
  $('selDup').onclick = () => {
    if (!selected || forest.trees.length >= Q.treeCap) { toast('Лимит деревьев', 'warn'); return; }
    const a = Math.random() * 6.283, d = Math.max(4, selected.p.height * .6);
    const x = selected.x + Math.cos(a) * d, z = selected.z + Math.sin(a) * d;
    const t = forest.newTree(Object.assign({}, selected.p, { seed: 1 + ((Math.random() * 1e6) | 0) }), x, z);
    t.baseY = land.heightAt(x, z); t.group.position.set(x, t.baseY, z);
    selectTree(t); dirty.one = t; pendingAt = performance.now(); $('growChip').classList.add('show');
    P.treeCount = forest.trees.length; syncKey('treeCount'); syncUI();
  };
  $('selAll').onclick = () => {
    if (!selected) return;
    for (const k of TREE_KEYS) P[k] = selected.p[k];
    selectTree(null); syncUI(); queue('all'); toast('Параметры применены ко всему лесу');
  };

  /* ---------------- кнопки ---------------- */
  let toastTimer = 0;
  function toast(msg, kind) {
    const t = $('toast'); t.textContent = msg; t.className = 'ov show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function setViewer(on) {
    document.body.classList.toggle('viewer', on);
    $('btnViewer').textContent = on ? '⤡' : '⤢'; $('btnViewer').classList.toggle('on', on);
    if (on) { $('hud').classList.add('collapsed'); $('hudToggle').setAttribute('aria-expanded', 'false'); }
    buzz('MEDIUM'); Sound.tick(on ? 880 : 440);
    requestAnimationFrame(() => E.resize()); setTimeout(() => E.resize(), 260);
  }
  $('btnViewer').onclick = () => setViewer(!document.body.classList.contains('viewer'));
  $('hudToggle').onclick = () => { const c = $('hud').classList.toggle('collapsed'); $('hudToggle').setAttribute('aria-expanded', String(!c)); Sound.tick(600); };
  $('btnCam').onclick = () => { E.resetCamera(); P.focusX = 0; P.focusZ = 0; toast('Камера сброшена'); };
  $('btnWire').onclick = () => { P.wireframe = !P.wireframe; syncUI(); applyLive(); Sound.tick(600); };
  $('btnDice2').onclick = () => $('btnRandom').click();
  const reseed = d => { P.seed = Math.max(1, P.seed + d); selected = null; forest.select(null); syncUI(); queue('terrain'); Sound.tick(560); buzz('LIGHT'); };
  $('seedMinus').onclick = () => reseed(-1);
  $('seedPlus').onclick = () => reseed(1);
  $('seedDice').onclick = () => { P.seed = 1 + ((Math.random() * 99999) | 0); selected = null; forest.select(null); syncUI(); queue('terrain'); buzz('MEDIUM'); };
  $('btnRandom').onclick = () => {
    P.seed = 1 + ((Math.random() * 99999) | 0);
    P.relief = Math.round(clamp(P.relief * (.7 + Math.random() * .8), 0, 40) * 2) / 2;
    P.tscale = Math.round(clamp(P.tscale * (.75 + Math.random() * .6), 20, 400) / 5) * 5;
    P.riverMeander = Math.round(Math.random() * 100) / 100;
    P.riverOffset = Math.round((Math.random() - .5) * 120);
    P.waterLevel = Math.round(clamp(-P.relief * (.2 + Math.random() * .35), -20, 12) * 5) / 5;
    selected = null; forest.select(null);
    syncUI(); applyLive(); queue('terrain'); Sound.tick(880); buzz('MEDIUM'); toast('Новый мир · seed ' + P.seed);
  };
  $('btnReset').onclick = () => {
    Object.assign(P, DEFAULTS); if (isMobile) trim();
    Q = QUALITY[P.quality]; E.setQuality(Q);
    selected = null; forest.select(null);
    while (forest.trees.length) forest.drop(forest.trees[0]);
    E.resetCamera(); syncUI(); applyLive(); queue('bark'); queue('terrain'); toast('Сброс完成'.replace('完成', ' выполнен'));
  };
  $('btnPng').onclick = async () => {
    const g = U.grow.value; U.grow.value = 1; E.render(performance.now(), P);
    let data; try { data = E.renderer.domElement.toDataURL('image/png'); } catch (e) { U.grow.value = g; toast('Экспорт кадра запрещён', 'warn'); return; }
    U.grow.value = g;
    const msg = await saveArtifact({ filename: `drevo-${P.seed}.png`, base64: data.split(',')[1], mime: 'image/png', title: 'Кадр мира' });
    if (msg) { toast(msg); buzz('MEDIUM'); }
  };
  $('btnWorld').onclick = async () => {
    const parts = updateExpInfo();
    if (!parts.length) { toast('Нечего экспортировать', 'warn'); return; }
    const s = partsStats(parts);
    toast('Собираю ' + fmt(s.tris) + ' трис…');
    await new Promise(r => setTimeout(r, 60));
    try {
      if ($('expFormat').value === 'obj') {
        const text = toOBJ(parts, `seed ${P.seed} · ${fmt(s.tris)} tris`);
        const msg = await saveArtifact({ filename: `drevo-world-${P.seed}.obj`, text, mime: 'text/plain', title: '3D-мир OBJ' });
        if (msg) toast(msg);
      } else {
        const blob = await toGLB(parts, `DREVO seed ${P.seed}`, (p, name) => { $('growText').textContent = 'GLB: ' + name; $('growPct').textContent = Math.round(p * 100) + '%'; $('growChip').classList.add('show'); });
        const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        const msg = await saveArtifact({ filename: `drevo-world-${P.seed}.glb`, base64: b64, mime: 'model/gltf-binary', title: '3D-мир GLB' });
        $('growChip').classList.remove('show');
        if (msg) toast(msg + ' · ' + (blob.size / 1048576).toFixed(1) + ' МБ');
      }
      buzz('MEDIUM');
    } catch (e) { console.error(e); toast('Экспорт не удался: ' + e.message, 'err'); $('growChip').classList.remove('show'); }
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
    if (k === 'escape') { if (document.body.classList.contains('viewer')) setViewer(false); else selectTree(null); }
    else if (k === 'f') setViewer(!document.body.classList.contains('viewer'));
    else if (k === 'h') $('hudToggle').click();
    else if (k === 'r') $('btnRandom').click();
    else if (k === 'w') $('btnWire').click();
    else if (k === 'delete') $('selDel').click();
    else if (k === ' ') { e.preventDefault(); P.autoRotate = !P.autoRotate; syncUI(); }
    else if (k === 'arrowleft') E.cam.tTheta -= .12;
    else if (k === 'arrowright') E.cam.tTheta += .12;
    else if (k === 'arrowup') E.cam.tPhi = clamp(E.cam.tPhi - .08, .06, 1.53);
    else if (k === 'arrowdown') E.cam.tPhi = clamp(E.cam.tPhi + .08, .06, 1.53);
  });
  E.hooks.interact = () => { Sound.resume(); $('hint').classList.add('gone'); };
  E.hooks.zoom = v => { P.dist = Math.round(v); syncKey('dist'); };
  if (!isMobile) $('hintText').textContent = 'тащи дерево мышью ·双击 — посадить · F — полный экран · H — статы'.replace('双击', 'двойной клик');

  /* ---------------- цикл ---------------- */
  let growT = 1, last = performance.now(), fpsAcc = 0, fpsN = 0, msAcc = 0, hudAt = 0, booted = false;
  let rafId = 0, running = false, badge = 0;
  const gustBars = [...$('gust').children];
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const pending = dirty.all || dirty.one || dirty.terrain || dirty.veg || dirty.bark;
    if (!job && pending && now - pendingAt > 130) { job = combined(); U.grow.value = 0; growT = 0; E.key.castShadow = false; }
    if (job) {
      const t0 = performance.now(); let r;
      try { do { r = job.next(); } while (!r.done && performance.now() - t0 < 6); }
      catch (err) { console.error(err); job = null; dirty.all = dirty.one = dirty.terrain = dirty.veg = dirty.bark = false; toast('Ошибка генерации: ' + err.message, 'err'); }
      if (job && r && !r.done && r.value) { $('growText').textContent = r.value.label || 'генерация'; $('growPct').textContent = Math.round((r.value.p || 0) * 100) + '%'; }
      if (job && r && r.done) {
        job = null; applyLive(); Sound.rustle(); E.markShadows(); updateExpInfo();
        const tt = forest.totals();
        if (tt.auto) toast('Шаг роста увеличен до ' + tt.seg.toFixed(2) + ' м — подними качество для большей детализации', 'warn');
      }
    }
    if (growT < 1) {
      growT = Math.min(1, growT + dt / 1.5);
      U.grow.value = 1 - Math.pow(1 - growT, 3);
      if (growT >= 1) { $('growChip').classList.remove('show'); E.key.castShadow = true; E.markShadows(); }
    }
    U.time.value = now * .001;
    const base = land.heightAt(P.focusX || 0, P.focusZ || 0);
    E.updateCamera(dt, now, P, base, reduceMotion);
    if (forest.ring.visible) forest.ring.material.opacity = .55 + .35 * Math.sin(now * .004);
    const t0 = performance.now(); E.render(now, P); msAcc += performance.now() - t0;
    fpsAcc += dt; fpsN++;
    const tt = forest.totals();
    const world = tt.woodTris + tt.leafTris + land.stats.tris + land.stats.grass * 5 + land.stats.flowers * 4 + land.stats.rocks * 80;
    badge += (world - badge) * Math.min(1, dt * 6);
    $('triNum').textContent = fmt(badge);
    if (now - hudAt > 240) {
      const fps = fpsN / Math.max(.001, fpsAcc), el = $('mFps');
      el.textContent = fps.toFixed(0);
      el.style.color = fps > 50 ? 'var(--ok)' : fps > 28 ? 'var(--warn)' : 'var(--danger)';
      $('mMs').textContent = (msAcc / fpsN).toFixed(1) + ' мс';
      $('mTris').textContent = fmt(E.renderer.info.render.triangles);
      $('mCalls').textContent = E.renderer.info.render.calls;
      $('mTrees').textContent = forest.trees.length + ' / ' + Q.treeCap;
      $('mNodes').textContent = fmt(tt.nodes) + ' / ' + fmt(tt.branches);
      $('mSeg').textContent = tt.seg.toFixed(2) + ' м' + (tt.auto ? ' авто' : '');
      $('mLeaves').textContent = fmt(tt.leaves);
      $('mGrass').textContent = fmt(land.stats.grass) + ' / ' + fmt(land.stats.flowers);
      $('mLand').textContent = fmt(land.stats.tris);
      $('mWater').textContent = P.water ? land.stats.water + '% участка' : 'выключена';
      $('mGen').textContent = (tt.ms + land.stats.ms).toFixed(0) + ' мс';
      const gust = .55 + .45 * Math.sin(now * .00031);
      $('mWind').textContent = P.wind.toFixed(2) + ' / ' + gust.toFixed(2);
      $('hudMini').textContent = fps.toFixed(0) + ' fps · ' + fmt(world) + ' трис';
      for (let i = 0; i < gustBars.length; i++) gustBars[i].style.height = (18 + Math.abs(Math.sin(now * .002 + i * .7)) * 82 * P.wind * gust).toFixed(0) + '%';
      const p = clamp(world / 2000000, 0, 1), f = $('budgetFill');
      f.style.width = (p * 100).toFixed(1) + '%';
      f.style.background = p < .3 ? 'linear-gradient(90deg,var(--moss),var(--lime))' : p < .62 ? 'linear-gradient(90deg,var(--lime),var(--amber))' : 'linear-gradient(90deg,var(--amber),var(--danger))';
      $('budgetPct').textContent = Math.round(p * 100) + '%';
      hudAt = now; fpsAcc = 0; fpsN = 0; msAcc = 0;
    }
    if (!booted) { booted = true; $('boot').classList.add('hide'); setTimeout(() => { const b = $('boot'); if (b) b.style.display = 'none'; }, 700); }
  }
  function startLoop() { if (running) return; running = true; last = performance.now(); rafId = requestAnimationFrame(frame); }
  function stopLoop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  let rp = false;
  new ResizeObserver(() => { if (rp) return; rp = true; requestAnimationFrame(() => { rp = false; E.resize(); }); }).observe(stage);
  addEventListener('orientationchange', () => setTimeout(() => E.resize(), 250));
  E.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); stopLoop(); toast('Контекст WebGL потерян — перезапусти приложение', 'err'); });
  E.renderer.domElement.addEventListener('webglcontextrestored', () => { E.resize(); E.markShadows(); startLoop(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
    else { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); }
  });
  initNative({
    onBack: exit => { if (document.body.classList.contains('viewer')) setViewer(false); else if (selected) selectTree(null); else exit(); },
    onActive: () => { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); },
    onInactive: () => { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
  });

  land.prepare(P);
  water.update(P, null, -1, 1);
  syncUI(); E.resize(); applyLive();
  queue('terrain');
  startLoop();
  setTimeout(() => $('hint').classList.add('gone'), 11000);
}
