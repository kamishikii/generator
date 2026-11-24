
import * as THREE from 'three';
import { clamp, lerp, TAU, makeNoise3D, fbm } from './noise.js';
import { eyeTexture } from './textures.js';

export const HUMAN_POSES = {
  tpose: { arm: 2, elbow: 2, spread: 5, knee: 2, lean: 0, swing: 0 },
  apose: { arm: 45, elbow: 8, spread: 6, knee: 3, lean: 0, swing: 0 },
  idle: { arm: 74, elbow: 14, spread: 5, knee: 4, lean: 2, swing: 0 },
  walk: { arm: 68, elbow: 22, spread: 4, knee: 10, lean: 4, swing: 26 },
  run: { arm: 52, elbow: 78, spread: 6, knee: 38, lean: 13, swing: 40 },
  sit: { arm: 72, elbow: 34, spread: 14, knee: 86, lean: 6, swing: 0 }
};
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const acc = () => ({ p: [], n: [], u: [], c: [], i: [] });
const COL = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const G = (u, v, cu, cv, su, sv) => Math.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2));
const rotX = (v, d) => v.clone().applyAxisAngle(V3(1, 0, 0), d * Math.PI / 180);

function tube(a, st, radial, colFn, uvS = 1) {
  if (st.length < 2) return;
  const T = V3(), N = V3(), B = V3(), pT = V3(), ax = V3();
  T.copy(st[1].p).sub(st[0].p).normalize();
  N.set(0, 0, 1); if (Math.abs(T.dot(N)) > .9) N.set(1, 0, 0);
  N.crossVectors(T, N).normalize(); pT.copy(T);
  const base = a.p.length / 3, stride = radial + 1;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (i === 0) T.copy(st[1].p).sub(s.p);
    else if (i === st.length - 1) T.copy(s.p).sub(st[i - 1].p);
    else T.copy(st[i + 1].p).sub(st[i - 1].p);
    if (T.lengthSq() < 1e-10) T.copy(pT);
    T.normalize();
    if (i > 0) {
      ax.crossVectors(pT, T); const l = ax.length();
      if (l > 1e-6) { ax.divideScalar(l); N.applyAxisAngle(ax, Math.acos(clamp(pT.dot(T), -1, 1))); }
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize(); pT.copy(T);
    }
    B.crossVectors(T, N).normalize();
    const col = colFn(i, s);
    for (let j = 0; j <= radial; j++) {
      const ang = j / radial * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      const ds = sa < 0 ? (s.kf || 1) : (s.kb || 1);
      const rw = s.w * ca, rd = s.d * sa * ds;
      a.p.push(s.p.x + N.x * rw + B.x * rd, s.p.y + N.y * rw + B.y * rd, s.p.z + N.z * rw + B.z * rd);
      const gx = ca / Math.max(.001, s.w), gz = sa / Math.max(.001, s.d), gl = Math.hypot(gx, gz) || 1;
      a.n.push((N.x * gx + B.x * gz) / gl, (N.y * gx + B.y * gz) / gl, (N.z * gx + B.z * gz) / gl);
      a.u.push(j / radial * uvS, i / (st.length - 1) * uvS);
      a.c.push(col[0], col[1], col[2]);
    }
  }
  for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < radial; j++) {
    const q = base + i * stride + j;
    a.i.push(q, q + 1, q + stride, q + 1, q + stride + 1, q + stride);
  }
  const cap = (idx, dir) => {
    const s = st[idx], c = a.p.length / 3, col = colFn(idx, s);
    a.p.push(s.p.x + dir.x * .004, s.p.y + dir.y * .004, s.p.z + dir.z * .004);
    a.n.push(dir.x, dir.y, dir.z); a.u.push(.5, .5); a.c.push(col[0], col[1], col[2]);
    const rb = base + idx * stride;
    for (let j = 0; j < radial; j++) { if (idx === 0) a.i.push(rb + j + 1, rb + j, c); else a.i.push(rb + j, rb + j + 1, c); }
  };
  cap(0, V3().copy(st[0].p).sub(st[1].p).normalize());
  cap(st.length - 1, V3().copy(st[st.length - 1].p).sub(st[st.length - 2].p).normalize());
}
function surface(a, U, V, fn, center) {
  const base = a.p.length / 3, W = U + 1, pts = [];
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const s = fn(i / U, j / V);
    pts.push(s.p);
    a.p.push(s.p.x, s.p.y, s.p.z);
    a.n.push(0, 0, 0);
    a.u.push(s.uv ? s.uv[0] : i / U, s.uv ? s.uv[1] : j / V);
    a.c.push(s.c[0], s.c[1], s.c[2]);
  }
  const at = (i, j) => pts[clamp(j, 0, V) * W + ((i % U) + U) % U];
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const pu = at(i + 1, j).clone().sub(at(i - 1, j));
    const pv = at(i, Math.min(V, j + 1)).clone().sub(at(i, Math.max(0, j - 1)));
    const n = V3().crossVectors(pv, pu);
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0); else n.normalize();
    const p = pts[j * W + i];
    if (n.dot(V3().copy(p).sub(center)) < 0) n.negate();
    const k = (base + j * W + i) * 3;
    a.n[k] = n.x; a.n[k + 1] = n.y; a.n[k + 2] = n.z;
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
    const q = base + j * W + i;
    a.i.push(q, q + W, q + 1, q + 1, q + W, q + W + 1);
  }
}
function box(a, cx, cy, cz, w, h, d, col) {
  const F = [[[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]]];
  for (const [n, u, v] of F) {
    const off = a.p.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      a.p.push(cx + (n[0] + u[0] * su + v[0] * sv) * w / 2, cy + (n[1] + u[1] * su + v[1] * sv) * h / 2, cz + (n[2] + u[2] * su + v[2] * sv) * d / 2);
      a.n.push(n[0], n[1], n[2]); a.u.push((su + 1) / 2, (sv + 1) / 2); a.c.push(col[0], col[1], col[2]);
    }
    a.i.push(off, off + 1, off + 2, off, off + 2, off + 3);
  }
}
function geoOf(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.c, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.i), 1));
  g.computeBoundingSphere(); return g;
}

