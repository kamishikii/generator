import * as THREE from 'three';
import { clamp, lerp, TAU, mulberry32, makeNoise3D, fbm, ridged } from './noise.js';
import { windify } from './engine.js';
import { leafTexture, leafScan } from './textures.js';

class Hash {
  constructor(c) { this.inv = 1 / c; this.m = new Map(); }
  insert(o) {
    const k = ((Math.floor(o.x * this.inv) + 512) << 20) | ((Math.floor(o.y * this.inv) + 512) << 10) | (Math.floor(o.z * this.inv) + 512);
    let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); } a.push(o);
  }
  near(x, y, z, cb) {
    const cx = Math.floor(x * this.inv), cy = Math.floor(y * this.inv), cz = Math.floor(z * this.inv);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const a = this.m.get(((cx + i + 512) << 20) | ((cy + j + 512) << 10) | (cz + k + 512));
      if (a) for (let n = 0; n < a.length; n++) cb(a[n]);
    }
  }
}
const envelope = P => {
  const H = P.height;
  if (P.shape === 'cone') return { y0: .20 * H, y1: 1.02 * H, r: .30 * H };
  if (P.shape === 'umbrella') return { y0: .70 * H, y1: 1.00 * H, r: .52 * H };
  if (P.shape === 'column') return { y0: .25 * H, y1: 1.05 * H, r: .16 * H };
  return { y0: .40 * H, y1: 1.02 * H, r: .42 * H };
};
export const TREE_KEYS = ['height', 'trunk', 'crown', 'detail', 'chaos', 'droop', 'shape', 'barkDepth', 'moss', 'roots', 'barkColor', 'leaves', 'leafSize', 'leafShape', 'leafColor', 'leafVar', 'litter'];

