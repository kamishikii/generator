import './style.css';
import * as THREE from 'three';
import { clamp, lerp, mulberry32, makeNoise3D, TAU } from './noise.js';
import { barkTextures, barkJob, groundTextures, rockTextures, skinTextures, fabricTextures, hairTextures } from './textures.js';
import { createEngine } from './engine.js';
import { createForest, TREE_KEYS } from './tree.js';
import { createTerrainSystem, PAINTS } from './terrain.js';
import { createHuman, HUMAN_POSES } from './human.js';
import { createBuilding } from './building.js';
import { collectWorld, pushMesh, partsStats, toOBJ, toGLB } from './export.js';
import { NATIVE, buzz, saveArtifact, blobToBase64, initNative } from './native.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const isMobile = NATIVE || matchMedia('(max-width:960px)').matches || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const lowPower = (navigator.hardwareConcurrency || 8) <= 4;

function bootFallback(msg) {
  $('boot').classList.add('hide'); $('fallback').classList.add('show');
  $('fbMsg').textContent = msg; $('rail').style.opacity = .4; $('rail').style.pointerEvents = 'none';
  const c = $('fbCanvas'), x = c.getContext('2d'), W = c.width, H = c.height; let t = 0;
  (function loop() {
    t += .016;
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0d2a33'); g.addColorStop(1, '#0a1410');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const br = (x0, y0, l, an, w, d) => { if (d > 9 || l < 3) return; const s = Math.sin(t * .8 + d) * .03 * (10 - d);
      const x1 = x0 + Math.cos(an + s) * l, y1 = y0 + Math.sin(an + s) * l;
      x.strokeStyle = d < 3 ? '#6b5138' : '#4d7a3a'; x.lineWidth = Math.max(.7, w);
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
      br(x1, y1, l * .74, an - .45, w * .66, d + 1); br(x1, y1, l * .76, an + .42, w * .66, d + 1); };
    br(W / 2, H - 16, 62, -Math.PI / 2, 11, 0); requestAnimationFrame(loop);
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
  sunEl: .3, sunAz: 135, lightInt: 1, fog: .012, bloom: .6, rays: true,
  wind: .35, particles: 700, fireflies: true,
  quality: isMobile ? 'draft' : 'game', fov: 45, dist: 40, focusX: 0, focusZ: 0,
  autoRotate: !reduceMotion, wireframe: false, skeleton: false, grid: false,
  brushRadius: 9, brushStrength: .5, brushHard: .45, paintColor: '#6d5636',
  hHeight: 180, hFemale: .25, hBuild: .3, hMuscle: .35, hShoulders: 1, hChest: 1, hWaist: 1, hHips: 1,
  hLegs: 1, hArms: 1, hHead: 1, hNeck: 1, hBelly: .1, hDetail: 16, hFace: 1,
  hPose: 'apose', hArm: 45, hElbow: 8, hSpread: 6, hKnee: 3, hLean: 0, hSwing: 0,
  hSkin: '#c98d63', hShirt: '#3f6f4a', hPants: '#33405a', hHair: '#2b1d16', hShoes: '#22201e', hIris: '#5b7f9a',
  hClothed: true, hHairOn: true, hBrows: true, hFringe: .5, hLongHair: .2,
  bType: 'house', bWidth: 9, bDepth: 7, bFloors: 2, bFloorH: 3, bRoofType: 'gable', bRoofH: 2.6,
  bWindows: 3, bWinSize: 1.1, bDoor: true, bChimney: true,
  bWall: '#c8b394', bRoof: '#7a3b2e', bTrim: '#5b4632'
};
const P = Object.assign({}, DEFAULTS);
function trim() {
  P.leaves = Math.round(P.leaves * .45); P.crown = Math.round(P.crown * .8);
  P.grassCount = 9000; P.flowers = 200; P.rocks = 20; P.litter = 120;
  P.particles = 380; P.tsize = 190; P.dist = 42; P.treeCount = 3; P.scatter = 32; P.barkRes = 192;
  P.hDetail = 12;
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
  mix: { n: 'Микс-лес', e: '🌲', p: { treeCount: 8, scatter: 60, variation: .8 } }
};
const QUALITY = {
  draft: { n: 'Черновик', radial: 5, maxNodes: 1800, pr: 1.25, shadow: 1024, msaa: 0, leafCap: 16000, blur: 1, landSeg: 112, grassCap: 14000, rockDetail: 1, treeCap: 6 },
  game: { n: 'Игра', radial: 8, maxNodes: 3600, pr: 1.5, shadow: 2048, msaa: 4, leafCap: 40000, blur: 2, landSeg: 160, grassCap: 40000, rockDetail: 1, treeCap: 12 },
  cine: { n: 'Кино', radial: 12, maxNodes: 6500, pr: 1.75, shadow: 2048, msaa: 4, leafCap: 70000, blur: 2, landSeg: 224, grassCap: 90000, rockDetail: 2, treeCap: 20 },
  ultra: { n: 'Ультра', radial: 16, maxNodes: 11000, pr: 2, shadow: 4096, msaa: 4, leafCap: 110000, blur: 3, landSeg: 288, grassCap: 150000, rockDetail: 2, treeCap: 32 },
  prime: { n: 'Прайм', radial: 22, maxNodes: 18000, pr: 2, shadow: 4096, msaa: 4, leafCap: 180000, blur: 3, landSeg: 384, grassCap: 240000, rockDetail: 3, treeCap: 48 }
};
let Q = QUALITY[P.quality];

const Sound = {
  ctx: null, on: true, master: null, wg: null, bp: null, buf: null, brushG: null,
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
    const bs = this.ctx.createBufferSource(); bs.buffer = b; bs.loop = true; bs.playbackRate.value = .7;
    const bf = this.ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 420;
    this.brushG = this.ctx.createGain(); this.brushG.gain.value = 0;
    bs.connect(bf); bf.connect(this.brushG); this.brushG.connect(this.master); bs.start();
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); if (this.ctx) this.setWind(P.wind); },
  setWind(v) { if (!this.ctx) return; const t = this.ctx.currentTime; this.wg.gain.setTargetAtTime(.012 + v * .105, t, .45); this.bp.frequency.setTargetAtTime(360 + v * 760, t, .5); },
  brush(on, wet) { if (!this.ctx || !this.brushG) return; const t = this.ctx.currentTime; this.brushG.gain.setTargetAtTime(on ? (wet ? .16 : .09) : 0, t, .07); },
  rustle() { if (!this.ctx || !this.on) return; const t = this.ctx.currentTime, s = this.ctx.createBufferSource();
    s.buffer = this.buf; s.playbackRate.value = 1.7;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 950;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.1, t + .09); g.gain.exponentialRampToValueAtTime(.0008, t + .8);
    s.connect(hp); hp.connect(g); g.connect(this.master); s.start(t); s.stop(t + .85); },
  tick(f = 680) { if (!this.ctx || !this.on) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.045, t); g.gain.exponentialRampToValueAtTime(.0006, t + .09);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .1); },
  setOn(v) { this.on = v; if (this.master) this.master.gain.setTargetAtTime(v ? .85 : 0, this.ctx.currentTime, .06); }
};

const ICON = {
  raise: '<path d="M3 18l6-9 4 5 3-4 5 8z"/><path d="M12 4v3M9.5 5.5L12 3l2.5 2.5"/>',
  lower: '<path d="M3 8l6 9 4-5 3 4 5-8z"/><path d="M12 20v-3M9.5 18.5L12 21l2.5-2.5"/>',
  smooth: '<path d="M3 14c4-6 7 4 10-1s5 2 8-2"/><path d="M3 19c4-5 7 3 10-1s5 2 8-2"/>',
  plateau: '<path d="M3 16h6l2-6h4l2 6h4"/><path d="M3 20h18"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  dry: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  paint: '<path d="M4 20c3 1 5-1 5-3l8-8 3 3-8 8c-2 2-5 2-8 0z"/><path d="M15 6l3-3 3 3-3 3z"/>',
  stamp: '<path d="M12 3v10M8 7l4-4 4 4"/><path d="M4 15h16v6H4z"/>',
  camera: '<path d="M12 4a8 8 0 1 1-8 8"/><path d="M4 12l-2-3M4 12l3-2"/><circle cx="12" cy="12" r="2.5"/>'
};
const TOOLS = [
  { k: 'raise', n: 'Горы' }, { k: 'lower', n: 'Вмятины' }, { k: 'smooth', n: 'Сгладить' },
  { k: 'plateau', n: 'Плато' }, { k: 'water', n: 'Вода', cls: 'wat' }, { k: 'dry', n: 'Без воды', cls: 'dry' },
  { k: 'paint', n: 'Кисть' }, { k: 'stamp', n: 'Модель' }, { k: 'camera', n: 'Камера' }
];

