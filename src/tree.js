import * as THREE from 'three';
import { clamp, lerp, TAU, mulberry32, makeNoise3D, fbm, ridged } from './noise.js';
import { windify } from './engine.js';
import { leafTexture } from './textures.js';

class Hash {
  constructor(cell) { this.inv = 1 / cell; this.m = new Map(); }
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

function envelope(P) {
  const H = P.height;
  switch (P.shape) {
    case 'cone': return { y0: .20 * H, y1: 1.02 * H, r: .30 * H };
    case 'umbrella': return { y0: .70 * H, y1: 1.00 * H, r: .52 * H };
    case 'column': return { y0: .25 * H, y1: 1.05 * H, r: .16 * H };
    default: return { y0: .40 * H, y1: 1.02 * H, r: .42 * H };
  }
}

export function createTreeSystem(U, barkTex, mobile) {
  const group = new THREE.Group();
  const barkMat = windify(new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6d5439'), map: barkTex.map, normalMap: barkTex.normalMap, roughnessMap: barkTex.roughnessMap,
    normalScale: new THREE.Vector2(1.5, 1.5), roughness: 1, metalness: 0, vertexColors: true, dithering: true
  }), U, { key: 'bark', height: 13 });

  const leafTex = {
    broad: leafTexture('broad', mobile ? 128 : 192),
    cluster: leafTexture('cluster', mobile ? 160 : 256),
    needle: leafTexture('needle', mobile ? 128 : 192),
    bloom: leafTexture('bloom', mobile ? 128 : 192)
  };
  const leafGeo = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, .07 * Math.cos(p.getY(i) * Math.PI));
    g.translate(0, .5, 0); g.computeVertexNormals(); return g;
  })();
  const leafMat = windify(new THREE.MeshStandardMaterial({
    map: leafTex.broad, alphaTest: .42, side: THREE.DoubleSide, roughness: .66, metalness: 0
  }), U, { key: 'leaf', height: 13, flutter: .05, backlight: true });

  const skelMat = new THREE.LineBasicMaterial({ color: 0x9ef01a, transparent: true, opacity: .55 });
  let wood = null, leaves = null, skel = null;
  const stats = { nodes: 0, branches: 0, woodTris: 0, leafTris: 0, leaves: 0, seg: 0, auto: false, ms: 0 };

  function dispose(m) { if (!m) return; group.remove(m); if (m.isInstancedMesh) m.dispose(); if (m.geometry) m.geometry.dispose(); }

  function* build(P, Q, groundAt) {
    const t0 = performance.now();
    const rng = mulberry32(P.seed >>> 0);
    const noise = makeNoise3D(P.seed * 7919 + 13);
    const H = P.height;
    const env = envelope(P);
    const trunkR = Math.min(P.trunk, H * .10);

    const want = H * lerp(.055, .014, P.detail);
    const k = 30 + P.crown / 120;
    const seg = Math.max(want, k * H / Q.maxNodes);
    stats.seg = seg; stats.auto = seg > want * 1.02;
    const di = Math.max(seg * 4.2, env.r * .22), dk = seg * 1.55;

    /* ---- точки притяжения ---- */
    const pts = [];
    const N = Math.round(P.crown);
    if (P.shape === 'cone') {
      for (let i = 0; i < N; i++) {
        const y = lerp(env.y0, env.y1, Math.pow(rng(), .75));
        const rr = env.r * Math.pow(1 - (y - env.y0) / (env.y1 - env.y0), .8) * (.5 + .5 * rng());
        const a = rng() * TAU;
        pts.push({ x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, active: true });
      }
    } else if (P.shape === 'umbrella') {
      for (let i = 0; i < N; i++) {
        const a = rng() * TAU, rr = env.r * Math.sqrt(rng());
        const y = env.y1 - .22 * H * Math.pow(rr / env.r, 1.7) + (rng() - .5) * H * .06;
        pts.push({ x: Math.cos(a) * rr, y: Math.max(env.y0, y), z: Math.sin(a) * rr, active: true });
      }
    } else {
      const cy = (env.y0 + env.y1) * .5, ry = (env.y1 - env.y0) * .5;
      const lobes = [];
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
    yield { p: .06, label: 'крона' };

    /* ---- скелет ---- */
    const list = [];
    const mk = (x, y, z, parent) => {
      const n = { x, y, z, parent, children: [], r: 0, dist: parent ? parent.dist + Math.hypot(x - parent.x, y - parent.y, z - parent.z) : 0, order: parent ? parent.order + 1 : 0, ax: 0, ay: 0, az: 0, cnt: 0, grow: 0 };
      list.push(n); if (parent) parent.children.push(n); return n;
    };
    const seedTop = env.y0 + (env.y1 - env.y0) * .12;
    let cur = mk(0, 0, 0, null);
    const steps = Math.max(3, Math.round(seedTop / seg));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, bend = P.chaos * .3;
      cur = mk(Math.sin(t * 2.1) * bend * H * .05 + (rng() - .5) * seg * .18, seedTop * t,
        Math.cos(t * 1.7) * bend * H * .04 + (rng() - .5) * seg * .18, cur);
    }
    const nh = new Hash(di); for (const n of list) nh.insert(n);
    const ph = new Hash(dk); for (const p of pts) ph.insert(p);
    const di2 = di * di, dk2 = dk * dk;
    let active = pts.length;
    const chaos = P.chaos, droop = P.droop;

    for (let iter = 0; iter < 420; iter++) {
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
      const fresh = [];
      if (!any) {
        // мост: тянем верхушку к ближайшей живой точке — рост никогда не залипает
        let tip = list[0];
        for (const n of list) if (n.y > tip.y) tip = n;
        let bp = null, bd = Infinity;
        for (const p of pts) {
          if (!p.active) continue;
          const d = (p.x - tip.x) ** 2 + (p.y - tip.y) ** 2 + (p.z - tip.z) ** 2;
          if (d < bd) { bd = d; bp = p; }
        }
        if (!bp) break;
        const dx = bp.x - tip.x, dy = bp.y - tip.y + seg * .25, dz = bp.z - tip.z, l = Math.hypot(dx, dy, dz) || 1;
        const c = mk(tip.x + dx / l * seg, Math.max(.04, tip.y + dy / l * seg), tip.z + dz / l * seg, tip);
        nh.insert(c); fresh.push(c);
      } else {
        for (let i = 0, len = list.length; i < len; i++) {
          const n = list[i]; if (!n.cnt) continue;
          let dx = n.ax / n.cnt, dy = n.ay / n.cnt, dz = n.az / n.cnt;
          dy += droop * (n.order > 2 ? .55 : .10) + .06;
          dx += (rng() - .5) * chaos * .85; dy += (rng() - .5) * chaos * .45; dz += (rng() - .5) * chaos * .85;
          const l = Math.hypot(dx, dy, dz) || 1;
          const c = mk(n.x + dx / l * seg, Math.max(.04, n.y + dy / l * seg), n.z + dz / l * seg, n);
          nh.insert(c); fresh.push(c);
        }
      }
      for (const f of fresh) {
        ph.near(f.x, f.y, f.z, p => {
          if (!p.active) return;
          if ((p.x - f.x) ** 2 + (p.y - f.y) ** 2 + (p.z - f.z) ** 2 < dk2) { p.active = false; active--; }
        });
      }
      if (iter % 10 === 0) yield { p: .06 + .44 * Math.min(1, iter / 200), label: 'рост скелета' };
      if (list.length >= Q.maxNodes || active <= 0) break;
    }

    /* ---- радиусы (трубная модель) ---- */
    const EXP = 2.35, tipR = .022 * Math.max(.6, H / 13);
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (!n.children.length) n.r = tipR;
      else { let s = 0; for (const c of n.children) s += Math.pow(c.r, EXP); n.r = Math.pow(s, 1 / EXP); }
      n.r = Math.max(n.r, tipR * .55);
    }
    const f = trunkR / list[0].r;
    let maxD = 0;
    for (const n of list) {
      n.r *= f;
      if (n.y < 1.4) n.r *= 1 + (.55 + P.roots * .9) * Math.exp(-n.y / .45);
      if (n.dist > maxD) maxD = n.dist;
    }
    for (const n of list) n.grow = maxD > 0 ? n.dist / maxD : 0;
    yield { p: .52, label: 'радиусы' };

    /* ---- цепочки ветвей ---- */
    const paths = [];
    const walk = (first, inc) => {
      const chain = inc ? [inc, first] : [first];
      let c = first;
      while (c.children.length === 1) { c = c.children[0]; chain.push(c); }
      paths.push({ nodes: chain, fork: !!inc });
      for (const ch of c.children) walk(ch, c);
    };
    walk(list[0], null);

    const baseY = groundAt(0, 0);
    const nRoots = 5 + Math.round(P.roots * 5);
    for (let i = 0; i < nRoots; i++) {
      const a = i / nRoots * TAU + rng() * .5, R = trunkR * (1.6 + P.roots * 1.4);
      const x1 = Math.cos(a) * R * .55, z1 = Math.sin(a) * R * .55;
      const x2 = Math.cos(a) * R, z2 = Math.sin(a) * R;
      paths.push({
        fork: true, nodes: [
          { x: 0, y: .3, z: 0, r: trunkR * .62, dist: .05, grow: .004, children: [1] },
          { x: x1, y: groundAt(x1, z1) - baseY + .06, z: z1, r: trunkR * .40, dist: R * .8, grow: .02, children: [1] },
          { x: x2, y: groundAt(x2, z2) - baseY - .22, z: z2, r: trunkR * .16, dist: R * 1.6, grow: .03, children: [] }
        ]
      });
    }

    /* ---- геометрия древесины ---- */
    const pos = [], nor = [], uv = [], gr = [], col = [], idx = [];
    const T = new THREE.Vector3(), Nv = new THREE.Vector3(), B = new THREE.Vector3(), pT = new THREE.Vector3(), ax = new THREE.Vector3();
    const depth = P.barkDepth;
    for (let pi = 0; pi < paths.length; pi++) {
      const chain = paths[pi].nodes;
      if (chain.length < 2) continue;
      const r0 = chain[0].r;
      const radial = Math.max(3, Math.min(20, Math.round(Q.radial * clamp(r0 / .22, .34, 1.35))));
      T.set(chain[1].x - chain[0].x, chain[1].y - chain[0].y, chain[1].z - chain[0].z).normalize();
      Nv.set(0, 1, 0); if (Math.abs(T.dot(Nv)) > .9) Nv.set(1, 0, 0);
      Nv.crossVectors(T, Nv).normalize(); pT.copy(T);
      const base = pos.length / 3, stride = radial + 1, uS = TAU * r0 / .6;
      for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        if (i === 0) T.set(chain[1].x - c.x, chain[1].y - c.y, chain[1].z - c.z);
        else if (i === chain.length - 1) T.set(c.x - chain[i - 1].x, c.y - chain[i - 1].y, c.z - chain[i - 1].z);
        else T.set(chain[i + 1].x - chain[i - 1].x, chain[i + 1].y - chain[i - 1].y, chain[i + 1].z - chain[i - 1].z);
        if (T.lengthSq() < 1e-10) T.copy(pT);
        T.normalize();
        if (i > 0) {
          ax.crossVectors(pT, T);
          const l = ax.length();
          if (l > 1e-6) { ax.divideScalar(l); Nv.applyAxisAngle(ax, Math.acos(clamp(pT.dot(T), -1, 1))); }
          Nv.addScaledVector(T, -Nv.dot(T));
          if (Nv.lengthSq() < 1e-8) Nv.set(1, 0, 0).addScaledVector(T, -T.x);
          Nv.normalize(); pT.copy(T);
        }
        B.crossVectors(T, Nv).normalize();
        // воротничок у развилки + сглаживание радиуса
        let rr0 = c.r;
        if (paths[pi].fork && i > 0 && i < 3) rr0 *= 1 + (3 - i) * .13;
        if (i < chain.length - 1) rr0 = Math.max(rr0, chain[i + 1].r * .98);
        const furAmp = depth * .19 * clamp(r0 / .22, 0, 1);
        for (let j = 0; j <= radial; j++) {
          const a = j / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
          const fur = ridged(noise, ca * 1.7 + r0 * 4, sa * 1.7, c.dist * .85, 3) - .62;
          const flute = Math.sin(a * 5 + c.dist * .25) * .045 * clamp(r0 / .3, 0, 1);
          const rr = Math.max(.004, rr0 * (1 + furAmp * fur * 2 + flute));
          const nx = Nv.x * ca + B.x * sa, ny = Nv.y * ca + B.y * sa, nz = Nv.z * ca + B.z * sa;
          const px = c.x + nx * rr, py = c.y + ny * rr, pz = c.z + nz * rr;
          pos.push(px, py, pz); nor.push(nx, ny, nz);
          uv.push(j / radial * uS, c.dist / .6); gr.push(c.grow);
          const mossN = fbm(noise, px * .8, py * .6, pz * .8, 3) * .5 + .5;
          const m = clamp(mossN * (1 - clamp(py / 2.8, 0, 1)) * (.45 + .55 * Math.max(0, -nz)), 0, 1) * P.moss;
          col.push(lerp(1, .38, m), lerp(1, .58, m), lerp(1, .30, m));
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
        nor.push(T.x, T.y, T.z); uv.push(.5, last.dist / .6 + .1); gr.push(Math.min(1, last.grow + .005)); col.push(1, 1, 1);
        const rb = base + (chain.length - 1) * stride;
        for (let j = 0; j < radial; j++) idx.push(rb + j, rb + j + 1, ti);
      }
      if (pi % 24 === 0) yield { p: .52 + .28 * (pi / paths.length), label: 'кора и борозды' };
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aGrow', new THREE.Float32BufferAttribute(gr, 1));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeBoundingSphere();
    yield { p: .82, label: 'сборка ствола' };

    /* ---- листва ---- */
    const tips = list.filter(n => !n.children.length || (n.r < trunkR * .07 && n.order > 4));
    const want2 = Math.min(Math.round(P.leaves), Q.leafCap);
    let leafMesh = null;
    if (want2 > 0 && tips.length) {
      const lg = leafGeo.clone();
      leafMesh = new THREE.InstancedMesh(lg, leafMat, want2);
      const lc = new Float32Array(want2 * 3), la = new Float32Array(want2);
      const d = new THREE.Object3D(), c = new THREE.Color();
      const base = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl, THREE.SRGBColorSpace);
      const hs = H / 13, needle = P.leafShape === 'needle', cluster = P.leafShape === 'cluster';
      const crownR = Math.max(1, env.r);
      for (let i = 0; i < want2; i++) {
        const n = tips[(rng() * tips.length) | 0], p = n.parent || n, t = rng();
        const px = lerp(p.x, n.x, t), py = lerp(p.y, n.y, t), pz = lerp(p.z, n.z, t);
        const j = .14 * hs * P.leafSize;
        d.position.set(px + (rng() - .5) * j * 2, py + (rng() - .5) * j, pz + (rng() - .5) * j * 2);
        d.rotation.set(-Math.PI / 2 + (rng() - .5) * 1.5 + (needle ? .35 : 0), rng() * TAU, (rng() - .5) * .85, 'YXZ');
        const s = P.leafSize * hs * (.7 + rng() * .6) * (cluster ? .40 : .21);
        d.scale.set(s * (needle ? .34 : 1), s * (needle ? 1.75 : 1), s);
        d.updateMatrix(); leafMesh.setMatrixAt(i, d.matrix);
        const inner = clamp(1 - Math.hypot(px, pz) / crownR, 0, 1);
        c.setHSL((hsl.h + (rng() - .5) * .07 * P.leafVar + 1) % 1,
          clamp(hsl.s + (rng() - .5) * .32 * P.leafVar, 0, 1),
          clamp(hsl.l * (.74 + .52 * rng()) * (1 - .30 * inner), .02, .96), THREE.SRGBColorSpace);
        lc[i * 3] = c.r; lc[i * 3 + 1] = c.g; lc[i * 3 + 2] = c.b;
        la[i] = Math.min(1, n.grow + .012);
        if (i % 6000 === 0) yield { p: .82 + .16 * (i / want2), label: 'листва' };
      }
      lg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(la, 1));
      leafMesh.instanceColor = new THREE.InstancedBufferAttribute(lc, 3);
      leafMesh.instanceMatrix.needsUpdate = true;
      leafMesh.castShadow = true; leafMesh.receiveShadow = true; leafMesh.frustumCulled = false;
    }

    /* ---- скелет-оверлей ---- */
    const sp = [];
    for (const n of list) if (n.parent) sp.push(n.parent.x, n.parent.y, n.parent.z, n.x, n.y, n.z);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));

    /* ---- коммит ---- */
    dispose(wood); dispose(leaves);
    if (skel) { group.remove(skel); skel.geometry.dispose(); }
    wood = new THREE.Mesh(geo, barkMat);
    wood.castShadow = true; wood.receiveShadow = true; wood.frustumCulled = false;
    group.add(wood);
    if (leafMesh) { leaves = leafMesh; group.add(leaves); } else leaves = null;
    skel = new THREE.LineSegments(sg, skelMat);
    skel.visible = P.skeleton; skel.frustumCulled = false; group.add(skel);

    leafMat.map = leafTex[P.leafShape] || leafTex.broad; leafMat.needsUpdate = true;
    barkMat.userData.uH.value = H; leafMat.userData.uH.value = H;
    group.position.y = baseY;
    barkMat.userData.uB.value = baseY; leafMat.userData.uB.value = baseY;

    stats.nodes = list.length; stats.branches = paths.length;
    stats.woodTris = geo.index.count / 3;
    stats.leaves = leaves ? leaves.count : 0;
    stats.leafTris = stats.leaves * 4;
    stats.ms = performance.now() - t0;
    yield { p: 1, label: 'готово' };
    return stats;
  }

  return {
    group, stats, build, leafTex,
    materials: { barkMat, leafMat },
    get wood() { return wood; }, get leaves() { return leaves; },
    setBase(y) { group.position.y = y; barkMat.userData.uB.value = y; leafMat.userData.uB.value = y; },
    setWire(v) { barkMat.wireframe = v; leafMat.wireframe = v; },
    setSkeleton(v) { if (skel) skel.visible = v; },
    setColor(c) { barkMat.color.set(c); }
  };
}