export function createForest(U, barkTex, mobile) {
  const group = new THREE.Group();
  const barkMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: barkTex.map, normalMap: barkTex.normalMap, roughnessMap: barkTex.roughnessMap,
    normalScale: new THREE.Vector2(1.5, 1.5), roughness: 1, metalness: 0, vertexColors: true, dithering: true
  }), U, { key: 'bark', base: 'object', height: 'ref', ref: 12 });
  const twigLeafMat = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 1, metalness: 0 });
  const kinds = ['cluster', 'broad', 'needle', 'bloom'];
  const leafTex = {}, leafMats = {};
  for (const k of kinds) {
    leafTex[k] = (k === 'cluster' || k === 'broad') ? leafScan(mobile ? 256 : 512) : leafTexture(k, mobile ? 160 : 256);
    leafMats[k] = windify(new THREE.MeshStandardMaterial({ map: leafTex[k], alphaTest: .42, side: THREE.DoubleSide, roughness: .66, metalness: 0 }),
      U, { key: 'leaf' + k, base: 'object', height: 'ref', ref: 12, flutter: .05, backlight: true });
  }
  new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'tex/leaf_nor.png', nt => {
    nt.colorSpace = THREE.NoColorSpace;
    nt.wrapS = nt.wrapT = THREE.ClampToEdgeWrapping;
    for (const k of ['cluster', 'broad']) {
      leafMats[k].normalMap = nt;
      leafMats[k].normalScale = new THREE.Vector2(.7, .7);
      leafMats[k].needsUpdate = true;
    }
  }, undefined, () => {});
  const litterMat = windify(new THREE.MeshStandardMaterial({ map: leafTex.broad, alphaTest: .42, side: THREE.DoubleSide, roughness: .9, metalness: 0 }),
    U, { key: 'litter', base: 'object', height: 'ref', ref: 3, flutter: 0 });
  const leafGeo = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, .07 * Math.cos(p.getY(i) * Math.PI));
    g.translate(0, .5, 0); g.computeVertexNormals(); return g;
  })();
  const jointGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    return g;
  })();
  const UPV = new THREE.Vector3(0, 1, 0);
  const skelMat = new THREE.LineBasicMaterial({ color: 0x9ef01a, transparent: true, opacity: .5 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9ef01a, transparent: true, opacity: .85, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1.05, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 4; group.add(ring);

  const trees = [];
  let nextId = 1;
  function newTree(p, x, z, jitter) {
    const t = { id: nextId++, p: Object.assign({}, p), jitter: jitter || { h: 1, t: 1, c: 1, ch: 0, hue: 0 }, x, z, baseY: 0, height: p.height, crownR: 3, group: new THREE.Group(), wood: null, leaves: null, litter: null, joints: null, twigs: null, skel: null, stats: { nodes: 0, branches: 0, woodTris: 0, leafTris: 0, leaves: 0, seg: 0, auto: false, ms: 0 } };
    t.group.position.set(x, 0, z);
    group.add(t.group); trees.push(t); return t;
  }
  function drop(t) {
    const i = trees.indexOf(t); if (i < 0) return;
    disposeTree(t); group.remove(t.group); trees.splice(i, 1);
  }
  function disposeTree(t) {
    for (const m of [t.wood, t.leaves, t.litter, t.joints, t.twigs, t.skel]) {
      if (!m) continue;
      t.group.remove(m); if (m.isInstancedMesh) m.dispose(); if (m.geometry && m.geometry !== jointGeo) m.geometry.dispose();
    }
    t.wood = t.leaves = t.litter = t.joints = t.twigs = t.skel = null;
  }
  function select(t) {
    ring.visible = !!t;
    if (t) { ring.position.set(t.x, t.baseY + .06, t.z); const s = Math.max(1.4, t.p.trunk * 3.2); ring.scale.set(s, s, s); }
  }
  function move(t, x, z, y) { t.x = x; t.z = z; t.baseY = y; t.group.position.set(x, y, z); if (ring.visible) select(t); }
  function makeNoise32(seed) { return makeNoise3D(seed); }
  function Pseed(t) { return (t.p.seed || 1) * 31 + t.id * 101; }

  function* build(t, Q, groundAt, waterY) {
    const t0 = performance.now();
    const rng = mulberry32(Pseed(t) >>> 0);
    const P = Object.assign({}, t.p);
    P.height = t.p.height * (.86 + rng() * .28);
    P.trunk = t.p.trunk * (.85 + rng() * .3);
    P.chaos = clamp(t.p.chaos + (rng() - .5) * .34, 0, 1);
    P.droop = t.p.droop + (rng() - .5) * .22;
    P.crown = Math.round(t.p.crown * (.8 + rng() * .45));
    const noise = makeNoise32((t.p.seed || 1) * 7919 + 13);
    const H = P.height, env = envelope(P), trunkR = Math.min(P.trunk, H * .10);
    const want = H * lerp(.055, .010, P.detail);
    const kk = 30 + P.crown / 120;
    const seg = Math.max(want * .7, kk * H / (Q.maxNodes * 1.6));
    t.stats.seg = seg; t.stats.auto = seg > want * 1.02;
    const di = Math.max(seg * 4.2, env.r * .22), dk = seg * 1.55;

    const pts = [], N = Math.round(P.crown);
    if (P.shape === 'cone') {
      for (let i = 0; i < N; i++) {
        const y = lerp(env.y0, env.y1, Math.pow(rng(), .75));
        const rr = env.r * Math.pow(1 - (y - env.y0) / (env.y1 - env.y0), .8) * (.5 + .5 * rng()), a = rng() * TAU;
        pts.push({ x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, active: true });
      }
    } else if (P.shape === 'umbrella') {
      for (let i = 0; i < N; i++) {
        const a = rng() * TAU, rr = env.r * Math.sqrt(rng());
        pts.push({ x: Math.cos(a) * rr, y: Math.max(env.y0, env.y1 - .22 * H * Math.pow(rr / env.r, 1.7) + (rng() - .5) * H * .06), z: Math.sin(a) * rr, active: true });
      }
    } else {
      const cy = (env.y0 + env.y1) * .5, ry = (env.y1 - env.y0) * .5, lobes = [];
      for (let i = 0; i < (P.shape === 'column' ? 3 : 6); i++) {
        const a = rng() * TAU;
        lobes.push({ x: Math.cos(a) * env.r * .5 * rng(), y: cy + (rng() - .5) * ry, z: Math.sin(a) * env.r * .5 * rng(), s: .5 + rng() * .45 });
      }
      let guard = 0;
      while (pts.length < N && guard < N * 16) {
        guard++;
        const L = lobes[(rng() * lobes.length) | 0];
        const u = rng() * 2 - 1, a = rng() * TAU, r = Math.cbrt(rng()), s = Math.sqrt(Math.max(0, 1 - u * u));
        const x = L.x + Math.cos(a) * s * r * env.r * L.s, y = L.y + u * r * ry * L.s, z = L.z + Math.sin(a) * s * r * env.r * L.s;
        if (y < env.y0 * .92) continue;
        if (fbm(noise, x * .3, y * .3, z * .3, 3) < -.18 && rng() < .6) continue;
        pts.push({ x, y, z, active: true });
      }
    }
    yield { p: .05, label: 'крона #' + t.id };

    const list = [];
    const mk = (x, y, z, parent) => {
      const n = { x, y, z, parent, children: [], r: 0, dist: parent ? parent.dist + Math.hypot(x - parent.x, y - parent.y, z - parent.z) : 0, order: parent ? parent.order + 1 : 0, ax: 0, ay: 0, az: 0, cnt: 0, grow: 0 };
      list.push(n); if (parent) parent.children.push(n); return n;
    };
    const seedTop = env.y0 + (env.y1 - env.y0) * .12;
    let cur = mk(0, 0, 0, null);
    const steps = Math.max(3, Math.round(seedTop / seg));
    for (let i = 1; i <= steps; i++) {
      const s = i / steps, bend = P.chaos * .3;
      cur = mk(Math.sin(s * 2.1) * bend * H * .05 + (rng() - .5) * seg * .18, seedTop * s, Math.cos(s * 1.7) * bend * H * .04 + (rng() - .5) * seg * .18, cur);
    }
    const nh = new Hash(di); for (const n of list) nh.insert(n);
    const ph = new Hash(dk); for (const p of pts) ph.insert(p);
    const di2 = di * di, dk2 = dk * dk;
    let active = pts.length;
    for (let iter = 0; iter < 520; iter++) {
      for (let i = 0; i < list.length; i++) { const n = list[i]; n.ax = n.ay = n.az = n.cnt = 0; }
      let any = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; if (!p.active) continue;
        let best = null, bd = di2;
        nh.near(p.x, p.y, p.z, n => { const dx = p.x - n.x, dy = p.y - n.y, dz = p.z - n.z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = n; } });
        if (best) { const dx = p.x - best.x, dy = p.y - best.y, dz = p.z - best.z, l = Math.hypot(dx, dy, dz) || 1; best.ax += dx / l; best.ay += dy / l; best.az += dz / l; best.cnt++; any = true; }
      }
      const fresh = [];
      if (!any) {
        let tip = list[0]; for (const n of list) if (n.y > tip.y) tip = n;
        let bp = null, bd = Infinity;
        for (const p of pts) { if (!p.active) continue; const d = (p.x - tip.x) ** 2 + (p.y - tip.y) ** 2 + (p.z - tip.z) ** 2; if (d < bd) { bd = d; bp = p; } }
        if (!bp) break;
        const dx = bp.x - tip.x, dy = bp.y - tip.y + seg * .25, dz = bp.z - tip.z, l = Math.hypot(dx, dy, dz) || 1;
        const c = mk(tip.x + dx / l * seg, Math.max(.04, tip.y + dy / l * seg), tip.z + dz / l * seg, tip);
        nh.insert(c); fresh.push(c);
      } else {
        for (let i = 0, len = list.length; i < len; i++) {
          const n = list[i]; if (!n.cnt) continue;
          let dx = n.ax / n.cnt, dy = n.ay / n.cnt, dz = n.az / n.cnt;
          dy += P.droop * (n.order > 2 ? .55 : .10) + .06;
          dx += (rng() - .5) * P.chaos * .85; dy += (rng() - .5) * P.chaos * .45; dz += (rng() - .5) * P.chaos * .85;
          const l = Math.hypot(dx, dy, dz) || 1;
          const c = mk(n.x + dx / l * seg, Math.max(.04, n.y + dy / l * seg), n.z + dz / l * seg, n);
          nh.insert(c); fresh.push(c);
        }
      }
      for (const f of fresh) ph.near(f.x, f.y, f.z, p => { if (p.active && (p.x - f.x) ** 2 + (p.y - f.y) ** 2 + (p.z - f.z) ** 2 < dk2) { p.active = false; active--; } });
      if (iter % 10 === 0) yield { p: .05 + .42 * Math.min(1, iter / 220), label: 'рост #' + t.id };
      if (list.length >= Q.maxNodes * 1.6 || active <= 0) break;
    }
    const EXP = 2.35, tipR = .022 * Math.max(.6, H / 13);
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (!n.children.length) n.r = tipR;
      else { let s = 0; for (const c of n.children) s += Math.pow(c.r, EXP); n.r = Math.pow(s, 1 / EXP); }
      n.r = Math.max(n.r, tipR * .55);
    }
    const f = trunkR / list[0].r; let maxD = 0;
    for (const n of list) { n.r *= f; if (n.y < 1.4) n.r *= 1 + (.55 + P.roots * .9) * Math.exp(-n.y / .45); if (n.dist > maxD) maxD = n.dist; }
    for (const n of list) n.grow = maxD > 0 ? n.dist / maxD : 0;
    yield { p: .5, label: 'радиусы #' + t.id };

    const paths = [];
    const walk = (first, inc) => {
      const chain = inc ? [inc, first] : [first];
      let c = first;
      while (c.children.length === 1) { c = c.children[0]; chain.push(c); }
      paths.push({ nodes: chain, fork: !!inc });
      for (const ch of c.children) walk(ch, c);
    };
    walk(list[0], null);
    const gx = t.x, gz = t.z, baseY = groundAt(gx, gz);
    const nR = 5 + Math.round(P.roots * 5);
    for (let i = 0; i < nR; i++) {
      const a = i / nR * TAU + rng() * .5, R = trunkR * (1.6 + P.roots * 1.4);
      const x1 = Math.cos(a) * R * .55, z1 = Math.sin(a) * R * .55, x2 = Math.cos(a) * R, z2 = Math.sin(a) * R;
      paths.push({ fork: true, nodes: [
        { x: 0, y: .3, z: 0, r: trunkR * .62, dist: .05, grow: .004, children: [1] },
        { x: x1, y: groundAt(gx + x1, gz + z1) - baseY + .06, z: z1, r: trunkR * .40, dist: R * .8, grow: .02, children: [1] },
        { x: x2, y: groundAt(gx + x2, gz + z2) - baseY - .22, z: z2, r: trunkR * .16, dist: R * 1.6, grow: .03, children: [] }] });
    }
    const pos = [], nor = [], uv = [], gr = [], col = [], idx = [];
    const T = new THREE.Vector3(), Nv = new THREE.Vector3(), B = new THREE.Vector3(), pT = new THREE.Vector3(), ax = new THREE.Vector3();
    const bc = new THREE.Color(P.barkColor);
    for (let pi = 0; pi < paths.length; pi++) {
      const chain = paths[pi].nodes; if (chain.length < 2) continue;
      const r0 = chain[0].r;
      const radial = Math.max(7, Math.min(24, Math.round(Q.radial * clamp(r0 / .22, .5, 1.4))));
      T.set(chain[1].x - chain[0].x, chain[1].y - chain[0].y, chain[1].z - chain[0].z).normalize();
      Nv.set(0, 1, 0); if (Math.abs(T.dot(Nv)) > .9) Nv.set(1, 0, 0);
      Nv.crossVectors(T, Nv).normalize(); pT.copy(T);
      const base = pos.length / 3, stride = radial + 1, uS = TAU * r0 / 2.2;
      for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        if (i === 0) T.set(chain[1].x - c.x, chain[1].y - c.y, chain[1].z - c.z);
        else if (i === chain.length - 1) T.set(c.x - chain[i - 1].x, c.y - chain[i - 1].y, c.z - chain[i - 1].z);
        else T.set(chain[i + 1].x - chain[i - 1].x, chain[i + 1].y - chain[i - 1].y, chain[i + 1].z - chain[i - 1].z);
        if (T.lengthSq() < 1e-10) T.copy(pT);
        T.normalize();
        if (i > 0) {
          ax.crossVectors(pT, T); const l = ax.length();
          if (l > 1e-6) { ax.divideScalar(l); Nv.applyAxisAngle(ax, Math.acos(clamp(pT.dot(T), -1, 1))); }
          Nv.addScaledVector(T, -Nv.dot(T));
          if (Nv.lengthSq() < 1e-8) Nv.set(1, 0, 0).addScaledVector(T, -T.x);
          Nv.normalize(); pT.copy(T);
        }
        B.crossVectors(T, Nv).normalize();
        let rr0 = c.r;
        if (paths[pi].fork && i > 0 && i < 3) rr0 *= 1 + (3 - i) * .13;
        if (i < chain.length - 1) rr0 = Math.max(rr0, chain[i + 1].r * .98);
        const furAmp = P.barkDepth * .19 * clamp(r0 / .22, 0, 1);
        for (let j = 0; j <= radial; j++) {
          const a = j / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
          const fur = ridged(noise, ca * 1.7 + r0 * 4, sa * 1.7, c.dist * .85, 3) - .62;
          const flute = Math.sin(a * 5 + c.dist * .25) * .045 * clamp(r0 / .3, 0, 1);
          const rr = Math.max(.004, rr0 * (1 + furAmp * fur * 2 + flute));
          const nx = Nv.x * ca + B.x * sa, ny = Nv.y * ca + B.y * sa, nz = Nv.z * ca + B.z * sa;
          const px = c.x + nx * rr, py = c.y + ny * rr, pz = c.z + nz * rr;
          pos.push(px, py, pz); nor.push(nx, ny, nz);
          uv.push(j / radial * uS + t.id * .37, c.dist / 2.2); gr.push(c.grow);
          const mn = fbm(noise, px * .8, py * .6, pz * .8, 3) * .5 + .5;
          const m = clamp(mn * (1 - clamp(py / 2.8, 0, 1)) * (.45 + .55 * Math.max(0, -nz)), 0, 1) * P.moss;
          const mac = .82 + .36 * (fbm(noise, px * .12, py * .1, pz * .12, 2) * .5 + .5);
          col.push(bc.r * lerp(1, .38, m) * mac, bc.g * lerp(1, .58, m) * mac, bc.b * lerp(1, .30, m) * mac);
        }
      }
      for (let i = 0; i < chain.length - 1; i++) for (let j = 0; j < radial; j++) {
        const a = base + i * stride + j, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const last = chain[chain.length - 1];
      if (!last.children || !last.children.length) {
        const ti = pos.length / 3;
        pos.push(last.x + T.x * last.r * 1.7, last.y + T.y * last.r * 1.7, last.z + T.z * last.r * 1.7);
        nor.push(T.x, T.y, T.z); uv.push(.5, last.dist / 2.2 + .1); gr.push(Math.min(1, last.grow + .005)); col.push(bc.r, bc.g, bc.b);
        const rb = base + (chain.length - 1) * stride;
        for (let j = 0; j < radial; j++) idx.push(rb + j, rb + j + 1, ti);
      }
      if (pi % 20 === 0) yield { p: .5 + .26 * (pi / paths.length), label: 'кора #' + t.id };
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aGrow', new THREE.Float32BufferAttribute(gr, 1));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeBoundingSphere();
    yield { p: .78, label: 'сборка #' + t.id };

    const tips = list.filter(n => !n.children.length || (n.r < trunkR * .07 && n.order > 4));
    const want2 = Math.min(Math.round(P.leaves), Q.leafCap);
    let lm = null; let ltw = null;
    if (want2 > 0 && tips.length) {
      const lg = leafGeo.clone();
      lm = new THREE.InstancedMesh(lg, leafMats[P.leafShape] || leafMats.broad, want2);
      const lc = new Float32Array(want2 * 3), la = new Float32Array(want2);
      const d = new THREE.Object3D(), c = new THREE.Color(), dir = new THREE.Vector3();
      const bcol = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
      bcol.getHSL(hsl, THREE.SRGBColorSpace);
      const hs = H / 13, needle = P.leafShape === 'needle', cluster = P.leafShape === 'cluster';
      for (let i = 0; i < want2; i++) {
        const n = tips[(rng() * tips.length) | 0], pp = n.parent || n;
        dir.set(n.x - pp.x, n.y - pp.y, n.z - pp.z);
        if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0); else dir.normalize();
        d.position.set(n.x + (rng() - .5) * .06, n.y + (rng() - .5) * .06, n.z + (rng() - .5) * .06);
        d.quaternion.setFromUnitVectors(UPV, dir);
        d.rotateY(rng() * TAU);
        d.rotateX((rng() - .5) * .7);
        const sc = P.leafSize * hs * (.7 + rng() * .6) * (cluster ? .6 : .3);
        d.scale.set(sc * (needle ? .34 : 1), sc * (needle ? 1.75 : 1), sc);
        d.updateMatrix(); lm.setMatrixAt(i, d.matrix);
        const inner = clamp(1 - Math.hypot(n.x, n.z) / Math.max(1, env.r), 0, 1);
        c.setHSL((hsl.h + (rng() - .5) * .07 * P.leafVar + 1) % 1, clamp(hsl.s + (rng() - .5) * .32 * P.leafVar, 0, 1),
          clamp(hsl.l * (.78 + .5 * rng()) * (1 - .26 * inner), .04, .96), THREE.SRGBColorSpace);
        lc[i * 3] = c.r; lc[i * 3 + 1] = c.g; lc[i * 3 + 2] = c.b;
        la[i] = Math.min(1, n.grow + .012);
        if (i % 8000 === 0) yield { p: .78 + .16 * (i / want2), label: 'листва #' + t.id };
      }
      lg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(la, 1));
      lm.instanceColor = new THREE.InstancedBufferAttribute(lc, 3);
      lm.instanceMatrix.needsUpdate = true;
      lm.castShadow = true; lm.receiveShadow = true; lm.frustumCulled = false;
      const twg = new THREE.CylinderGeometry(.008, .016, 1, 4, 1, true);
      twg.translate(0, .5, 0);
      ltw = new THREE.InstancedMesh(twg, twigLeafMat, want2);
      const twm = new THREE.Matrix4(), twp = new THREE.Vector3(), twq = new THREE.Quaternion(), tws = new THREE.Vector3();
      for (let i = 0; i < want2; i++) {
        lm.getMatrixAt(i, twm);
        twm.decompose(twp, twq, tws);
        tws.set(tws.y * .05, tws.y * .95, tws.y * .05);
        twm.compose(twp, twq, tws);
        ltw.setMatrixAt(i, twm);
      }
      ltw.instanceMatrix.needsUpdate = true;
      ltw.castShadow = true; ltw.frustumCulled = false;
    }
    let lit = null;
    const nL = Math.round(P.litter || 0);
    if (nL > 0) {
      const gg = new THREE.PlaneGeometry(1, 1); gg.rotateX(-Math.PI / 2);
      lit = new THREE.InstancedMesh(gg, litterMat, nL);
      const lc = new Float32Array(nL * 3), la = new Float32Array(nL);
      const d = new THREE.Object3D(), c = new THREE.Color();
      const bcol = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
      bcol.getHSL(hsl, THREE.SRGBColorSpace);
      for (let i = 0; i < nL; i++) {
        const a = rng() * TAU, rr = Math.sqrt(rng()) * Math.max(3, H * .55);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        d.position.set(x, groundAt(gx + x, gz + z) - baseY + .03, z);
        d.rotation.set(0, rng() * TAU, 0);
        const s = .15 * (.7 + rng() * .8); d.scale.set(s, 1, s);
        d.updateMatrix(); lit.setMatrixAt(i, d.matrix);
        c.setHSL((hsl.h * .6 + .06 + rng() * .07) % 1, .5 + rng() * .3, .18 + rng() * .18, THREE.SRGBColorSpace);
        lc[i * 3] = c.r; lc[i * 3 + 1] = c.g; lc[i * 3 + 2] = c.b; la[i] = .99;
      }
      gg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(la, 1));
      lit.instanceColor = new THREE.InstancedBufferAttribute(lc, 3);
      lit.receiveShadow = true; lit.frustumCulled = false;
    }
    const joints = list.filter(n => n.children.length > 1);
    let jm = null;
    if (joints.length) {
      const jg = jointGeo.clone();
      const ja = new Float32Array(joints.length);
      jm = new THREE.InstancedMesh(jg, barkMat, joints.length);
      const jd = new THREE.Object3D(), jcol = new THREE.Color();
      for (let i = 0; i < joints.length; i++) {
        const n = joints[i];
        jd.position.set(n.x, n.y, n.z);
        const s = n.r * 1.22;
        jd.scale.set(s, s * .9, s);
        jd.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        jd.updateMatrix(); jm.setMatrixAt(i, jd.matrix);
        jcol.copy(bc).multiplyScalar(.85 + rng() * .3);
        jm.setColorAt(i, jcol);
        ja[i] = Math.min(1, n.grow + .012);
      }
      jg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(ja, 1));
      jm.instanceMatrix.needsUpdate = true;
      if (jm.instanceColor) jm.instanceColor.needsUpdate = true;
      jm.castShadow = true; jm.receiveShadow = true; jm.frustumCulled = false;
    }
    const sp = [];
    for (const n of list) if (n.parent) sp.push(n.parent.x, n.parent.y, n.parent.z, n.x, n.y, n.z);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));

    disposeTree(t);
    t.wood = new THREE.Mesh(geo, barkMat);
    t.wood.castShadow = true; t.wood.receiveShadow = true; t.wood.frustumCulled = false;
    t.group.add(t.wood);
    if (lm) { t.leaves = lm; t.group.add(lm); }
    if (ltw) { t.twigs = ltw; t.group.add(ltw); }
    if (lit) { t.litter = lit; t.group.add(lit); }
    if (jm) { t.joints = jm; t.group.add(jm); }
    t.skel = new THREE.LineSegments(sg, skelMat); t.skel.frustumCulled = false; t.group.add(t.skel);
    t.baseY = baseY; t.height = H; t.crownR = env.r;
    t.group.position.set(t.x, baseY, t.z);
    t.stats.nodes = list.length; t.stats.branches = paths.length;
    t.stats.woodTris = geo.index.count / 3;
    t.stats.leaves = lm ? lm.count : 0; t.stats.leafTris = t.stats.leaves * 4;
    t.stats.ms = performance.now() - t0;
    yield { p: 1, label: 'дерево #' + t.id + ' готово' };
    return t.stats;
  }

  function pick(o, d) {
    let best = null, bt = Infinity;
    for (const t of trees) {
      const spheres = [
        [t.x, t.baseY + t.height * .62, t.z, Math.max(t.crownR * .95, t.height * .3)],
        [t.x, t.baseY + t.height * .16, t.z, Math.max(t.p.trunk * 2.6, t.height * .13)]
      ];
      for (const [cx, cy, cz, r] of spheres) {
        const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
        const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - c; if (disc < 0) continue;
        const tt = -b - Math.sqrt(disc);
        if (tt > 0 && tt < bt) { bt = tt; best = t; }
      }
    }
    return best;
  }
  function totals() {
    let wood = 0, leaf = 0, nodes = 0, branches = 0, leaves = 0, seg = 0, auto = false, ms = 0;
    for (const t of trees) {
      wood += t.stats.woodTris; leaf += t.stats.leafTris; nodes += t.stats.nodes;
      branches += t.stats.branches; leaves += t.stats.leaves;
      seg = Math.max(seg, t.stats.seg); auto = auto || t.stats.auto; ms += t.stats.ms;
    }
    return { woodTris: wood, leafTris: leaf, nodes, branches, leaves, seg, auto, ms };
  }
  return {
    group, trees, newTree, drop, build, select, move, pick, totals, leafTex, leafMats, barkMat, litterMat, ring,
    setBark(t) { barkMat.map = t.map; barkMat.normalMap = t.normalMap; barkMat.roughnessMap = t.roughnessMap; barkMat.needsUpdate = true; },
    setWire(v) { barkMat.wireframe = v; for (const k in leafMats) leafMats[k].wireframe = v; litterMat.wireframe = v; },
    setSkeleton(v) { for (const t of trees) if (t.skel) t.skel.visible = v; }
  };
}