export function createHumanMaterials(tex, iris) {
  const skin = new THREE.MeshStandardMaterial({ map: tex.skin.map, normalMap: tex.skin.normalMap, normalScale: new THREE.Vector2(.7, .7), vertexColors: true, roughness: .58, metalness: 0, side: THREE.DoubleSide });
  skin.map.repeat.set(6, 6); skin.normalMap.repeat.set(10, 10);
  const cloth = new THREE.MeshStandardMaterial({ map: tex.fabric.map, normalMap: tex.fabric.normalMap, normalScale: new THREE.Vector2(.9, .9), vertexColors: true, roughness: .82, metalness: 0, side: THREE.DoubleSide });
  cloth.map.repeat.set(10, 10); cloth.normalMap.repeat.set(16, 16);
  const hair = new THREE.MeshStandardMaterial({ map: tex.hair.map, normalMap: tex.hair.normalMap, vertexColors: true, roughness: .48, metalness: .05, side: THREE.DoubleSide });
  hair.map.repeat.set(4, 2); hair.normalMap.repeat.set(6, 3);
  const eye = new THREE.MeshStandardMaterial({ map: eyeTexture(256, iris || '#5b7f9a'), roughness: .18, metalness: 0 });
  const cornea = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .16, roughness: .04, metalness: 0, depthWrite: false });
  return { skin, cloth, hair, eye, cornea };
}