let E, forest, land, human, building, U, HT;
try {
  const probe = document.createElement('canvas');
  if (!(window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl')))) throw new Error('WebGL недоступен');
  boot();
} catch (err) { console.error(err); bootFallback('Сцена не запустилась: ' + err.message); }

function boot() {
  U = { time: { value: 0 }, wind: { value: P.wind }, grow: { value: 0 }, growColor: { value: new THREE.Color('#9ef01a') },
    sunDir: { value: new THREE.Vector3(1, .3, 0).normalize() }, sunView: { value: new THREE.Vector3() }, backlight: { value: P.backlight } };
  const canvas = $('gl'), stage = $('stage');
  E = createEngine(canvas, stage, U, { quality: Q, mobile: isMobile, grain: reduceMotion ? .012 : .03 });
  const tn = makeNoise3D(90210);
  HT = { skin: skinTextures(tn, isMobile ? 256 : 512), fabric: fabricTextures(tn, 256), hair: hairTextures(tn, 256) };
    forest = createForest(U, photoBark(), isMobile);
  land = createTerrainSystem(U, photoGround(), rockTextures(tn, 128), isMobile);
  human = createHuman(HT); building = createBuilding();

  const worldRoot = new THREE.Group(); E.scene.add(worldRoot);
  worldRoot.add(land.group, forest.group);
  const propRoot = new THREE.Group(); worldRoot.add(propRoot);
  const grid = new THREE.GridHelper(200, 100, 0x9ef01a, 0x2fbf6a);
  grid.material.transparent = true; grid.material.opacity = .14; grid.visible = false; worldRoot.add(grid);
  const studio = new THREE.Group(); E.scene.add(studio); studio.visible = false;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0x1a2620, roughness: .95 }));
  pad.rotation.x = -Math.PI / 2; pad.receiveShadow = true; studio.add(pad);
  const sgrid = new THREE.GridHelper(18, 18, 0x9ef01a, 0x2fbf6a);
  sgrid.material.transparent = true; sgrid.material.opacity = .18; sgrid.position.y = .01; studio.add(sgrid);
  studio.add(human.group, building.group);

  const ringGeo = new THREE.RingGeometry(.92, 1.06, 48);
  const cursor = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9ef01a, transparent: true, opacity: .8, side: THREE.DoubleSide }));
  cursor.rotation.x = -Math.PI / 2; cursor.visible = false; cursor.renderOrder = 5; worldRoot.add(cursor);

  let MODE = 'world', selected = null, selProp = null, clean = false, edit = false, tool = 'raise';
  const props = [];
  let libId = 1;
  const library = [
    { id: libId++, name: 'Дуб', kind: 'tree', params: Object.assign({}, PRESETS.oak.p, { seed: 4211, litter: 200 }) },
    { id: libId++, name: 'Сосна', kind: 'tree', params: Object.assign({}, PRESETS.pine.p, { seed: 8123, litter: 160 }) },
    { id: libId++, name: 'Человек', kind: 'human', params: Object.assign({}, DEFAULTS, { seed: 55 }) },
    { id: libId++, name: 'Изба', kind: 'arch', params: Object.assign({}, DEFAULTS, { bType: 'izba', bWidth: 7, bDepth: 6, bFloors: 1, seed: 91 }) },
    { id: libId++, name: 'Башня', kind: 'arch', params: Object.assign({}, DEFAULTS, { bType: 'tower', bWidth: 6, bDepth: 6, bFloors: 4, bRoofType: 'cone', bRoofH: 4, seed: 77 }) }
  ];
  let activeLib = library[0].id;
  const undoStack = [];
  const target = () => selected ? selected.p : P;
  const isTreeKey = i => i.s === 'tree' || i.s === 'leaf';
  const getVal = i => isTreeKey(i) ? target()[i.k] : P[i.k];
  const viewHeight = () => MODE === 'world' ? P.height : MODE === 'human' ? Math.max(1, human.stats.height) : Math.max(2, building.stats.height);
  const focusY = () => MODE === 'world' ? land.heightAt(P.focusX || 0, P.focusZ || 0) : 0;

  const pct = v => Math.round(v * 100) + '%';
  const TABS = {
    world: [
      { g: 'Ландшафт', items: [
        { k: 'tsize', t: 'range', l: 'Размер участка', min: 80, max: 900, step: 10, u: ' м', s: 'terrain' },
        { k: 'relief', t: 'range', l: 'Высота рельефа', min: 0, max: 40, step: .5, u: ' м', s: 'terrain' },
        { k: 'tscale', t: 'range', l: 'Масштаб холмов', min: 20, max: 400, step: 5, u: ' м', s: 'terrain' },
        { k: 'tdetail', t: 'range', l: 'Изрезанность', min: 0, max: 1, step: .01, s: 'terrain', f: pct },
        { k: 'landDetail', t: 'range', l: 'Сетка земли', min: 0, max: 1, step: .01, s: 'terrain', f: pct, hint: 'мельче сетка → точнее кисти' },
        { k: 'pad', t: 'range', l: 'Площадка под деревом', min: 2, max: 30, step: .5, u: ' м', s: 'terrain' },
        { t: 'act', acts: [['regen', 'Пересобрать рельеф'], ['repaint', 'Перекрасить биомы']] }
      ] },
      { g: 'Кисти', items: [
        { k: 'brushRadius', t: 'range', l: 'Радиус кисти', min: 1, max: 60, step: .5, u: ' м', s: 'live' },
        { k: 'brushStrength', t: 'range', l: 'Сила', min: .05, max: 1, step: .01, s: 'live', f: pct },
        { k: 'brushHard', t: 'range', l: 'Жёсткость края', min: 0, max: 1, step: .01, s: 'live', f: pct },
        { t: 'act', acts: [['editon', 'Включить редактор'], ['undo', 'Отменить мазок']] }
      ] },
      { g: 'Деревья', items: [
        { k: 'treeCount', t: 'range', l: 'Деревьев', min: 1, max: 48, step: 1, s: 'forest', f: fmt },
        { k: 'scatter', t: 'range', l: 'Разброс', min: 6, max: 240, step: 2, u: ' м', s: 'forest' },
        { k: 'variation', t: 'range', l: 'Разнообразие', min: 0, max: 1, step: .01, s: 'forest', f: pct },
        { k: 'height', t: 'range', l: 'Высота', min: 4, max: 30, step: .5, u: ' м', s: 'tree' },
        { k: 'trunk', t: 'range', l: 'Толщина ствола', min: .15, max: 1.6, step: .01, u: ' м', s: 'tree' },
        { k: 'crown', t: 'range', l: 'Густота кроны', min: 400, max: 8000, step: 50, s: 'tree', f: fmt },
        { k: 'detail', t: 'range', l: 'Детализация ветвей', min: 0, max: 1, step: .01, s: 'tree', f: pct },
        { k: 'chaos', t: 'range', l: 'Кривизна', min: 0, max: 1, step: .01, s: 'tree', f: pct },
        { k: 'droop', t: 'range', l: 'Гравитация ветвей', min: -.8, max: .5, step: .01, s: 'tree' },
        { k: 'shape', t: 'select', l: 'Форма кроны', opts: [['sphere', 'Шар'], ['cone', 'Конус'], ['umbrella', 'Зонт'], ['column', 'Колонна']], s: 'tree' },
        { k: 'barkDepth', t: 'range', l: 'Глубина борозд', min: 0, max: 1, step: .01, s: 'tree', f: pct },
        { k: 'barkRes', t: 'select', l: 'Текстура коры', opts: [[192, '192×384'], [256, '256×512'], [384, '384×768'], [512, '512×1024']], s: 'bark' },
        { k: 'moss', t: 'range', l: 'Мох', min: 0, max: 1, step: .01, s: 'tree', f: pct },
        { k: 'roots', t: 'range', l: 'Корневые лапы', min: 0, max: 1, step: .01, s: 'tree', f: pct },
        { k: 'barkColor', t: 'color', l: 'Цвет коры', s: 'tree' },
        { k: 'leaves', t: 'range', l: 'Листьев на дерево', min: 0, max: 180000, step: 1000, s: 'leaf', f: fmt },
        { k: 'leafSize', t: 'range', l: 'Размер листа', min: .3, max: 2.4, step: .05, s: 'leaf' },
        { k: 'leafShape', t: 'select', l: 'Тип листа', opts: [['cluster', 'Кисть'], ['broad', 'Широкий'], ['needle', 'Игла'], ['bloom', 'Цветок']], s: 'leaf' },
        { k: 'leafColor', t: 'color', l: 'Цвет листвы', s: 'leaf' },
        { k: 'leafVar', t: 'range', l: 'Разброс оттенка', min: 0, max: 1, step: .01, s: 'leaf', f: pct },
        { k: 'litter', t: 'range', l: 'Опавших листьев', min: 0, max: 1200, step: 20, s: 'leaf', f: fmt },
        { k: 'backlight', t: 'range', l: 'Просвет на солнце', min: 0, max: 1.2, step: .02, s: 'live' },
        { t: 'act', acts: [['saveTree', 'Выбранное дерево → в библиотеку']] }
      ] },
      { g: 'Трава', items: [
        { k: 'grassCount', t: 'range', l: 'Травинок', min: 0, max: 240000, step: 1000, s: 'veg', f: fmt },
        { k: 'grassRadius', t: 'range', l: 'Радиус травы', min: 4, max: 160, step: 1, u: ' м', s: 'veg' },
        { k: 'grassHeight', t: 'range', l: 'Высота травы', min: .1, max: 2, step: .05, u: ' м', s: 'veg' },
        { k: 'grassVar', t: 'range', l: 'Разброс цвета', min: 0, max: 1, step: .01, s: 'veg', f: pct },
        { k: 'rocks', t: 'range', l: 'Камней', min: 0, max: 200, step: 2, s: 'veg', f: fmt },
        { k: 'flowers', t: 'range', l: 'Цветов', min: 0, max: 4000, step: 25, s: 'veg', f: fmt },
        { t: 'act', acts: [['regrow', 'Пересадить траву']] }
      ] },
      { g: 'Вода', items: [
        { k: 'water', t: 'toggle', l: 'Вода', s: 'water' },
        { k: 'waterLevel', t: 'range', l: 'Уровень затопления', min: -20, max: 12, step: .2, u: ' м', s: 'live' },
        { k: 'waves', t: 'range', l: 'Волны', min: 0, max: 1, step: .01, s: 'live', f: pct },
        { k: 'river', t: 'toggle', l: 'Река в генераторе', s: 'terrain' },
        { k: 'riverWidth', t: 'range', l: 'Ширина русла', min: 2, max: 40, step: .5, u: ' м', s: 'terrain' },
        { k: 'riverDepth', t: 'range', l: 'Глубина русла', min: .5, max: 14, step: .25, u: ' м', s: 'terrain' },
        { k: 'riverMeander', t: 'range', l: 'Извилистость', min: 0, max: 1, step: .01, s: 'terrain', f: pct },
        { k: 'riverOffset', t: 'range', l: 'Смещение русла', min: -160, max: 160, step: 2, u: ' м', s: 'terrain' },
        { t: 'act', acts: [['flood', 'Затопить ниже уровня'], ['drain', 'Убрать всю воду']] }
      ] },
      { g: 'Освещение', items: [
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
      { g: 'Камера и качество', items: [
        { k: 'quality', t: 'select', l: 'Качество', opts: [['draft', 'Черновик'], ['game', 'Игра'], ['cine', 'Кино'], ['ultra', 'Ультра'], ['prime', 'Прайм']], s: 'quality' },
        { k: 'fov', t: 'range', l: 'Угол обзора', min: 24, max: 80, step: 1, u: '°', s: 'live' },
        { k: 'dist', t: 'range', l: 'Дистанция', min: 3, max: 700, step: 1, u: ' м', s: 'live' },
        { k: 'autoRotate', t: 'toggle', l: 'Облёт камеры', s: 'live' },
        { k: 'wireframe', t: 'toggle', l: 'Каркас', s: 'live' },
        { k: 'skeleton', t: 'toggle', l: 'Скелет роста', s: 'live' },
        { k: 'grid', t: 'toggle', l: 'Сетка', s: 'live' }
      ] },
      { g: 'Библиотека', items: [{ t: 'lib' }, { t: 'act', acts: [['stampOn', 'Кисть «Модель»']] }] }
    ],
    human: [
      { g: 'Пропорции', items: [
        { k: 'hHeight', t: 'range', l: 'Рост', min: 120, max: 215, step: 1, u: ' см', s: 'human' },
        { k: 'hFemale', t: 'range', l: 'Женственность', min: 0, max: 1, step: .01, s: 'human', f: pct },
        { k: 'hBuild', t: 'range', l: 'Телосложение', min: 0, max: 1, step: .01, s: 'human', f: pct },
        { k: 'hMuscle', t: 'range', l: 'Мускулатура', min: 0, max: 1, step: .01, s: 'human', f: pct },
        { k: 'hShoulders', t: 'range', l: 'Плечи', min: .7, max: 1.5, step: .01, s: 'human' },
        { k: 'hChest', t: 'range', l: 'Грудная клетка', min: .7, max: 1.5, step: .01, s: 'human' },
        { k: 'hWaist', t: 'range', l: 'Талия', min: .6, max: 1.6, step: .01, s: 'human' },
        { k: 'hHips', t: 'range', l: 'Бёдра', min: .7, max: 1.6, step: .01, s: 'human' },
        { k: 'hBelly', t: 'range', l: 'Живот', min: 0, max: 1, step: .01, s: 'human', f: pct },
        { k: 'hLegs', t: 'range', l: 'Длина ног', min: .8, max: 1.2, step: .01, s: 'human' },
        { k: 'hArms', t: 'range', l: 'Длина рук', min: .8, max: 1.2, step: .01, s: 'human' },
        { k: 'hHead', t: 'range', l: 'Размер головы', min: .8, max: 1.3, step: .01, s: 'human' },
        { k: 'hNeck', t: 'range', l: 'Шея', min: .7, max: 1.4, step: .01, s: 'human' },
        { k: 'hDetail', t: 'range', l: 'Полигонов по кругу', min: 8, max: 30, step: 1, s: 'human' }
      ] },
      { g: 'Лицо', items: [
        { k: 'hFace', t: 'range', l: 'Выразительность черт', min: 0, max: 1.6, step: .02, s: 'human', hint: 'нос, губы, надбровья, глазницы' },
        { k: 'hIris', t: 'color', l: 'Радужка', s: 'human' },
        { k: 'hBrows', t: 'toggle', l: 'Брови', s: 'human' },
        { k: 'hHairOn', t: 'toggle', l: 'Волосы', s: 'human' },
        { k: 'hFringe', t: 'range', l: 'Чёлка', min: 0, max: 1, step: .01, s: 'human', f: pct },
        { k: 'hLongHair', t: 'range', l: 'Длина волос', min: 0, max: 1, step: .01, s: 'human', f: pct },
        { k: 'hHair', t: 'color', l: 'Цвет волос', s: 'human' }
      ] },
      { g: 'Поза', items: [
        { k: 'hPose', t: 'select', l: 'Поза', opts: [['tpose', 'T-поза'], ['apose', 'A-поза'], ['idle', 'Стоит'], ['walk', 'Шаг'], ['run', 'Бег'], ['sit', 'Сидит']], s: 'pose' },
        { k: 'hArm', t: 'range', l: 'Опускание рук', min: 0, max: 90, step: 1, u: '°', s: 'human' },
        { k: 'hElbow', t: 'range', l: 'Сгиб локтя', min: 0, max: 130, step: 1, u: '°', s: 'human' },
        { k: 'hSpread', t: 'range', l: 'Разведение ног', min: 0, max: 40, step: 1, u: '°', s: 'human' },
        { k: 'hKnee', t: 'range', l: 'Сгиб колена', min: 0, max: 110, step: 1, u: '°', s: 'human' },
        { k: 'hLean', t: 'range', l: 'Наклон корпуса', min: -20, max: 35, step: 1, u: '°', s: 'human' },
        { k: 'hSwing', t: 'range', l: 'Шаг / замах', min: -50, max: 50, step: 1, u: '°', s: 'human' }
      ] },
      { g: 'Материалы', items: [
        { k: 'hClothed', t: 'toggle', l: 'Одежда', s: 'human' },
        { k: 'hSkin', t: 'color', l: 'Кожа', s: 'human' },
        { k: 'hShirt', t: 'color', l: 'Верх', s: 'human' },
        { k: 'hPants', t: 'color', l: 'Низ', s: 'human' },
        { k: 'hShoes', t: 'color', l: 'Обувь', s: 'human' },
        { t: 'act', acts: [['saveHuman', 'В библиотеку'], ['randomHuman', 'Случайный человек']] }
      ] },
      { g: 'Сцена', items: [
        { k: 'sunEl', t: 'range', l: 'Высота солнца', min: 0, max: 1, step: .01, s: 'live', f: pct },
        { k: 'sunAz', t: 'range', l: 'Азимут', min: 0, max: 360, step: 1, u: '°', s: 'live' },
        { k: 'lightInt', t: 'range', l: 'Сила света', min: .2, max: 2.5, step: .05, s: 'live' },
        { k: 'dist', t: 'range', l: 'Дистанция', min: 1, max: 30, step: .1, u: ' м', s: 'live' },
        { k: 'fov', t: 'range', l: 'Угол обзора', min: 20, max: 70, step: 1, u: '°', s: 'live' },
        { k: 'autoRotate', t: 'toggle', l: 'Облёт камеры', s: 'live' },
        { k: 'wireframe', t: 'toggle', l: 'Каркас', s: 'live' }
      ] }
    ],
    arch: [
      { g: 'Объём', items: [
        { k: 'bType', t: 'select', l: 'Тип', opts: [['house', 'Дом'], ['izba', 'Изба'], ['tower', 'Башня'], ['ruin', 'Руина']], s: 'arch' },
        { k: 'bWidth', t: 'range', l: 'Ширина', min: 3, max: 30, step: .5, u: ' м', s: 'arch' },
        { k: 'bDepth', t: 'range', l: 'Глубина', min: 3, max: 30, step: .5, u: ' м', s: 'arch' },
        { k: 'bFloors', t: 'range', l: 'Этажей', min: 1, max: 12, step: 1, s: 'arch' },
        { k: 'bFloorH', t: 'range', l: 'Высота этажа', min: 2.2, max: 6, step: .1, u: ' м', s: 'arch' }
      ] },
      { g: 'Крыша и проёмы', items: [
        { k: 'bRoofType', t: 'select', l: 'Крыша', opts: [['gable', 'Двускатная'], ['hip', 'Вальмовая'], ['flat', 'Плоская'], ['cone', 'Конус']], s: 'arch' },
        { k: 'bRoofH', t: 'range', l: 'Высота крыши', min: .4, max: 10, step: .1, u: ' м', s: 'arch' },
        { k: 'bWindows', t: 'range', l: 'Окон на сторону', min: 0, max: 10, step: 1, s: 'arch' },
        { k: 'bWinSize', t: 'range', l: 'Ширина окна', min: .5, max: 3, step: .05, u: ' м', s: 'arch' },
        { k: 'bDoor', t: 'toggle', l: 'Дверь и крыльцо', s: 'arch' },
        { k: 'bChimney', t: 'toggle', l: 'Труба', s: 'arch' }
      ] },
      { g: 'Материалы', items: [
        { k: 'bWall', t: 'color', l: 'Стены', s: 'arch' },
        { k: 'bRoof', t: 'color', l: 'Кровля', s: 'arch' },
        { k: 'bTrim', t: 'color', l: 'Отделка', s: 'arch' },
        { t: 'act', acts: [['saveArch', 'В библиотеку'], ['randomArch', 'Случайное здание']] }
      ] },
      { g: 'Сцена', items: [
        { k: 'sunEl', t: 'range', l: 'Высота солнца', min: 0, max: 1, step: .01, s: 'live', f: pct },
        { k: 'sunAz', t: 'range', l: 'Азимут', min: 0, max: 360, step: 1, u: '°', s: 'live' },
        { k: 'dist', t: 'range', l: 'Дистанция', min: 4, max: 120, step: 1, u: ' м', s: 'live' },
        { k: 'autoRotate', t: 'toggle', l: 'Облёт камеры', s: 'live' },
        { k: 'wireframe', t: 'toggle', l: 'Каркас', s: 'live' }
      ] }
    ]
  };
  const QUICK = { world: ['brushRadius', 'brushStrength', 'sunEl', 'waterLevel', 'treeCount', 'grassCount'], human: ['hHeight', 'hBuild', 'hFace', 'hArm', 'hKnee', 'hShoulders'], arch: ['bWidth', 'bFloors', 'bRoofH', 'bWindows', 'bWinSize', 'bDepth'] };
  const DOCKEXTRA = { world: ['wind', 'quality'], human: ['hClothed', 'hFemale'], arch: ['bDoor', 'bType'] };
  const byKey = {};
  Object.values(TABS).flat().flatMap(s => s.items).forEach(i => { if (i.k && !byKey[i.k]) byKey[i.k] = i; });
  let registry = {};
  const openAcc = { world: 'Кисти', human: 'Пропорции', arch: 'Объём' };
  const fmtVal = (i, v) => i.f ? i.f(v) : (i.step < 1 ? Number(v).toFixed(2) : String(v)) + (i.u || '');
  function paint(i, el, out) {
    const v = getVal(i);
    if (i.t === 'range') { el.value = v; el.style.setProperty('--p', ((v - i.min) / (i.max - i.min) * 100).toFixed(2)); if (out) out.textContent = fmtVal(i, v); }
    else if (i.t === 'select') el.value = String(v);
    else if (i.t === 'color') { el.value = v; if (out) out.textContent = v; }
    else { el.setAttribute('aria-checked', String(!!v)); el.classList.toggle('on', !!v); }
  }
  const syncKey = k => (registry[k] || []).forEach(r => paint(r.item, r.el, r.out));
  function syncUI() {
    Object.keys(registry).forEach(syncKey);
    $('seedName').textContent = P.seed;
    $('cntChip').textContent = MODE === 'world' ? (forest.trees.length + props.length) + ' объ.' : MODE === 'human' ? Math.round(P.hHeight) + ' см' : Math.round(building.stats.height) + ' м';
    $('btnWire').classList.toggle('on', P.wireframe);
    $('btnEdit').classList.toggle('on', edit);
    const sel = selected || selProp;
    $('selChip').classList.toggle('show', !!sel && MODE === 'world');
    $('selAll').style.display = selected ? '' : 'none';
    if (sel) $('selText').textContent = selected ? 'дерево #' + selected.id : selProp.name;
    document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.k === P.preset));
    document.querySelectorAll('.librow').forEach(r => r.classList.toggle('on', +r.dataset.id === activeLib));
    document.querySelectorAll('.libchip').forEach(r => r.classList.toggle('on', +r.dataset.id === activeLib));
  }
  function setVal(i, v) { if (isTreeKey(i)) target()[i.k] = v; else P[i.k] = v; }
  function makeControl(i, host, compact) {
    if (i.t === 'act') {
      const row = document.createElement('div'); row.className = 'actrow';
      i.acts.forEach(([a, l]) => { const b = document.createElement('button'); b.className = 'actbtn'; b.textContent = l; b.onclick = () => doAct(a); row.appendChild(b); });
      host.appendChild(row); return;
    }
    if (i.t === 'lib') {
      const wrap = document.createElement('div'); wrap.className = 'liblist'; wrap.id = 'libList';
      host.appendChild(wrap); renderLib(); return;
    }
    const box = document.createElement('div'); box.className = compact ? 'dockitem' : 'ctl';
    const reg = (el, out) => { (registry[i.k] = registry[i.k] || []).push({ item: i, el, out }); };
    if (i.t === 'toggle' && compact) {
      const el = document.createElement('button'); el.className = 'dockbtn'; el.textContent = i.l; el.setAttribute('role', 'switch');
      el.onclick = () => { setVal(i, !getVal(i)); syncKey(i.k); Sound.tick(700); buzz('LIGHT'); onParam(i); };
      reg(el); host.appendChild(el); return;
    }
    if (i.t === 'range') {
      box.innerHTML = `<div class="head"><label>${i.l}</label><output></output></div>`;
      const el = document.createElement('input'); el.type = 'range'; el.min = i.min; el.max = i.max; el.step = i.step;
      box.appendChild(el);
      if (i.hint && !compact) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = i.hint; box.appendChild(h); }
      el.addEventListener('input', () => { setVal(i, parseFloat(el.value)); syncKey(i.k); onParam(i); });
      el.addEventListener('change', () => buzz('LIGHT'));
      reg(el, box.querySelector('output'));
    } else if (i.t === 'select') {
      box.innerHTML = `<div class="head"><label>${i.l}</label></div>`;
      const s = document.createElement('div'); s.className = 'sel';
      const el = document.createElement('select');
      i.opts.forEach(([v, n]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = n; el.appendChild(o); });
      s.appendChild(el); box.appendChild(s);
      el.addEventListener('change', () => { setVal(i, isNaN(+el.value) ? el.value : +el.value); syncKey(i.k); Sound.tick(520); buzz('LIGHT'); onParam(i); });
      reg(el);
    } else if (i.t === 'color') {
      box.innerHTML = `<div class="head"><label>${i.l}</label></div>`;
      const row = document.createElement('div'); row.className = 'colrow';
      const el = document.createElement('input'); el.type = 'color'; const code = document.createElement('code');
      row.append(el, code); box.appendChild(row);
      el.addEventListener('input', () => { setVal(i, el.value); syncKey(i.k); onParam(i); });
      reg(el, code);
    } else {
      const el = document.createElement('button'); el.className = 'sw'; el.setAttribute('role', 'switch');
      el.innerHTML = `<span>${i.l}</span><i></i>`;
      el.onclick = () => { setVal(i, !getVal(i)); syncKey(i.k); Sound.tick(700); buzz('LIGHT'); onParam(i); };
      reg(el); box.appendChild(el);
    }
    host.appendChild(box);
  }
  function renderLib() {
    const w = $('libList'); if (!w) return;
    w.innerHTML = '';
    library.forEach(it => {
      const row = document.createElement('div'); row.className = 'librow' + (it.id === activeLib ? ' on' : ''); row.dataset.id = it.id;
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name;
      nm.onclick = () => { activeLib = it.id; setEdit(true); tool = 'stamp'; buildTools(); syncUI(); toast('Кисть «Модель»: ' + it.name + ' — тапни по земле'); };
      const kd = document.createElement('span'); kd.className = 'kd'; kd.textContent = it.kind === 'tree' ? 'дерево' : it.kind === 'human' ? 'человек' : 'здание';
      const del = document.createElement('button'); del.textContent = '✕';
      del.onclick = () => { const i = library.indexOf(it); if (i >= 0) library.splice(i, 1); if (activeLib === it.id) activeLib = library[0] ? library[0].id : 0; renderLib(); buildBrushBar(); syncUI(); };
      row.append(nm, kd, del); w.appendChild(row);
    });
  }
  const EXP = { wood: true, leaves: true, land: true, rocks: true, grass: false, water: true, leafCap: isMobile ? 5000 : 18000, grassCap: isMobile ? 6000 : 25000 };
  function buildUI() {
    registry = {};
    const panes = $('panes'); panes.innerHTML = '';
    if (MODE === 'world') {
      const pr = document.createElement('div'); pr.className = 'presets'; pr.style.padding = '2px 16px 10px';
      Object.entries(PRESETS).forEach(([k, v]) => {
        const btn = document.createElement('button'); btn.className = 'preset'; btn.dataset.k = k;
        btn.innerHTML = `<span>${v.e}</span>${v.n}`;
        btn.onclick = () => {
          P.preset = k; Object.assign(target(), v.p);
          if (isMobile && v.p.leaves) target().leaves = Math.round(v.p.leaves * .45);
          if (k === 'mix') { selected = null; forest.select(null); }
          syncUI(); applyLive(); queue(selected ? 'one' : 'all'); Sound.tick(820); buzz('MEDIUM'); toast('Вид: ' + v.n);
        };
        pr.appendChild(btn);
      });
      panes.appendChild(pr);
    }
    TABS[MODE].forEach((sec, si) => {
      const s = document.createElement('section'); s.className = 'acc' + (openAcc[MODE] === sec.g ? ' open' : '');
      const head = document.createElement('button'); head.className = 'acchead';
      head.innerHTML = `<span class="num">${String(si + 1).padStart(2, '0')}</span><span class="name">${sec.g}</span><span class="chev">▾</span>`;
      const body = document.createElement('div'); body.className = 'accbody';
      sec.items.forEach(i => makeControl(i, body, false));
      head.onclick = () => {
        const was = s.classList.contains('open');
        panes.querySelectorAll('.acc').forEach(a => a.classList.remove('open'));
        if (!was) { s.classList.add('open'); openAcc[MODE] = sec.g; } else openAcc[MODE] = null;
        Sound.tick(560); buzz('LIGHT');
      };
      s.append(head, body); panes.appendChild(s);
    });
    const q = $('quick'); q.innerHTML = '';
    const qh = document.createElement('div'); qh.className = 'qhead';
    qh.innerHTML = `<span class="lbl">быстрые</span><span class="seed"><b>${P.seed}</b><button id="qminus">−</button><button id="qplus">+</button><button id="qdice">⚄</button></span>`;
    q.appendChild(qh);
    const qg = document.createElement('div'); qg.className = 'qgrid';
    QUICK[MODE].forEach(k => byKey[k] && makeControl(byKey[k], qg, false));
    q.appendChild(qg);
    $('qminus').onclick = () => reseed(-1); $('qplus').onclick = () => reseed(1);
    $('qdice').onclick = () => { P.seed = 1 + ((Math.random() * 99999) | 0); reseed(0); };
    const dock = $('dock'); dock.innerHTML = '';
    QUICK[MODE].forEach(k => byKey[k] && makeControl(byKey[k], dock, true));
    const db = document.createElement('div'); db.className = 'dockbtns';
    DOCKEXTRA[MODE].forEach(k => byKey[k] && makeControl(byKey[k], db, true));
    const b1 = document.createElement('button'); b1.className = 'dockbtn'; b1.textContent = '⚄'; b1.onclick = () => $('btnDice2').click();
    const b2 = document.createElement('button'); b2.className = 'dockbtn'; b2.textContent = '👁'; b2.onclick = () => setClean(true);
    const b3 = document.createElement('button'); b3.className = 'dockbtn exit'; b3.textContent = '✕'; b3.onclick = () => setViewer(false);
    db.append(b1, b2, b3); dock.appendChild(db);
    const act = $('actions'); act.innerHTML = '';
    const mk = (cls, txt, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = txt; b.onclick = fn; act.appendChild(b); return b; };
    mk('btn primary wide', MODE === 'world' ? '✦ Новый мир' : MODE === 'human' ? '✦ Случайный человек' : '✦ Случайное здание', () => MODE === 'world' ? randomWorld() : randomModel());
    if (MODE === 'world') {
      const tg = document.createElement('div'); tg.className = 'exptogs';
      [['wood', 'стволы'], ['leaves', 'листва'], ['land', 'земля'], ['rocks', 'камни'], ['grass', 'трава'], ['water', 'вода']].forEach(([k, l]) => {
        const b = document.createElement('button'); b.className = 'exptog' + (EXP[k] ? ' on' : ''); b.textContent = l;
        b.onclick = () => { EXP[k] = !EXP[k]; b.classList.toggle('on', EXP[k]); buzz('LIGHT'); expInfo(); };
        tg.appendChild(b);
      });
      act.appendChild(tg);
    }
    const sel = document.createElement('div'); sel.className = 'sel'; sel.style.gridColumn = '1/-1';
    sel.innerHTML = `<select id="expFormat"><option value="glb">GLB (glTF, с текстурами)</option><option value="obj">OBJ</option></select>`;
    act.appendChild(sel);
    mk('btn wide', MODE === 'world' ? '↓ Скачать 3D-мир' : MODE === 'human' ? '↓ Скачать человека' : '↓ Скачать здание', () => doExport(MODE));
    mk('btn', '▣ Кадр', () => shot());
    mk('btn', '↺ Сброс', () => resetAll());
    const info = document.createElement('div'); info.className = 'expinfo'; info.id = 'expInfo';
    act.appendChild(info);
    buildTools(); buildBrushBar(); syncUI(); expInfo();
  }
  function buildTools() {
    const r = $('toolRail'); r.innerHTML = '';
    TOOLS.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tbtn ' + (t.cls || '') + (tool === t.k ? ' on' : '');
      b.dataset.n = t.n; b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[t.k]}</svg>`;
      b.onclick = () => { tool = t.k; buildTools(); buildBrushBar(); Sound.tick(660); buzz('LIGHT'); toast(t.n + (t.k === 'stamp' ? ': выбери модель и тапни по земле' : t.k === 'camera' ? ': тяни — облёт' : ': веди пальцем по земле')); };
      r.appendChild(b);
    });
    r.classList.toggle('show', edit && !clean && MODE === 'world');
  }
  function buildBrushBar() {
    const b = $('brushBar'); b.innerHTML = '';
    b.classList.toggle('show', edit && !clean && MODE === 'world');
    if (!(edit && MODE === 'world')) return;
    const addr = (k, label) => {
      const i = byKey[k], g = document.createElement('div'); g.className = 'bgrp';
      g.innerHTML = `<div class="head"><label>${label}</label><output></output></div>`;
      const el = document.createElement('input'); el.type = 'range'; el.min = i.min; el.max = i.max; el.step = i.step;
      g.appendChild(el);
      el.addEventListener('input', () => { P[k] = parseFloat(el.value); syncKey(k); });
      (registry[k] = registry[k] || []).push({ item: i, el, out: g.querySelector('output') });
      b.appendChild(g); paint(i, el, g.querySelector('output'));
    };
    addr('brushRadius', 'радиус'); addr('brushStrength', 'сила'); addr('brushHard', 'край');
    if (tool === 'paint') {
      const sw = document.createElement('div'); sw.className = 'swatches';
      PAINTS.forEach(p => {
        const s = document.createElement('button'); s.className = 'sw2' + (P.paintColor === p.c ? ' on' : '');
        s.style.background = p.c; s.title = p.n;
        s.onclick = () => { P.paintColor = p.c; buildBrushBar(); Sound.tick(720); buzz('LIGHT'); };
        sw.appendChild(s);
      });
      b.appendChild(sw);
    }
    if (tool === 'stamp') {
      const lc = document.createElement('div'); lc.className = 'libchips';
      library.forEach(it => {
        const c = document.createElement('button'); c.className = 'libchip' + (it.id === activeLib ? ' on' : ''); c.dataset.id = it.id;
        c.textContent = it.name;
        c.onclick = () => { activeLib = it.id; buildBrushBar(); syncUI(); Sound.tick(700); };
        lc.appendChild(c);
      });
      b.appendChild(lc);
    }
    const un = document.createElement('button'); un.className = 'bbtn warn'; un.textContent = '↶ Отменить';
    un.onclick = () => doAct('undo'); b.appendChild(un);
    const off = document.createElement('button'); off.className = 'bbtn'; off.textContent = 'Готово';
    off.onclick = () => setEdit(false); b.appendChild(off);
  }
  function expInfo() {
    try { const s = partsStats(collectParts(MODE)); const el = $('expInfo'); if (el) el.textContent = `${s.meshes} мешей · ${fmt(s.verts)} вершин · ${fmt(s.tris)} трис`; }
    catch (e) { const el = $('expInfo'); if (el) el.textContent = 'экспорт: ' + e.message; }
  }
  function collectParts(mode) {
    if (mode === 'world') {
      const parts = collectWorld({ forest, terrain: land, water: { mesh: land.waterMesh } }, EXP);
      for (const pr of props) {
        pr.inst.group.updateMatrixWorld(true);
        const ms = pr.kind === 'human' ? pr.inst.meshes : { solid: pr.inst.mesh, glass: pr.inst.glass };
        for (const k in ms) {
          const m = ms[k]; if (!m) continue;
          const md = m.material;
          pushMesh(parts, m.geometry, m.matrixWorld, { key: pr.kind + '_' + k + '_' + (md.map ? md.map.id : 'x'), color: [md.color.r, md.color.g, md.color.b], map: md.map, normalMap: md.normalMap, rough: md.roughness, alpha: md.alphaTest || 0, opacity: md.transparent ? md.opacity : 1, doubleSided: md.side === THREE.DoubleSide }, pr.name + '_' + pr.id + '_' + k);
        }
      }
      return parts;
    }
    const parts = [];
    if (mode === 'human') {
      human.group.updateMatrixWorld(true);
      for (const k in human.meshes) {
        const m = human.meshes[k], md = m.material;
        pushMesh(parts, m.geometry, m.matrixWorld, { key: 'human_' + k + '_' + (md.map ? md.map.id : 'x'), color: [md.color.r, md.color.g, md.color.b], map: md.map, normalMap: md.normalMap, rough: md.roughness, opacity: md.transparent ? md.opacity : 1, doubleSided: md.side === THREE.DoubleSide }, 'Human_' + k);
      }
    } else {
      building.group.updateMatrixWorld(true);
      if (building.mesh) pushMesh(parts, building.mesh.geometry, building.mesh.matrixWorld, { key: 'building', color: [1, 1, 1], rough: .85 }, 'Building');
      if (building.glass) pushMesh(parts, building.glass.geometry, building.glass.matrixWorld, { key: 'glass', color: [.1, .2, .32], rough: .18, opacity: .85 }, 'Glass');
    }
    return parts;
  }

  /* --- деревья и пропсы --- */
  function treeParams(base, rng, v) {
    const p = {}; for (const k of TREE_KEYS) p[k] = base[k];
    p.seed = 1 + ((rng() * 999999) | 0);
    p.height = clamp(base.height * (1 + (rng() - .5) * v * .8), 4, 30);
    p.trunk = clamp(base.trunk * (1 + (rng() - .5) * v * .6), .15, 1.6);
    p.crown = Math.round(clamp(base.crown * (1 + (rng() - .5) * v * .7), 300, 8000));
    p.chaos = clamp(base.chaos + (rng() - .5) * v * .5, 0, 1);
    p.leaves = Math.round(clamp(base.leaves * (1 + (rng() - .5) * v * .6), 0, 180000));
    const c = new THREE.Color(base.leafColor), h = { h: 0, s: 0, l: 0 };
    c.getHSL(h, THREE.SRGBColorSpace);
    c.setHSL((h.h + (rng() - .5) * .09 * v + 1) % 1, clamp(h.s + (rng() - .5) * .2 * v, .1, 1), clamp(h.l + (rng() - .5) * .14 * v, .12, .85), THREE.SRGBColorSpace);
    p.leafColor = '#' + c.getHexString(THREE.SRGBColorSpace);
    if (v > .55 && rng() < .35) { p.leafShape = ['cluster', 'broad', 'needle', 'bloom'][(rng() * 4) | 0]; p.shape = ['sphere', 'cone', 'umbrella'][(rng() * 3) | 0]; }
    return p;
  }
  function placeTrees() {
    const rng = mulberry32(P.seed * 31 + 7);
    const want = Math.min(Math.round(P.treeCount), Q.treeCap);
    while (forest.trees.length > want) forest.drop(forest.trees[forest.trees.length - 1]);
    const spots = [];
    const ok = (x, z, md) => {
      if (land.heightAt(x, z) < (P.water ? P.waterLevel + .4 : -1e9)) return false;
      if (land.normalAt(x, z).y < .74) return false;
      for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < md) return false;
      return true;
    };
    forest.trees.forEach((t, i) => { t.p = treeParams(P, rng, i === 0 ? 0 : P.variation); if (i === 0) { t.x = 0; t.z = 0; } spots.push([t.x, t.z]); });
    while (forest.trees.length < want) {
      const p = treeParams(P, rng, P.variation);
      let x = 0, z = 0, tries = 0;
      const md = Math.max(4, p.height * .55);
      do { const a = rng() * TAU, r = Math.sqrt(rng()) * P.scatter; x = Math.cos(a) * r; z = Math.sin(a) * r; tries++; } while (!ok(x, z, md) && tries < 120);
      forest.newTree(p, x, z); spots.push([x, z]);
    }
    forest.trees.forEach(t => { t.baseY = land.heightAt(t.x, t.z); t.group.position.set(t.x, t.baseY, t.z); });
  }
  function* placeProp(item, x, z) {
    if (item.kind === 'tree') {
      if (forest.trees.length >= Q.treeCap) { toast('Лимит деревьев', 'warn'); return; }
      const t = forest.newTree(Object.assign({}, item.params, { seed: 1 + ((Math.random() * 1e6) | 0) }), x, z);
      t.baseY = land.heightAt(x, z); t.group.position.set(x, t.baseY, z);
      yield* forest.build(t, Q, land.heightAt, P.waterLevel);
      selected = t; selProp = null; forest.select(t);
      P.treeCount = forest.trees.length;
    } else {
      const inst = item.kind === 'human' ? createHuman(HT) : createBuilding();
      const pr = Object.assign({}, item.params, { seed: 1 + ((Math.random() * 1e6) | 0) });
      yield* inst.build(pr);
      const y = land.heightAt(x, z);
      inst.group.position.set(x, y, z);
      inst.group.rotation.y = Math.random() * TAU;
      propRoot.add(inst.group);
      const h = inst.stats.height || 2;
      const rec = { id: libId++, name: item.name, kind: item.kind, inst, params: pr, x, z, y, h, r: item.kind === 'human' ? .5 : Math.max(pr.bWidth, pr.bDepth) * .6, scale: 1 };
      props.push(rec); selProp = rec; selected = null; forest.select(null);
    }
    syncUI(); expInfo();
  }
  function dropProp(p) {
    const i = props.indexOf(p); if (i < 0) return;
    propRoot.remove(p.inst.group);
    if (p.inst.dispose) p.inst.dispose();
    else if (p.inst.mesh) { p.inst.mesh.geometry.dispose(); if (p.inst.glass) p.inst.glass.geometry.dispose(); }
    props.splice(i, 1);
    if (selProp === p) selProp = null;
  }
  function reseat() {
    for (const t of forest.trees) { t.baseY = land.heightAt(t.x, t.z); t.group.position.y = t.baseY; }
    for (const p of props) { p.y = land.heightAt(p.x, p.z); p.inst.group.position.y = p.y; }
    if (selected) forest.select(selected);
  }

  /* --- очередь --- */
  const dirty = { all: false, one: null, terrain: false, veg: false, bark: false, human: false, arch: false, grid: false, paint: false, prop: null };
  let pendingAt = 0, job = null;
  function queue(s) {
    if (s === 'all') dirty.all = true;
    else if (s === 'one') dirty.one = selected;
    else if (s === 'terrain') { dirty.terrain = dirty.veg = dirty.all = dirty.grid = dirty.paint = true; }
    else if (s === 'veg') dirty.veg = true;
    else if (s === 'water') { dirty.veg = dirty.all = true; }
    else if (s === 'forest') dirty.all = true;
    else if (s === 'bark') dirty.bark = true;
    else if (s === 'human') dirty.human = true;
    else if (s === 'arch') dirty.arch = true;
    else if (s === 'paint') dirty.paint = true;
    else if (s === 'pose') {
      const q = HUMAN_POSES[P.hPose];
      if (q) { P.hArm = q.arm; P.hElbow = q.elbow; P.hSpread = q.spread; P.hKnee = q.knee; P.hLean = q.lean; P.hSwing = q.swing;
        ['hArm', 'hElbow', 'hSpread', 'hKnee', 'hLean', 'hSwing'].forEach(syncKey); }
      dirty.human = true;
    }
    pendingAt = performance.now(); $('growChip').classList.add('show');
  }
  function* combined() {
    if (dirty.bark) { forest.setBark(yield* barkJob(makeNoise3D(90210), P.barkRes)); dirty.bark = false; }
    if (dirty.human) { yield* human.build(P); dirty.human = false; }
    if (dirty.arch) { yield* building.build(P); dirty.arch = false; }
    if (dirty.grid || dirty.terrain || dirty.veg || dirty.paint) {
      yield* land.build(P, Q, { grid: dirty.grid || dirty.terrain, heights: dirty.terrain, paint: dirty.paint || dirty.terrain, veg: dirty.veg || dirty.terrain });
      dirty.grid = dirty.terrain = dirty.veg = dirty.paint = false;
      if (dirty.all) { placeTrees(); for (const t of forest.trees) yield* forest.build(t, Q, land.heightAt, P.waterLevel); dirty.all = false; dirty.one = null; }
      reseat();
    }
    if (dirty.all) { placeTrees(); for (const t of forest.trees) yield* forest.build(t, Q, land.heightAt, P.waterLevel); dirty.all = false; dirty.one = null; }
    else if (dirty.one) { yield* forest.build(dirty.one, Q, land.heightAt, P.waterLevel); dirty.one = null; }
    if (dirty.prop) { const d = dirty.prop; dirty.prop = null; yield* placeProp(d.item, d.x, d.z); }
    forest.setSkeleton(P.skeleton);
    if (selected) forest.select(selected);
    syncUI(); expInfo();
    return true;
  }
  function onParam(i) {
    if (i.s === 'live') applyLive();
    else if (i.s === 'quality') { Q = QUALITY[P.quality]; E.setQuality(Q); queue('terrain'); toast('Качество: ' + Q.n); }
    else if (i.s === 'tree' || i.s === 'leaf') queue(selected ? 'one' : 'all');
    else queue(i.s);
  }
  function applyLive() {
    forest.setWire(P.wireframe); land.setWire(P.wireframe);
    human.setWire(P.wireframe); building.mat.wireframe = P.wireframe;
    for (const p of props) { if (p.inst.setWire) p.inst.setWire(P.wireframe); else if (p.inst.mat) p.inst.mat.wireframe = P.wireframe; }
    forest.setSkeleton(P.skeleton);
    U.wind.value = P.wind; U.backlight.value = P.backlight; Sound.setWind(P.wind);
    E.flies.visible = P.fireflies && MODE === 'world'; grid.visible = P.grid;
    E.setParticles(MODE === 'world' ? P.particles : 0, focusY());
    E.cam.tRadius = P.dist;
    land.setWater(P.water); land.setWaves(P.waves);
    E.applySky(P, focusY(), MODE === 'world' ? Math.max(P.scatter, P.grassRadius) * 1.15 + P.height : viewHeight() * 2.2 + 4);
    $('btnWire').classList.toggle('on', P.wireframe);
  }
  function setMode(m) {
    MODE = m;
    worldRoot.visible = m === 'world'; studio.visible = m !== 'world';
    human.group.visible = m === 'human'; building.group.visible = m === 'arch';
    selected = null; selProp = null; forest.select(null);
    P.dist = m === 'world' ? (isMobile ? 42 : 40) : m === 'human' ? 3.2 : 26;
    P.focusX = 0; P.focusZ = 0;
    E.cam.tRadius = P.dist; E.resetCamera();
    if (m !== 'world') setEdit(false);
    $('modeTag').textContent = m === 'world' ? 'world editor' : m === 'human' ? 'human editor' : 'architecture';
    $('triLabel').textContent = m === 'world' ? 'треугольников мира' : 'треугольников модели';
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === m));
    buildUI(); applyLive();
    if (m === 'human') queue('human'); if (m === 'arch') queue('arch');
    E.markShadows();
  }
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => { setMode(b.dataset.tab); Sound.tick(760); buzz('MEDIUM'); });

  /* --- действия --- */
  function doAct(a) {
    if (a === 'regen') { queue('terrain'); toast('Рельеф пересобирается'); }
    else if (a === 'repaint') { queue('paint'); toast('Биомы перекрашиваются'); }
    else if (a === 'regrow') { queue('veg'); toast('Трава пересаживается'); }
    else if (a === 'editon') setEdit(true);
    else if (a === 'undo') undo();
    else if (a === 'flood') { pushUndo(false); land.flood(P.waterLevel); reseat(); E.markShadows(); toast('Затоплено ниже ' + P.waterLevel.toFixed(1) + ' м'); }
    else if (a === 'drain') { pushUndo(false); land.drain(); reseat(); E.markShadows(); toast('Вода убрана'); }
    else if (a === 'stampOn') { setEdit(true); tool = 'stamp'; buildTools(); buildBrushBar(); toast('Тапни по земле — модель встанет туда'); }
    else if (a === 'saveTree') {
      if (!selected) { toast('Сначала выбери дерево тапом', 'warn'); return; }
      library.push({ id: libId++, name: 'Дерево ' + libId, kind: 'tree', params: Object.assign({}, selected.p) });
      renderLib(); buildBrushBar(); toast('Дерево сохранено в библиотеку');
    } else if (a === 'saveHuman') {
      library.push({ id: libId++, name: 'Человек ' + libId, kind: 'human', params: Object.assign({}, P) });
      renderLib(); toast('Человек сохранён — доступен кистью «Модель»');
    } else if (a === 'saveArch') {
      library.push({ id: libId++, name: 'Здание ' + libId, kind: 'arch', params: Object.assign({}, P) });
      renderLib(); toast('Здание сохранено в библиотеку');
    } else if (a === 'randomHuman' || a === 'randomArch') randomModel();
    buzz('LIGHT'); Sound.tick(680);
  }
  function pushUndo(withPaint) {
    undoStack.push(land.snapshot(withPaint));
    if (undoStack.length > (isMobile ? 4 : 8)) undoStack.shift();
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) { toast('Отменять нечего', 'warn'); return; }
    if (land.restore(s)) { reseat(); E.markShadows(); toast('Мазок отменён'); Sound.tick(420); }
    else toast('Сетка изменилась — отмена невозможна', 'warn');
  }

  /* --- жесты и кисти --- */
  const hit = new THREE.Vector3();
  function rayTerrain(o, d) {
    let t = 0;
    for (let i = 0; i < 340; i++) {
      const nt = t + 1.4 * (1 + t * .012);
      if (o.y + d.y * nt - land.heightAt(o.x + d.x * nt, o.z + d.z * nt) < 0) {
        let a = t, b = nt;
        for (let k = 0; k < 22; k++) { const m = (a + b) / 2; if (o.y + d.y * m - land.heightAt(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m; }
        const tt = (a + b) / 2;
        return hit.set(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt);
      }
      t = nt; if (t > 1800) break;
    }
    return null;
  }
  function pickProp(o, d) {
    let best = null, bt = Infinity;
    for (const p of props) {
      const cx = p.x, cy = p.y + p.h * p.scale * .5, cz = p.z, r = Math.max(p.r * p.scale, p.h * p.scale * .4);
      const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
      const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c; if (disc < 0) continue;
      const tt = -b - Math.sqrt(disc);
      if (tt > 0 && tt < bt) { bt = tt; best = p; }
    }
    return best;
  }
  const ptrs = new Map();
  let stroke = null, dragObj = null, dragMoved = false, gesture = null, lastPaint = null, strokeBox = null, plateauY = 0;
  function applyBrush(dt) {
    if (!stroke) return;
    const { x, z } = stroke;
    if (tool === 'paint') {
      const r = land.paint(x, z, P.brushRadius, P.brushStrength, P.brushHard, P.paintColor, lastPaint ? lastPaint.cx : null, lastPaint ? lastPaint.cy : null);
      lastPaint = r;
    } else if (tool === 'stamp' || tool === 'camera') return;
    else {
      const b = land.sculpt(x, z, tool, P.brushRadius, P.brushStrength, P.brushHard, dt, plateauY);
      if (b) strokeBox = strokeBox ? { i0: Math.min(strokeBox.i0, b.i0), i1: Math.max(strokeBox.i1, b.i1), j0: Math.min(strokeBox.j0, b.j0), j1: Math.max(strokeBox.j1, b.j1) } : b;
    }
    cursor.position.set(x, land.heightAt(x, z) + .06, z);
    const s = P.brushRadius; cursor.scale.set(s, s, s);
  }
  function endStroke() {
    if (!stroke) return;
    stroke = null; lastPaint = null;
    Sound.brush(false);
    land.flushPaint();
    if (strokeBox) { land.refreshVeg(strokeBox); strokeBox = null; }
    reseat(); E.markShadows(); expInfo();
    canvas.classList.remove('brushing');
  }
  stage.addEventListener('pointerdown', e => {
    if (e.target !== canvas) return;
    Sound.resume();
    if (clean) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (MODE !== 'world') return;
    const editing = edit && tool !== 'camera';
    if (editing && ptrs.size >= 2) {
      endStroke(); dragObj = null;
      const p = [...ptrs.values()];
      gesture = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
      e.stopPropagation(); e.preventDefault(); return;
    }
    const { o, d } = E.pointerRay(e.clientX, e.clientY);
    if (editing) {
      const hp = rayTerrain(o, d);
      e.stopPropagation(); e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      if (!hp) return;
      if (tool === 'stamp') { stroke = { x: hp.x, z: hp.z, stamp: true }; return; }
      pushUndo(tool === 'paint');
      plateauY = hp.y;
      stroke = { x: hp.x, z: hp.z };
      strokeBox = null;
      canvas.classList.add('brushing');
      cursor.visible = true;
      Sound.brush(true, tool === 'water');
      applyBrush(.05);
      $('hint').classList.add('gone');
      return;
    }
    const t = forest.pick(o, d), pr = t ? null : pickProp(o, d);
    if (t || pr) {
      e.stopPropagation(); e.preventDefault();
      dragObj = t || pr; dragMoved = false;
      if (t) { selected = t; selProp = null; forest.select(t); } else { selProp = pr; selected = null; forest.select(null); }
      syncUI(); canvas.classList.add('grabtree');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      buzz('MEDIUM'); Sound.tick(520); $('hint').classList.add('gone');
    }
  }, true);
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture && ptrs.size >= 2) {
      e.stopPropagation();
      const p = [...ptrs.values()], d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2;
      if (gesture.d > 0 && d > 0) { E.cam.tRadius = clamp(E.cam.tRadius * (gesture.d / d), 3, 700); P.dist = Math.round(E.cam.tRadius); syncKey('dist'); }
      E.cam.tTheta -= (cx - gesture.cx) * .006;
      E.cam.tPhi = clamp(E.cam.tPhi - (cy - gesture.cy) * .005, .06, 1.53);
      gesture = { d, cx, cy };
      return;
    }
    if (stroke) {
      e.stopPropagation();
      const { o, d } = E.pointerRay(e.clientX, e.clientY);
      const hp = rayTerrain(o, d);
      if (hp) { stroke.x = hp.x; stroke.z = hp.z; }
      return;
    }
    if (dragObj) {
      e.stopPropagation();
      const { o, d } = E.pointerRay(e.clientX, e.clientY);
      const hp = rayTerrain(o, d);
      if (hp) {
        dragMoved = true;
        const lim = P.tsize * .46, x = clamp(hp.x, -lim, lim), z = clamp(hp.z, -lim, lim), y = land.heightAt(x, z);
        if (dragObj.group) { forest.move(dragObj, x, z, y); }
        else { dragObj.x = x; dragObj.z = z; dragObj.y = y; dragObj.inst.group.position.set(x, y, z); }
      }
      return;
    }
    if (edit && tool !== 'camera' && MODE === 'world' && !clean) {
      const { o, d } = E.pointerRay(e.clientX, e.clientY);
      const hp = rayTerrain(o, d);
      if (hp) { cursor.visible = true; cursor.position.set(hp.x, hp.y + .06, hp.z); const s = P.brushRadius; cursor.scale.set(s, s, s); }
      else cursor.visible = false;
    }
  }, true);
  const upH = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) gesture = null;
    if (stroke && stroke.stamp) {
      const it = library.find(l => l.id === activeLib);
      if (it) { dirty.prop = { item: it, x: stroke.x, z: stroke.z }; pendingAt = performance.now(); $('growChip').classList.add('show'); toast('Ставлю: ' + it.name); }
      stroke = null; return;
    }
    if (stroke) { e.stopPropagation(); endStroke(); }
    if (dragObj) {
      e.stopPropagation();
      const o = dragObj; dragObj = null; canvas.classList.remove('grabtree');
      if (dragMoved) {
        if (o.group) { dirty.one = o; pendingAt = performance.now(); $('growChip').classList.add('show'); }
        toast('Перемещено');
      }
    }
  };
  stage.addEventListener('pointerup', upH, true);
  stage.addEventListener('pointercancel', upH, true);
  canvas.addEventListener('dblclick', e => {
    if (clean || MODE !== 'world' || edit) return;
    const { o, d } = E.pointerRay(e.clientX, e.clientY);
    if (forest.pick(o, d) || pickProp(o, d)) return;
    const hp = rayTerrain(o, d);
    if (hp) { const it = library.find(l => l.id === activeLib); if (it) { dirty.prop = { item: it, x: hp.x, z: hp.z }; pendingAt = performance.now(); } }
  });
  canvas.addEventListener('pointerleave', () => { if (!stroke) cursor.visible = false; });

  $('selNone').onclick = () => { selected = null; selProp = null; forest.select(null); syncUI(); };
  $('selDel').onclick = () => {
    if (selProp) { dropProp(selProp); syncUI(); expInfo(); E.markShadows(); toast('Модель удалена'); return; }
    if (!selected || forest.trees.length <= 1) { toast('Последнее дерево удалить нельзя', 'warn'); return; }
    forest.drop(selected); selected = null; forest.select(null);
    P.treeCount = forest.trees.length; syncUI(); E.markShadows();
  };
  $('selDup').onclick = () => {
    const a = Math.random() * TAU;
    if (selProp) {
      const it = { name: selProp.name, kind: selProp.kind, params: Object.assign({}, selProp.params) };
      dirty.prop = { item: it, x: selProp.x + Math.cos(a) * 3, z: selProp.z + Math.sin(a) * 3 };
    } else if (selected) {
      const it = { name: 'Дерево', kind: 'tree', params: Object.assign({}, selected.p) };
      dirty.prop = { item: it, x: selected.x + Math.cos(a) * Math.max(4, selected.p.height * .6), z: selected.z + Math.sin(a) * 4 };
    } else return;
    pendingAt = performance.now(); $('growChip').classList.add('show');
  };
  $('selAll').onclick = () => { if (!selected) return; for (const k of TREE_KEYS) P[k] = selected.p[k]; selected = null; forest.select(null); syncUI(); queue('all'); toast('Применено ко всему лесу'); };
  const rotSel = dir => {
    if (selProp) { selProp.inst.group.rotation.y += dir * .26; E.markShadows(); }
    else if (selected) { selected.group.rotation.y += dir * .26; E.markShadows(); }
    buzz('LIGHT');
  };
  const scaleSel = f => {
    if (selProp) { selProp.scale = clamp(selProp.scale * f, .2, 4); selProp.inst.group.scale.setScalar(selProp.scale); E.markShadows(); toast('Масштаб ' + selProp.scale.toFixed(2)); }
    else if (selected) { selected.p.height = clamp(selected.p.height * f, 4, 30); dirty.one = selected; pendingAt = performance.now(); syncUI(); }
    buzz('LIGHT');
  };
  $('selRotL').onclick = () => rotSel(-1); $('selRotR').onclick = () => rotSel(1);
  $('selSm').onclick = () => scaleSel(1 / 1.15); $('selBg').onclick = () => scaleSel(1.15);

  /* --- экран --- */
  let toastTimer = 0;
  function toast(m, k) { const t = $('toast'); t.textContent = m; t.className = 'ov show' + (k ? ' ' + k : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }
  function resizeSoon() { requestAnimationFrame(() => E.resize()); setTimeout(() => E.resize(), 280); }
  function setEdit(on) {
    edit = on && MODE === 'world';
    document.body.classList.toggle('edit', edit);
    if (!edit) { endStroke(); cursor.visible = false; }
    buildTools(); buildBrushBar(); syncUI();
    if (edit) toast('Редактор: ' + TOOLS.find(t => t.k === tool).n + ' · веди пальцем по земле');
  }
  function setViewer(on) {
    document.body.classList.toggle('viewer', on);
    $('btnViewer').textContent = on ? '⤡' : '⤢'; $('btnViewer').classList.toggle('on', on);
    if (!on) setClean(false);
    if (on) $('hud').classList.add('collapsed');
    buzz('MEDIUM'); Sound.tick(on ? 880 : 440); resizeSoon();
  }
  function setClean(on) {
    clean = on;
    if (on) { endStroke(); dragObj = null; ptrs.clear(); gesture = null; canvas.classList.remove('brushing', 'grabtree'); document.body.classList.add('viewer'); }
    document.body.classList.toggle('clean', on);
    cursor.visible = false;
    buildTools(); buildBrushBar();
    if (on) toast('Чистый просмотр · ◱ вернуть интерфейс');
    resizeSoon();
  }
  $('btnEdit').onclick = () => { setEdit(!edit); Sound.tick(edit ? 820 : 440); buzz('MEDIUM'); };
  $('btnClean').onclick = () => { setClean(true); buzz('MEDIUM'); };
  $('cleanExit').onclick = () => { setClean(false); buzz('LIGHT'); Sound.tick(520); };
  $('btnViewer').onclick = () => setViewer(!document.body.classList.contains('viewer'));
  $('hudToggle').onclick = () => { const c = $('hud').classList.toggle('collapsed'); $('hudToggle').setAttribute('aria-expanded', String(!c)); Sound.tick(600); };
  $('btnCam').onclick = () => { E.resetCamera(); P.focusX = 0; P.focusZ = 0; toast('Камера сброшена'); };
  $('btnWire').onclick = () => { P.wireframe = !P.wireframe; syncUI(); applyLive(); Sound.tick(600); };
  $('btnDice2').onclick = () => MODE === 'world' ? randomWorld() : randomModel();
  function reseed(d) {
    P.seed = Math.max(1, P.seed + d); selected = null; selProp = null; forest.select(null);
    if (MODE === 'world') queue('terrain'); else if (MODE === 'human') queue('human'); else queue('arch');
    syncUI(); Sound.tick(560); buzz('LIGHT');
  }
  function randomWorld() {
    P.seed = 1 + ((Math.random() * 99999) | 0);
    P.relief = Math.round(clamp(P.relief * (.7 + Math.random() * .8), 0, 40) * 2) / 2;
    P.tscale = Math.round(clamp(P.tscale * (.75 + Math.random() * .6), 20, 400) / 5) * 5;
    P.riverMeander = Math.round(Math.random() * 100) / 100;
    P.riverOffset = Math.round((Math.random() - .5) * 120);
    P.waterLevel = Math.round(clamp(-P.relief * (.2 + Math.random() * .35), -20, 12) * 5) / 5;
    selected = null; selProp = null; forest.select(null);
    syncUI(); applyLive(); queue('terrain'); Sound.tick(880); buzz('MEDIUM'); toast('Новый мир · seed ' + P.seed);
  }
  function randomModel() {
    const r = Math.random;
    P.seed = 1 + ((r() * 99999) | 0);
    if (MODE === 'human') {
      P.hHeight = Math.round(155 + r() * 45); P.hFemale = Math.round(r() * 100) / 100;
      P.hBuild = Math.round(r() * 80) / 100; P.hMuscle = Math.round(r() * 90) / 100;
      P.hShoulders = Math.round((.85 + r() * .5) * 100) / 100; P.hHips = Math.round((.85 + r() * .5) * 100) / 100;
      P.hWaist = Math.round((.75 + r() * .6) * 100) / 100; P.hBelly = Math.round(r() * 50) / 100;
      P.hSkin = ['#f0c9a5', '#c98d63', '#8d5a3b', '#5c3a26', '#e2b08a'][(r() * 5) | 0];
      P.hIris = ['#5b7f9a', '#4a6b3a', '#6b4a2a', '#3a3a44'][(r() * 4) | 0];
      P.hLongHair = Math.round(r() * 100) / 100;
      queue('human');
    } else {
      P.bType = ['house', 'izba', 'tower', 'ruin'][(r() * 4) | 0];
      P.bWidth = Math.round((5 + r() * 14) * 2) / 2; P.bDepth = Math.round((5 + r() * 12) * 2) / 2;
      P.bFloors = 1 + ((r() * 4) | 0); P.bRoofType = ['gable', 'hip', 'flat', 'cone'][(r() * 4) | 0];
      P.bRoofH = Math.round((1 + r() * 4) * 10) / 10; P.bWindows = 1 + ((r() * 5) | 0);
      queue('arch');
    }
    syncUI(); Sound.tick(880); buzz('MEDIUM');
  }
  function resetAll() {
    Object.assign(P, DEFAULTS); if (isMobile) trim();
    Q = QUALITY[P.quality]; E.setQuality(Q);
    selected = null; selProp = null; forest.select(null);
    while (forest.trees.length) forest.drop(forest.trees[0]);
    while (props.length) dropProp(props[0]);
    undoStack.length = 0;
    buildUI(); applyLive(); queue('bark'); queue('terrain'); queue('human'); queue('arch');
    E.resetCamera(); toast('Сброс выполнен');
  }
  async function shot() {
    const g = U.grow.value; U.grow.value = 1; E.render(performance.now(), P);
    let data; try { data = E.renderer.domElement.toDataURL('image/png'); } catch (e) { U.grow.value = g; toast('Кадр недоступен', 'warn'); return; }
    U.grow.value = g;
    try { const m = await saveArtifact({ filename: `drevo-${MODE}-${P.seed}.png`, base64: data.split(',')[1], mime: 'image/png', title: 'Кадр' }); if (m) toast(m); }
    catch (e) { toast('Не сохранилось: ' + e.message, 'err'); }
  }
  let exporting = false;
  async function doExport(mode) {
    if (exporting) { toast('Экспорт уже идёт…', 'warn'); return; }
    exporting = true;
    let parts;
    try { parts = collectParts(mode); } catch (e) { exporting = false; console.error(e); toast('Сбор не удался: ' + e.message, 'err'); return; }
    if (!parts.length) { exporting = false; toast('Нечего экспортировать', 'warn'); return; }
    const s = partsStats(parts), f = $('expFormat') ? $('expFormat').value : 'glb';
    toast('Собираю ' + fmt(s.tris) + ' трис…'); $('growChip').classList.add('show');
    await new Promise(r => setTimeout(r, 50));
    try {
      let res;
      if (f === 'obj') {
        $('growText').textContent = 'OBJ'; $('growPct').textContent = '';
        res = await saveArtifact({ filename: `drevo-${mode}-${P.seed}.obj`, text: toOBJ(parts, `seed ${P.seed}`), mime: 'text/plain', title: 'Модель OBJ', onProgress: p => { $('growPct').textContent = Math.round(p * 100) + '%'; } });
      } else {
        const blob = await toGLB(parts, `DREVO seed ${P.seed}`, (p, n) => { $('growText').textContent = 'GLB: ' + n; $('growPct').textContent = Math.round(p * 100) + '%'; });
        $('growText').textContent = 'кодирование'; $('growPct').textContent = '';
        const b64 = await blobToBase64(blob);
        res = await saveArtifact({ filename: `drevo-${mode}-${P.seed}.glb`, base64: b64, blob, mime: 'model/gltf-binary', title: 'Модель GLB', onProgress: p => { $('growText').textContent = 'запись'; $('growPct').textContent = Math.round(p * 100) + '%'; } });
        if (res) res += ' · ' + (blob.size / 1048576).toFixed(1) + ' МБ';
      }
      if (res) { toast(res); buzz('MEDIUM'); Sound.tick(900); }
    } catch (e) { console.error(e); toast('Экспорт не удался: ' + e.message, 'err'); }
    $('growChip').classList.remove('show'); exporting = false;
  }
  const sb = $('soundBtn');
  sb.onclick = () => { Sound.resume(); Sound.setOn(!Sound.on); sb.classList.toggle('on', Sound.on); sb.classList.toggle('off', !Sound.on); sb.setAttribute('aria-pressed', String(Sound.on)); sb.querySelector('.txt').textContent = Sound.on ? 'ЗВУК' : 'ТИХО'; buzz('LIGHT'); };
  addEventListener('pointerdown', () => Sound.resume(), { once: true });
  addEventListener('keydown', e => {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (clean) setClean(false); else if (document.body.classList.contains('viewer')) setViewer(false); else if (edit) setEdit(false); else { selected = null; selProp = null; forest.select(null); syncUI(); } }
    else if (k === 'e') setEdit(!edit);
    else if (k === 'f') setViewer(!document.body.classList.contains('viewer'));
    else if (k === 'c') setClean(!clean);
    else if (k === 'h') $('hudToggle').click();
    else if (k === 'r') $('btnDice2').click();
    else if (k === 'w') $('btnWire').click();
    else if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    else if (k === 'delete') $('selDel').click();
    else if (k === ' ') { e.preventDefault(); P.autoRotate = !P.autoRotate; syncUI(); }
    else if (k >= '1' && k <= '9') { const t = TOOLS[+k - 1]; if (t) { setEdit(true); tool = t.k; buildTools(); buildBrushBar(); } }
    else if (k === 'arrowleft') E.cam.tTheta -= .12;
    else if (k === 'arrowright') E.cam.tTheta += .12;
    else if (k === 'arrowup') E.cam.tPhi = clamp(E.cam.tPhi - .08, .06, 1.53);
    else if (k === 'arrowdown') E.cam.tPhi = clamp(E.cam.tPhi + .08, .06, 1.53);
  });
  E.hooks.interact = () => { Sound.resume(); $('hint').classList.add('gone'); };
  E.hooks.zoom = v => { P.dist = Math.round(v * 10) / 10; syncKey('dist'); };
  if (!isMobile) $('hintText').textContent = 'РЕДАКТОР — кисти · 1…9 инструменты · Ctrl+Z отмена · C чистый вид';

  /* --- цикл --- */
  let growT = 1, last = performance.now(), fpsAcc = 0, fpsN = 0, msAcc = 0, hudAt = 0, booted = false, rafId = 0, running = false, badge = 0, paintAt = 0;
  const gustBars = [...$('gust').children];
  const camProxy = Object.assign({}, P);
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (stroke && !stroke.stamp) {
      applyBrush(dt);
      if (tool === 'paint' && now - paintAt > 60) { land.flushPaint(); paintAt = now; }
    }
    land.tickWater();
    const pending = dirty.all || dirty.one || dirty.terrain || dirty.veg || dirty.bark || dirty.human || dirty.arch || dirty.grid || dirty.paint || dirty.prop;
    if (!job && pending && now - pendingAt > 130 && !stroke) { job = combined(); U.grow.value = 0; growT = 0; E.key.castShadow = false; }
    if (job) {
      const t0 = performance.now(); let r;
      try { do { r = job.next(); } while (!r.done && performance.now() - t0 < 6); }
      catch (err) { console.error(err); job = null; for (const k in dirty) dirty[k] = (k === 'one' || k === 'prop') ? null : false; toast('Ошибка: ' + err.message, 'err'); }
      if (job && r && !r.done && r.value) { $('growText').textContent = r.value.label || 'генерация'; $('growPct').textContent = Math.round((r.value.p || 0) * 100) + '%'; }
      if (job && r && r.done) { job = null; applyLive(); Sound.rustle(); E.markShadows(); expInfo(); }
    }
    if (growT < 1) { growT = Math.min(1, growT + dt / 1.4); U.grow.value = 1 - Math.pow(1 - growT, 3);
      if (growT >= 1) { $('growChip').classList.remove('show'); E.key.castShadow = true; E.markShadows(); } }
    U.time.value = now * .001;
    Object.assign(camProxy, P); camProxy.height = viewHeight();
    E.updateCamera(dt, now, camProxy, focusY(), reduceMotion);
    if (forest.ring.visible) forest.ring.material.opacity = .55 + .35 * Math.sin(now * .004);
    if (cursor.visible) cursor.material.opacity = stroke ? .95 : .55;
    const t0 = performance.now(); E.render(now, P); msAcc += performance.now() - t0;
    fpsAcc += dt; fpsN++;
    const tt = forest.totals();
    let propTris = 0; for (const p of props) propTris += p.inst.stats.tris || 0;
    const shown = MODE === 'world' ? tt.woodTris + tt.leafTris + land.stats.tris + land.stats.grass * 5 + land.stats.flowers * 4 + land.stats.rocks * 80 + propTris
      : MODE === 'human' ? human.stats.tris : building.stats.tris;
    badge += (shown - badge) * Math.min(1, dt * 6);
    $('triNum').textContent = fmt(badge);
    if (now - hudAt > 240) {
      const fps = fpsN / Math.max(.001, fpsAcc), el = $('mFps');
      el.textContent = fps.toFixed(0);
      el.style.color = fps > 50 ? 'var(--ok)' : fps > 28 ? 'var(--warn)' : 'var(--danger)';
      $('mMs').textContent = (msAcc / fpsN).toFixed(1) + ' мс';
      $('mTris').textContent = fmt(E.renderer.info.render.triangles);
      $('mCalls').textContent = E.renderer.info.render.calls;
      if (MODE === 'world') {
        $('lA').textContent = 'деревьев / моделей'; $('mA').textContent = forest.trees.length + ' / ' + props.length;
        $('lB').textContent = 'сетка земли'; $('mB').textContent = land.N + '×' + land.N;
        $('lC').textContent = 'листьев'; $('mC').textContent = fmt(tt.leaves);
        $('lD').textContent = 'травы / цветов'; $('mD').textContent = fmt(land.stats.grass) + ' / ' + fmt(land.stats.flowers);
        $('lE').textContent = 'вода'; $('mE').textContent = P.water ? land.stats.water + '% участка' : 'выкл';
        $('mGen').textContent = (tt.ms + land.stats.ms).toFixed(0) + ' мс';
      } else {
        const s = MODE === 'human' ? human.stats : building.stats;
        $('lA').textContent = 'рост / высота'; $('mA').textContent = s.height.toFixed(2) + ' м';
        $('lB').textContent = 'вершин'; $('mB').textContent = fmt(s.verts);
        $('lC').textContent = 'треугольников'; $('mC').textContent = fmt(s.tris);
        $('lD').textContent = 'сегментов'; $('mD').textContent = MODE === 'human' ? Math.round(P.hDetail) : Math.round(P.bFloors) + ' эт.';
        $('lE').textContent = 'сид'; $('mE').textContent = P.seed;
        $('mGen').textContent = s.ms.toFixed(0) + ' мс';
      }
      $('mBrush').textContent = edit ? TOOLS.find(t => t.k === tool).n + ' · ' + P.brushRadius.toFixed(1) + ' м' : 'выключен';
      $('hudMini').textContent = fps.toFixed(0) + ' fps · ' + fmt(shown) + ' трис';
      const gust = .55 + .45 * Math.sin(now * .00031);
      for (let i = 0; i < gustBars.length; i++) gustBars[i].style.height = (18 + Math.abs(Math.sin(now * .002 + i * .7)) * 82 * P.wind * gust).toFixed(0) + '%';
      hudAt = now; fpsAcc = 0; fpsN = 0; msAcc = 0;
    }
    if (!booted) { booted = true; $('boot').classList.add('hide'); setTimeout(() => { const b = $('boot'); if (b) b.style.display = 'none'; }, 700); }
  }
  function startLoop() { if (running) return; running = true; last = performance.now(); rafId = requestAnimationFrame(frame); }
  function stopLoop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; Sound.brush(false); }
  let rp = false;
  new ResizeObserver(() => { if (rp) return; rp = true; requestAnimationFrame(() => { rp = false; E.resize(); }); }).observe(stage);
  addEventListener('orientationchange', () => setTimeout(() => E.resize(), 250));
  E.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); stopLoop(); toast('Контекст WebGL потерян — перезапусти приложение', 'err'); });
  E.renderer.domElement.addEventListener('webglcontextrestored', () => { E.resize(); E.markShadows(); startLoop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); } else { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); } });
  initNative({
    onBack: exit => { if (clean) setClean(false); else if (edit) setEdit(false); else if (document.body.classList.contains('viewer')) setViewer(false); else if (selected || selProp) { selected = null; selProp = null; forest.select(null); syncUI(); } else exit(); },
    onActive: () => { startLoop(); if (Sound.ctx && Sound.on) Sound.ctx.resume(); },
    onInactive: () => { stopLoop(); if (Sound.ctx) Sound.ctx.suspend(); }
  });

  water = { mesh: null };
  land.build; // grid строится в первом задании
  buildUI(); E.resize(); applyLive();
  queue('terrain'); queue('human'); queue('arch');
  startLoop();
  setTimeout(() => $('hint').classList.add('gone'), 12000);
}
