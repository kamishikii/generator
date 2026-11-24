import * as THREE from 'three';
import { clamp, lerp, TAU } from './noise.js';

export const HUMAN_POSES = {
  tpose: { arm: 2, elbow: 2, spread: 5, knee: 2, lean: 0, swing: 0 },
  apose: { arm: 45, elbow: 8, spread: 6, knee: 3, lean: 0, swing: 0 },
  idle: { arm: 74, elbow: 14, spread: 5, knee: 4, lean: 2, swing: 0 },
  walk: { arm: 68, elbow: 22, spread: 4, knee: 10, lean: 4, swing: 26 },
  run: { arm: 52, elbow: 78, spread: 6, knee: 38, lean: 13, swing: 40 },
  sit: { arm: 72, elbow: 34, spread: 14, knee: 86, lean: 6, swing: 0 }
};

export function createHuman() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: 0, side: THREE.DoubleSide });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: .25 });
  let mesh = null, eyes = null;
  const stats = { tris: 0, verts: 0, ms: 0, height: 1.8 };

  function acc() { return { p: [], n: [], u: [], c: [], i: [] }; }
  const T = new THREE.Vector3(), Nv = new THREE.Vector3(), B = new THREE.Vector3(), pT = new THREE.Vector3(), ax = new THREE.Vector3();

  function tube(a, st, radial, colAt) {
    if (st.length < 2) return;
    T.copy(st[1].p).sub(st[0].p).normalize();
    Nv.set(0, 0, 1); if (Math.abs(T.dot(Nv)) > .9) Nv.set(1, 0, 0);
    Nv.crossVectors(T, Nv).normalize(); pT.copy(T);
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
        if (l > 1e-6) { ax.divideScalar(l); Nv.applyAxisAngle(ax, Math.acos(clamp(pT.dot(T), -1, 1))); }
        Nv.addScaledVector(T, -Nv.dot(T));
        if (Nv.lengthSq() < 1e-8) Nv.set(1, 0, 0).addScaledVector(T, -T.x);
        Nv.normalize(); pT.copy(T);
      }
      B.crossVectors(T, Nv).normalize();
      const col = colAt(i, s);
      for (let j = 0; j <= radial; j++) {
        const ang = j / radial * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = Nv.x * ca + B.x * sa, ny = Nv.y * ca + B.y * sa, nz = Nv.z * ca + B.z * sa;
        a.p.push(s.p.x + Nv.x * ca * s.w + B.x * sa * s.d, s.p.y + Nv.y * ca * s.w + B.y * sa * s.d, s.p.z + Nv.z * ca * s.w + B.z * sa * s.d);
        const gx = ca / Math.max(.001, s.w), gz = sa / Math.max(.001, s.d), gl = Math.hypot(gx, gz) || 1;
        a.n.push((Nv.x * gx + B.x * gz) / gl, (Nv.y * gx + B.y * gz) / gl, (Nv.z * gx + B.z * gz) / gl);
        a.u.push(j / radial, i / (st.length - 1));
        a.c.push(col[0], col[1], col[2]);
      }
    }
    for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < radial; j++) {
      const q = base + i * stride + j;
      a.i.push(q, q + 1, q + stride, q + 1, q + stride + 1, q + stride);
    }
    const capEnd = (idx, dir) => {
      const s = st[idx], c = a.p.length / 3;
      a.p.push(s.p.x + dir.x * .01, s.p.y + dir.y * .01, s.p.z + dir.z * .01);
      a.n.push(dir.x, dir.y, dir.z); a.u.push(.5, .5);
      const col = colAt(idx, s); a.c.push(col[0], col[1], col[2]);
      const rb = base + idx * stride;
      for (let j = 0; j < radial; j++) {
        if (idx === 0) a.i.push(rb + j + 1, rb + j, c); else a.i.push(rb + j, rb + j + 1, c);
      }
    };
    T.copy(st[0].p).sub(st[1].p).normalize(); capEnd(0, T);
    T.copy(st[st.length - 1].p).sub(st[st.length - 2].p).normalize(); capEnd(st.length - 1, T);
  }
  function box(a, cx, cy, cz, w, h, d, col) {
    const base = a.p.length / 3;
    const faces = [
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
    ];
    const half = [w / 2, h / 2, d / 2];
    for (const [n, u, v] of faces) {
      const off = a.p.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = cx + (n[0] + u[0] * su + v[0] * sv) * half[0];
        const py = cy + (n[1] + u[1] * su + v[1] * sv) * half[1];
        const pz = cz + (n[2] + u[2] * su + v[2] * sv) * half[2];
        a.p.push(px, py, pz); a.n.push(n[0], n[1], n[2]); a.u.push((su + 1) / 2, (sv + 1) / 2); a.c.push(col[0], col[1], col[2]);
      }
      a.i.push(off, off + 1, off + 2, off, off + 2, off + 3);
    }
    return base;
  }
  const C = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function rotX(v, deg) { return v.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), deg * Math.PI / 180); }

  function* build(P) {
    const t0 = performance.now();
    const a = acc();
    const H = P.hHeight / 100;
    const fem = P.hFemale, male = 1 - fem;
    const build_ = P.hBuild, mus = P.hMuscle;
    const skin = C(P.hSkin), shirt = C(P.hShirt), pants = C(P.hPants), hair = C(P.hHair), shoe = C(P.hShoes);
    const cloth = P.hClothed;
    const rad = Math.round(P.hDetail);
    const sh = .116 * H * P.hShoulders * (1 + .10 * male - .06 * fem);
    const chestW = .088 * H * P.hChest * (1 + .18 * build_);
    const chestD = chestW * .70 * (1 + .25 * build_);
    const waistW = .066 * H * P.hWaist * (1 + .55 * build_ + .5 * P.hBelly);
    const waistD = waistW * .78 * (1 + .6 * P.hBelly);
    const hipW = .086 * H * P.hHips * (1 + .16 * fem + .2 * build_);
    const hipD = hipW * .74;
    const neckW = .029 * H * P.hNeck;
    const headS = P.hHead;
    const legLen = P.hLegs, armLen = P.hArms;
    const hipY = .50 * H * legLen, shoulderY = hipY + .32 * H;
    const neckY = shoulderY + .045 * H, chinY = neckY + .022 * H, crownY = chinY + .128 * H * headS;
    const total = crownY;
    const lean = P.hLean * Math.PI / 180;
    const tilt = v => V3(v.x, v.y, v.z + (v.y - hipY) * Math.tan(lean));

    const torso = [
      { p: tilt(V3(0, hipY - .05 * H, 0)), w: hipW * .92, d: hipD * .9 },
      { p: tilt(V3(0, hipY, 0)), w: hipW, d: hipD },
      { p: tilt(V3(0, hipY + .07 * H, 0)), w: lerp(hipW, waistW, .6), d: lerp(hipD, waistD, .6) },
      { p: tilt(V3(0, hipY + .12 * H, 0)), w: waistW, d: waistD },
      { p: tilt(V3(0, hipY + .19 * H, 0)), w: lerp(waistW, chestW, .7), d: lerp(waistD, chestD, .7) * (1 + .12 * fem) },
      { p: tilt(V3(0, hipY + .25 * H, 0)), w: chestW, d: chestD * (1 + .2 * fem) },
      { p: tilt(V3(0, shoulderY, 0)), w: sh, d: chestD * .74 },
      { p: tilt(V3(0, neckY - .012 * H, 0)), w: neckW * 1.6, d: neckW * 1.5 },
      { p: tilt(V3(0, neckY, 0)), w: neckW, d: neckW },
      { p: tilt(V3(0, chinY, 0)), w: neckW * .95, d: neckW * .95 }
    ];
    tube(a, torso, rad, (i, s) => {
      const y = s.p.y;
      if (!cloth) return skin;
      if (y < hipY + .04 * H) return pants;
      if (y > neckY - .02 * H) return skin;
      return shirt;
    });
    yield { p: .2, label: 'торс' };

    const spread = P.hSpread, knee = P.hKnee, swing = P.hSwing;
    for (const side of [-1, 1]) {
      const sw = side * swing;
      const hipJ = tilt(V3(side * hipW * .52, hipY - .02 * H, 0));
      const upLen = .25 * H * legLen, loLen = .24 * H * legLen;
      let dUp = V3(side * Math.sin(spread * Math.PI / 180), -Math.cos(spread * Math.PI / 180), 0).normalize();
      dUp = rotX(dUp, sw);
      const kneeP = hipJ.clone().addScaledVector(dUp, upLen);
      let dLo = rotX(dUp, -knee * (sw > 0 ? .6 : 1.2));
      const ankle = kneeP.clone().addScaledVector(dLo, loLen);
      const thighW = .055 * H * (1 + .45 * build_ + .2 * mus), kneeW = .037 * H * (1 + .2 * build_), ankleW = .025 * H;
      tube(a, [
        { p: hipJ, w: thighW * 1.1, d: thighW * 1.05 },
        { p: hipJ.clone().addScaledVector(dUp, upLen * .45), w: thighW, d: thighW * .95 },
        { p: kneeP, w: kneeW, d: kneeW },
        { p: kneeP.clone().addScaledVector(dLo, loLen * .3), w: kneeW * 1.12, d: kneeW * 1.15 },
        { p: ankle, w: ankleW, d: ankleW }
      ], rad, (i, s) => cloth ? (s.p.y > kneeP.y - .02 ? pants : pants) : skin);
      const footDir = rotX(V3(0, 0, 1), 0);
      box(a, ankle.x, ankle.y - .022 * H, ankle.z + .05 * H, ankleW * 2.1, .045 * H, .13 * H, cloth ? shoe : skin);
      yield { p: .35 + (side > 0 ? .1 : 0), label: 'ноги' };
    }
    for (const side of [-1, 1]) {
      const sw = -side * swing * .8;
      const shJ = tilt(V3(side * sh * .93, shoulderY - .012 * H, 0));
      const upLen = .17 * H * armLen, loLen = .155 * H * armLen;
      const ang = P.hArm * Math.PI / 180;
      let dUp = V3(side * Math.cos(ang), -Math.sin(ang), 0).normalize();
      dUp = rotX(dUp, sw);
      const elbow = shJ.clone().addScaledVector(dUp, upLen);
      let dLo = rotX(dUp, -P.hElbow);
      const wrist = elbow.clone().addScaledVector(dLo, loLen);
      const delW = .038 * H * (1 + .5 * mus + .25 * build_), elW = .028 * H * (1 + .25 * mus), wrW = .021 * H;
      tube(a, [
        { p: shJ, w: delW * 1.15, d: delW * 1.15 },
        { p: shJ.clone().addScaledVector(dUp, upLen * .5), w: delW, d: delW * .95 },
        { p: elbow, w: elW, d: elW },
        { p: elbow.clone().addScaledVector(dLo, loLen * .35), w: elW * .95, d: elW },
        { p: wrist, w: wrW, d: wrW * .8 }
      ], rad, (i, s) => (cloth && s.p.y > elbow.y - .01) ? shirt : skin);
      const hand = wrist.clone().addScaledVector(dLo, .055 * H);
      tube(a, [{ p: wrist, w: wrW * .95, d: wrW * .7 }, { p: hand, w: wrW * 1.15, d: wrW * .5 }, { p: hand.clone().addScaledVector(dLo, .02 * H), w: wrW * .8, d: wrW * .35 }], Math.max(6, rad - 2), () => skin);
      yield { p: .55 + (side > 0 ? .1 : 0), label: 'руки' };
    }
    const hw = .047 * H * headS, hd = .054 * H * headS;
    const headBase = tilt(V3(0, chinY, 0));
    const headSt = [
      { p: headBase, w: hw * .58, d: hd * .62 },
      { p: tilt(V3(0, chinY + .028 * H * headS, 0)), w: hw * .92, d: hd * .95 },
      { p: tilt(V3(0, chinY + .062 * H * headS, 0)), w: hw, d: hd },
      { p: tilt(V3(0, chinY + .095 * H * headS, 0)), w: hw * .96, d: hd * .94 },
      { p: tilt(V3(0, chinY + .118 * H * headS, 0)), w: hw * .66, d: hd * .66 },
      { p: tilt(V3(0, crownY, 0)), w: hw * .16, d: hd * .16 }
    ];
    tube(a, headSt, rad, () => skin);
    if (P.hHairOn) {
      tube(a, headSt.slice(2).map(s => ({ p: s.p.clone().add(V3(0, .004 * H, -.002 * H)), w: s.w * 1.09, d: s.d * 1.09 })), rad, () => hair);
    }
    const eyeY = chinY + .066 * H * headS, eyeZ = hd * .86;
    box(a, 0, chinY + .045 * H * headS, eyeZ * .98, hw * .22, .022 * H * headS, .018 * H, skin);
    yield { p: .8, label: 'голова' };

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(a.c, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(a.i), 1));
    g.computeBoundingSphere();
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    if (eyes) { group.remove(eyes); eyes.geometry.dispose(); }
    const eg = new THREE.SphereGeometry(.009 * H * headS, 10, 8);
    const e1 = eg.clone().translate(-hw * .38, eyeY, eyeZ);
    const e2 = eg.clone().translate(hw * .38, eyeY, eyeZ);
    const merged = new THREE.BufferGeometry();
    const pa = e1.attributes.position.array, pb = e2.attributes.position.array;
    const na = e1.attributes.normal.array, nb = e2.attributes.normal.array;
    const ia = e1.index.array, ib = e2.index.array, off = pa.length / 3;
    const pp = new Float32Array(pa.length + pb.length); pp.set(pa); pp.set(pb, pa.length);
    const nn = new Float32Array(na.length + nb.length); nn.set(na); nn.set(nb, na.length);
    const ii = new Uint32Array(ia.length + ib.length); ii.set(ia);
    for (let i = 0; i < ib.length; i++) ii[ia.length + i] = ib[i] + off;
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    merged.setIndex(new THREE.BufferAttribute(ii, 1));
    eg.dispose(); e1.dispose(); e2.dispose();
    eyes = new THREE.Mesh(merged, eyeMat); eyes.frustumCulled = false; group.add(eyes);

    stats.tris = g.index.count / 3 + merged.index.count / 3;
    stats.verts = g.attributes.position.count + merged.attributes.position.count;
    stats.height = total; stats.ms = performance.now() - t0;
    yield { p: 1, label: 'человек готов' };
    return stats;
  }
  return { group, build, stats, mat, get mesh() { return mesh; }, get eyes() { return eyes; } };
}