export function createHuman(tex) {
  const group = new THREE.Group();
  let mats = null, meshes = {};
  const stats = { tris: 0, verts: 0, ms: 0, height: 1.8 };
  let lastIris = null;

  function* build(P) {
    const t0 = performance.now();
    if (!mats || lastIris !== P.hIris) { mats = createHumanMaterials(tex, P.hIris); lastIris = P.hIris; }
    const aS = acc(), aC = acc(), aH = acc(), aE = acc(), aG = acc();
    const H = P.hHeight / 100, fem = P.hFemale, male = 1 - fem, bd = P.hBuild, mus = P.hMuscle;
    const skin = COL(P.hSkin), shirt = COL(P.hShirt), pants = COL(P.hPants), hairC = COL(P.hHair), shoe = COL(P.hShoes);
    const lip = mixc(skin, COL('#a8434a'), .55), blush = mixc(skin, COL('#c25a52'), .22), shade = mixc(skin, COL('#3a2418'), .3);
    const cloth = P.hClothed, rad = Math.round(P.hDetail), face = P.hFace;
    const noise = makeNoise3D(4242);
    const sh = .116 * H * P.hShoulders * (1 + .10 * male - .06 * fem);
    const chestW = .088 * H * P.hChest * (1 + .18 * bd), chestD = chestW * .70 * (1 + .25 * bd);
    const waistW = .066 * H * P.hWaist * (1 + .55 * bd + .5 * P.hBelly), waistD = waistW * .78 * (1 + .6 * P.hBelly);
    const hipW = .086 * H * P.hHips * (1 + .16 * fem + .2 * bd), hipD = hipW * .74;
    const neckW = .029 * H * P.hNeck, hs = P.hHead;
    const hipY = .50 * H * P.hLegs, shoulderY = hipY + .32 * H;
    const neckY = shoulderY + .045 * H, chinY = neckY + .022 * H;
    const rx = .049 * H * hs, ry = .068 * H * hs, rz = .056 * H * hs;
    const headC = V3(0, chinY + ry * .92, 0);
    const crownY = headC.y + ry;
    const lean = P.hLean * Math.PI / 180;
    const tilt = v => V3(v.x, v.y, v.z + (v.y - hipY) * Math.tan(lean));
    const ci = cloth ? .012 : 0;

    const lower = [
      { p: tilt(V3(0, hipY - .07 * H, 0)), w: hipW * .86 + ci, d: hipD * .86 + ci, kb: 1.1 },
      { p: tilt(V3(0, hipY, 0)), w: hipW + ci, d: hipD + ci, kb: 1.14 },
      { p: tilt(V3(0, hipY + .07 * H, 0)), w: lerp(hipW, waistW, .6) + ci, d: lerp(hipD, waistD, .6) + ci, kb: 1.05 },
      { p: tilt(V3(0, hipY + .12 * H, 0)), w: waistW + ci, d: waistD + ci, kf: 1 + .22 * P.hBelly }
    ];
    const upper = [
      { p: tilt(V3(0, hipY + .12 * H, 0)), w: waistW + ci, d: waistD + ci, kf: 1 + .22 * P.hBelly },
      { p: tilt(V3(0, hipY + .19 * H, 0)), w: lerp(waistW, chestW, .7) + ci, d: lerp(waistD, chestD, .7) + ci, kf: 1.06 + .14 * fem },
      { p: tilt(V3(0, hipY + .25 * H, 0)), w: chestW + ci, d: chestD * (1 + .2 * fem) + ci, kf: 1.1 + .12 * mus },
      { p: tilt(V3(0, shoulderY, 0)), w: sh + ci, d: chestD * .74 + ci, kb: 1.06 },
      { p: tilt(V3(0, neckY - .012 * H, 0)), w: neckW * 1.6, d: neckW * 1.5 },
      { p: tilt(V3(0, neckY, 0)), w: neckW, d: neckW },
      { p: tilt(V3(0, chinY, 0)), w: neckW * .95, d: neckW * .95 }
    ];
    tube(cloth ? aC : aS, lower, rad, () => cloth ? pants : skin, 2);
    tube(aS, upper.slice(4), rad, () => skin, 2);
    tube(cloth ? aC : aS, upper.slice(0, 5), rad, (i, s) => cloth ? shirt : mixc(skin, blush, i === 2 ? .18 : 0), 2);
    yield { p: .16, label: 'торс' };

    for (const side of [-1, 1]) {
      const sw = side * P.hSwing;
      const hipJ = tilt(V3(side * hipW * .52, hipY - .02 * H, 0));
      const upLen = .25 * H * P.hLegs, loLen = .24 * H * P.hLegs;
      let dUp = rotX(V3(side * Math.sin(P.hSpread * Math.PI / 180), -Math.cos(P.hSpread * Math.PI / 180), 0).normalize(), sw);
      const kneeP = hipJ.clone().addScaledVector(dUp, upLen);
      const dLo = rotX(dUp, -P.hKnee * (sw > 0 ? .6 : 1.2));
      const ankle = kneeP.clone().addScaledVector(dLo, loLen);
      const thW = .055 * H * (1 + .45 * bd + .2 * mus), knW = .037 * H * (1 + .2 * bd), anW = .025 * H;
      const thigh = [{ p: hipJ, w: thW * 1.1 + ci, d: thW * 1.05 + ci, kb: 1.1 },
        { p: hipJ.clone().addScaledVector(dUp, upLen * .45), w: thW + ci, d: thW * .95 + ci },
        { p: kneeP, w: knW + ci, d: knW + ci, kf: 1.1 }];
      const shin = [{ p: kneeP, w: knW + ci, d: knW + ci, kf: 1.1 },
        { p: kneeP.clone().addScaledVector(dLo, loLen * .3), w: knW * 1.14 + ci, d: knW * 1.18 + ci, kb: 1.12 },
        { p: ankle, w: anW, d: anW }];
      tube(cloth ? aC : aS, thigh, rad, () => cloth ? pants : skin, 2);
      tube(cloth ? aC : aS, shin.slice(0, 2), rad, () => cloth ? pants : skin, 2);
      tube(aS, shin.slice(1), rad, () => skin, 2);
      if (cloth) {
        box(aC, ankle.x, ankle.y - .024 * H, ankle.z + .045 * H, anW * 2.3, .05 * H, .135 * H, shoe);
        box(aC, ankle.x, ankle.y + .012 * H, ankle.z - .012 * H, anW * 2.1, .05 * H, .07 * H, shoe);
      } else {
        tube(aS, [{ p: ankle, w: anW, d: anW }, { p: ankle.clone().add(V3(0, -.022 * H, .05 * H)), w: anW * 1.15, d: .05 * H }, { p: ankle.clone().add(V3(0, -.03 * H, .1 * H)), w: anW * 1.05, d: .028 * H }], rad, () => skin, 1);
        for (let t = 0; t < 5; t++) {
          const tx = ankle.x + (t - 2) * .011 * H, tz = ankle.z + .105 * H - Math.abs(t - 1) * .006 * H;
          surface(aS, 8, 6, (u, v) => { const az = u * TAU, la = -Math.PI / 2 + v * Math.PI;
            return { p: V3(tx + Math.cos(la) * Math.sin(az) * .009 * H, ankle.y - .032 * H + Math.sin(la) * .008 * H, tz + Math.cos(la) * Math.cos(az) * .012 * H), c: skin }; }, V3(tx, ankle.y - .032 * H, tz));
        }
      }
      yield { p: .3 + (side > 0 ? .08 : 0), label: 'ноги' };
    }
    for (const side of [-1, 1]) {
      const sw = -side * P.hSwing * .8;
      const shJ = tilt(V3(side * sh * .93, shoulderY - .012 * H, 0));
      const upLen = .17 * H * P.hArms, loLen = .155 * H * P.hArms;
      const ang = P.hArm * Math.PI / 180;
      let dUp = rotX(V3(side * Math.cos(ang), -Math.sin(ang), 0).normalize(), sw);
      const elbow = shJ.clone().addScaledVector(dUp, upLen);
      const dLo = rotX(dUp, -P.hElbow);
      const wrist = elbow.clone().addScaledVector(dLo, loLen);
      const deW = .038 * H * (1 + .5 * mus + .25 * bd), elW = .028 * H * (1 + .25 * mus), wrW = .021 * H;
      const up = [{ p: shJ, w: deW * 1.18 + ci, d: deW * 1.18 + ci },
        { p: shJ.clone().addScaledVector(dUp, upLen * .5), w: deW + ci, d: deW * .95 + ci, kf: 1 + .12 * mus },
        { p: elbow, w: elW + ci, d: elW + ci }];
      const fore = [{ p: elbow, w: elW + ci, d: elW + ci },
        { p: elbow.clone().addScaledVector(dLo, loLen * .35), w: elW * .96, d: elW },
        { p: wrist, w: wrW, d: wrW * .8 }];
      tube(cloth ? aC : aS, up, rad, () => cloth ? shirt : skin, 2);
      tube(aS, fore, rad, () => skin, 2);
      const palmEnd = wrist.clone().addScaledVector(dLo, .045 * H);
      const sideDir = V3().crossVectors(dLo, V3(0, 1, 0)).normalize().multiplyScalar(side);
      tube(aS, [{ p: wrist, w: wrW * .95, d: wrW * .7 }, { p: palmEnd, w: wrW * 1.5, d: wrW * .55 }], rad, () => skin, 1);
      for (let f = 0; f < 4; f++) {
        const off = (f - 1.5) * .011 * H;
        const b = palmEnd.clone().addScaledVector(sideDir, off);
        const len = (.032 - Math.abs(f - 1.2) * .004) * H;
        const d1 = dLo.clone().addScaledVector(sideDir, (f - 1.5) * .06).normalize();
        const m = b.clone().addScaledVector(d1, len), e = m.clone().addScaledVector(rotX(d1, -18), len * .7);
        tube(aS, [{ p: b, w: .0055 * H, d: .0055 * H }, { p: m, w: .005 * H, d: .005 * H }, { p: e, w: .004 * H, d: .004 * H }], 6, () => skin, 1);
      }
      const tb = wrist.clone().addScaledVector(dLo, .014 * H).addScaledVector(sideDir, -.016 * H);
      const tm = tb.clone().addScaledVector(sideDir, -.016 * H).addScaledVector(dLo, .014 * H);
      tube(aS, [{ p: tb, w: .007 * H, d: .007 * H }, { p: tm, w: .0055 * H, d: .0055 * H }, { p: tm.clone().addScaledVector(dLo, .012 * H), w: .004 * H, d: .004 * H }], 6, () => skin, 1);
      yield { p: .46 + (side > 0 ? .08 : 0), label: 'руки' };
    }

    const headFn = (u, v, inflate) => {
      const az = u * TAU, la = -Math.PI / 2 + v * Math.PI;
      const nx = Math.cos(la) * Math.sin(az), ny = Math.sin(la), nz = Math.cos(la) * Math.cos(az);
      let px = nx * rx, py = ny * ry, pz = nz * rz;
      const t = clamp((-ny - .12) / .88, 0, 1);
      px *= lerp(1, .74, t * t); pz *= lerp(1, .93, t);
      if (nz < 0) pz *= .95;
      const front = clamp((nz - .05) / .55, 0, 1);
      const fu = nx / Math.max(.2, Math.cos(la)), fv = ny;
      let dz = 0;
      dz += .17 * G(fu, fv, .34, .24, .30, .12) + .17 * G(fu, fv, -.34, .24, .30, .12);
      dz -= .23 * G(fu, fv, .36, .07, .19, .11) + .23 * G(fu, fv, -.36, .07, .19, .11);
      dz += .10 * G(fu, fv, .36, .16, .17, .05) + .10 * G(fu, fv, -.36, .16, .17, .05);
      dz += .07 * G(fu, fv, .36, -.03, .17, .045) + .07 * G(fu, fv, -.36, -.03, .17, .045);
      dz += .28 * G(fu, fv, 0, .10, .085, .22);
      dz += .34 * G(fu, fv, 0, -.16, .10, .095);
      dz += .15 * G(fu, fv, .13, -.22, .065, .055) + .15 * G(fu, fv, -.13, -.22, .065, .055);
      dz -= .12 * G(fu, fv, .085, -.265, .035, .028) + .12 * G(fu, fv, -.085, -.265, .035, .028);
      dz += .13 * G(fu, fv, 0, -.42, .21, .05);
      dz += .16 * G(fu, fv, 0, -.53, .19, .055);
      dz -= .12 * G(fu, fv, 0, -.475, .23, .020);
      dz -= .06 * G(fu, fv, 0, -.34, .045, .05);
      dz -= .08 * G(fu, fv, .22, -.47, .05, .06) + .08 * G(fu, fv, -.22, -.47, .05, .06);
      dz += .15 * G(fu, fv, 0, -.76, .19, .12);
      dz += .10 * G(fu, fv, .58, -.10, .22, .20) + .10 * G(fu, fv, -.58, -.10, .22, .20);
      dz += .05 * G(fu, fv, 0, .58, .5, .26);
      pz += dz * rz * front * face;
      px *= 1 + .05 * G(fu, fv, .62, -.08, .2, .2) * front * face;
      const n2 = fbm(noise, nx * 6, ny * 6, nz * 6, 2) * .004 * H;
      const s = inflate + n2 / Math.max(rx, .001);
      const p = V3(headC.x + px * s, headC.y + py * s, headC.z + pz * s);
      let c = skin;
      const lipM = clamp(G(fu, fv, 0, -.42, .22, .06) + G(fu, fv, 0, -.53, .20, .065), 0, 1) * front * face;
      c = mixc(c, lip, lipM * .85);
      const lidM = clamp(G(fu, fv, .36, .07, .21, .13) + G(fu, fv, -.36, .07, .21, .13), 0, 1) * front * face;
      c = mixc(c, shade, lidM * .3);
      const bl = clamp(G(fu, fv, .55, -.16, .22, .18) + G(fu, fv, -.55, -.16, .22, .18), 0, 1) * front;
      c = mixc(c, blush, bl * .3);
      const nos = G(fu, fv, 0, -.19, .12, .1) * front;
      c = mixc(c, blush, nos * .22);
      return { p, c, uv: [u * 3, v * 3] };
    };
    surface(aS, Math.max(24, rad * 2), Math.max(18, rad + 6), (u, v) => headFn(u, v, 1), headC);
    for (const side of [-1, 1]) {
      const ec = V3(headC.x + side * rx * .97, headC.y - ry * .06, headC.z - rz * .06);
      surface(aS, 14, 12, (u, v) => {
        const az = u * TAU, la = -Math.PI / 2 + v * Math.PI;
        const fold = 1 - .45 * Math.exp(-((u - .5) ** 2) / .02) * (v > .25 && v < .8 ? 1 : 0);
        return { p: V3(ec.x + Math.cos(la) * Math.sin(az) * .009 * H * hs * fold, ec.y + Math.sin(la) * .019 * H * hs, ec.z + Math.cos(la) * Math.cos(az) * .012 * H * hs), c: mixc(skin, blush, .35) };
      }, ec);
    }
    yield { p: .68, label: 'голова и лицо' };

    const eyeR = .0125 * H * hs;
    for (const side of [-1, 1]) {
      const ec = V3(headC.x + side * rx * .36, headC.y + ry * .07, headC.z + rz * .74);
      surface(aE, 20, 14, (u, v) => {
        const az = u * TAU, la = -Math.PI / 2 + v * Math.PI;
        const dx = Math.cos(la) * Math.sin(az), dy = Math.sin(la), dz = Math.cos(la) * Math.cos(az);
        return { p: V3(ec.x + dx * eyeR, ec.y + dy * eyeR, ec.z + dz * eyeR), c: [1, 1, 1], uv: [clamp(.5 + dx * .5, 0, 1), clamp(.5 - dy * .5, 0, 1)] };
      }, ec);
      surface(aG, 16, 10, (u, v) => {
        const az = u * TAU, la = -Math.PI / 2 + v * Math.PI;
        return { p: V3(ec.x + Math.cos(la) * Math.sin(az) * eyeR * 1.06, ec.y + Math.sin(la) * eyeR * 1.06, ec.z + Math.cos(la) * Math.cos(az) * eyeR * 1.06), c: [1, 1, 1] };
      }, ec);
      if (P.hBrows) {
        const pts = [];
        for (let i = 0; i <= 5; i++) {
          const t = i / 5, bx = side * rx * (.16 + t * .42);
          pts.push({ p: V3(headC.x + bx, headC.y + ry * (.24 + Math.sin(t * Math.PI) * .05), headC.z + rz * (.80 - t * .18)), w: .0045 * H * hs * (1 - t * .4), d: .003 * H * hs });
        }
        tube(aH, pts, 6, () => hairC, 1);
      }
    }
    if (P.hHairOn) {
      surface(aH, Math.max(22, rad * 2), 14, (u, v) => {
        const vv = .40 + v * .60;
        const s = headFn(u, vv, 1.055);
        const front = clamp((Math.cos(-Math.PI / 2 + vv * Math.PI) * Math.cos(u * TAU) - .1) / .5, 0, 1);
        const fringe = P.hFringe * .16 * front * (1 - v);
        const p = s.p.clone(); p.y -= fringe * ry; p.z += fringe * rz * .3;
        return { p, c: hairC, uv: [u * 4, v * 2] };
      }, headC);
      if (P.hLongHair > .05) {
        for (const side of [-1, 1]) {
          const L = P.hLongHair * .22 * H;
          const pts = [];
          for (let i = 0; i <= 5; i++) {
            const t = i / 5;
            pts.push({ p: V3(headC.x + side * rx * (.72 + t * .18), headC.y + ry * .3 - t * L, headC.z - rz * (.32 + t * .18)), w: .022 * H * hs * (1 - t * .45), d: .016 * H * hs * (1 - t * .4) });
          }
          tube(aH, pts, 8, () => hairC, 2);
        }
      }
    }
    yield { p: .88, label: 'глаза и волосы' };

    for (const m of Object.values(meshes)) { if (m) { group.remove(m); m.geometry.dispose(); } }
    meshes = {};
    const add = (key, a, mat) => {
      if (!a.p.length) return;
      const g = geoOf(a), m = new THREE.Mesh(g, mat);
      m.castShadow = key !== 'cornea'; m.receiveShadow = true; m.frustumCulled = false;
      if (key === 'cornea') m.renderOrder = 2;
      group.add(m); meshes[key] = m;
      stats.tris = (stats.tris || 0) + g.index.count / 3;
    };
    stats.tris = 0; stats.verts = 0;
    add('skin', aS, mats.skin); add('cloth', aC, mats.cloth); add('hair', aH, mats.hair);
    add('eyes', aE, mats.eye); add('cornea', aG, mats.cornea);
    for (const m of Object.values(meshes)) stats.verts += m.geometry.attributes.position.count;
    stats.height = crownY; stats.ms = performance.now() - t0;
    yield { p: 1, label: 'человек готов' };
    return stats;
  }
  return {
    group, build, stats,
    get mats() { return mats; }, get meshes() { return meshes; },
    get mesh() { return meshes.skin || meshes.cloth; },
    setWire(v) { if (mats) for (const k of ['skin', 'cloth', 'hair']) mats[k].wireframe = v; },
    dispose() { for (const m of Object.values(meshes)) { group.remove(m); m.geometry.dispose(); } meshes = {}; }
  };
}
