import * as THREE from 'three';
import { clamp, lerp, TAU, mulberry32, makeNoise3D } from './noise.js';
import { skinTextures, hairTextures, eyeTexture } from './textures.js';

export const HUMAN_POSES = [
  { k: 'apose', n: 'А-поза' },
  { k: 'tpose', n: 'Т-поза' },
  { k: 'relax', n: 'Расслаблен' },
  { k: 'walk', n: 'Шаг' },
  { k: 'sit', n: 'Сидя' }
];

const POSE_ADD = {
  apose: {},
  tpose: { arm: 45 },
  relax: { arm: -32, elbow: 10, spread: -2, knee: 4 },
  walk: { swing: 24, elbow: 14, spread: 3, knee: 14 },
  sit: { knee: 78, hip: 78, arm: -20, elbow: 30 }
};

/* ---------- SDF primitives ---------- */
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function sdEll(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  return (len3(x, y, z) - 1) * Math.min(rx, ry, rz);
}
function sdCap(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = clamp((apx * abx + apy * aby + apz * abz) / d, 0, 1);
  return len3(apx - abx * t, apy - aby * t, apz - abz * t) - r;
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; };
const smax = (a, b, k) => -smin(-a, -b, k);

/* ---------- surface nets (smooth watertight isosurface) ---------- */
function nets(field, x0, x1, y0, y1, z0, z1, nx, ny, nz, mapY) {
  const xs = new Float32Array(nx), ys = new Float32Array(ny), zs = new Float32Array(nz);
  for (let i = 0; i < nx; i++) xs[i] = lerp(x0, x1, i / (nx - 1));
  for (let j = 0; j < ny; j++) ys[j] = mapY ? mapY(j / (ny - 1)) : lerp(y0, y1, j / (ny - 1));
  for (let k = 0; k < nz; k++) zs[k] = lerp(z0, z1, k / (nz - 1));
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    val[i + j * nx + k * nx * ny] = field(xs[i], ys[j], zs[k]);
  const at = (i, j, k) => val[i + j * nx + k * nx * ny];
  const cw = nx - 1, ch = ny - 1, cd = nz - 1;
  const cv = new Int32Array(cw * ch * cd).fill(-1);
  const masks = new Uint8Array(cw * ch * cd);
  const pos = [], idx = [];
  const EX = [0, 1, 0, 1, 0, 1, 0, 1], EY = [0, 0, 1, 1, 0, 0, 1, 1], EZ = [0, 0, 0, 0, 1, 1, 1, 1];
  const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < cd; k++) for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const c = [at(i, j, k), at(i + 1, j, k), at(i, j + 1, k), at(i + 1, j + 1, k), at(i, j, k + 1), at(i + 1, j, k + 1), at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1)];
    let m = 0; for (let n = 0; n < 8; n++) if (c[n] < 0) m |= 1 << n;
    if (m === 0 || m === 255) continue;
    masks[i + j * cw + k * cw * ch] = m;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (const [a, b] of ED) if ((c[a] < 0) !== (c[b] < 0)) {
      const t = c[a] / (c[a] - c[b]);
      px += lerp(xs[i + EX[a]], xs[i + EX[b]], t);
      py += lerp(ys[j + EY[a]], ys[j + EY[b]], t);
      pz += lerp(zs[k + EZ[a]], zs[k + EZ[b]], t);
      cnt++;
    }
    cv[i + j * cw + k * cw * ch] = pos.length / 3;
    pos.push(px / cnt, py / cnt, pz / cnt);
  }
  const CV = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cw || j >= ch || k >= cd) ? -1 : cv[i + j * cw + k * cw * ch];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < cd; k++) for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const m = masks[i + j * cw + k * cw * ch]; if (!m) continue;
    const v0 = CV(i, j, k), inside = (m & 1) !== 0;
    if (((m & 1) !== (m & 2)) && j > 0 && k > 0) quad(v0, CV(i, j - 1, k), CV(i, j - 1, k - 1), CV(i, j, k - 1), inside);
    if (((m & 1) !== (m & 4)) && i > 0 && k > 0) quad(v0, CV(i, j, k - 1), CV(i - 1, j, k - 1), CV(i - 1, j, k), inside);
    if (((m & 1) !== (m & 16)) && i > 0 && j > 0) quad(v0, CV(i - 1, j, k), CV(i - 1, j - 1, k), CV(i, j - 1, k), inside);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function merge(gs) {
  let vc = 0, ic = 0;
  for (const g of gs) { vc += g.attributes.position.count; ic += g.index.count; }
  const p = new Float32Array(vc * 3), n = new Float32Array(vc * 3), u = new Float32Array(vc * 2), ix = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of gs) {
    p.set(g.attributes.position.array, vo * 3);
    n.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) u.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let t = 0; t < gi.length; t++) ix[io + t] = gi[t] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  g.setIndex(new THREE.BufferAttribute(ix, 1));
  return g;
}

export function createHuman(U, ...rest) {
  const mobile = rest.find(a => typeof a === 'boolean') ?? (typeof matchMedia === 'function' && matchMedia('(max-width:960px)').matches);
  const group = new THREE.Group();
  const stats = { height: 1.8, verts: 0, tris: 0, ms: 0 };
  const skinTex = skinTextures(makeNoise3D(777), 256);
  const hairTex = hairTextures(makeNoise3D(313), 256);
  skinTex.map.anisotropy = 8; skinTex.normalMap.anisotropy = 8;
  hairTex.map.anisotropy = 8; hairTex.normalMap.anisotropy = 8;

  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xc98d63, map: skinTex.map, normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(.35, .35), roughness: .5, metalness: 0,
    sheen: .5, sheenRoughness: .55, sheenColor: new THREE.Color(0xffc9a8),
    side: THREE.DoubleSide
  });
  skinMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       float sssRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
       totalEmissiveRadiance += diffuseColor.rgb * sssRim * 0.10;`);
  };
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b1d16, map: hairTex.map, normalMap: hairTex.normalMap,
    normalScale: new THREE.Vector2(.6, .6), roughness: .38, metalness: 0,
    sheen: .9, sheenRoughness: .32, sheenColor: new THREE.Color(0x8a6a4a),
    side: THREE.DoubleSide
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf2ece6, roughness: .12, metalness: 0 });
  const irisMat = new THREE.MeshStandardMaterial({ map: eyeTexture(128, '#5b7f9a'), roughness: .1, metalness: 0 });
  const mats = [skinMat, hairMat, eyeMat, irisMat];

  function clear() {
    for (const c of [...group.children]) { group.remove(c); if (c.geometry) c.geometry.dispose(); }
  }

  function* build(P, Q) {
    const t0 = performance.now();
    clear();
    const rng = mulberry32(((P.seed || 1) * 131 + 7) >>> 0);
    const H = clamp(P.hHeight || 180, 120, 220) / 100;
    const fem = clamp(P.hFemale ?? .25, 0, 1);
    const buildK = clamp(P.hBuild ?? .3, 0, 1);
    const mus = clamp(P.hMuscle ?? .35, 0, 1);
    const detail = clamp(P.hDetail ?? 16, 6, 28);
    const face = clamp(P.hFace ?? 1, 0, 1);
    const pose = POSE_ADD[P.hPose] || {};
    const fat = .8 + buildK * .55;
    const muscle = .85 + mus * .4;

    const shoulderHalf = H * lerp(.115, .098, fem) * (P.hShoulders ?? 1) * muscle;
    const chestW = H * lerp(.105, .092, fem) * (P.hChest ?? 1) * fat;
    const chestD = H * lerp(.075, .082, fem) * fat;
    const waistW = H * lerp(.082, .075, fem) * (P.hWaist ?? 1) * fat;
    const waistD = H * lerp(.062, .066, fem) * fat;
    const hipW = H * lerp(.092, .108, fem) * (P.hHips ?? 1) * fat;
    const hipD = H * lerp(.068, .078, fem) * fat;
    const headK = (P.hHead ?? 1);
    const neckK = (P.hNeck ?? 1);
    const belly = clamp(P.hBelly ?? .1, 0, 1);
    const legK = (P.hLegs ?? 1);
    const armK = (P.hArms ?? 1);

    const hipY = .50 * H * legK + .02 * H;
    const waistY = .62 * H, chestY = .72 * H, shoulderY = .82 * H;
    const neckBase = .845 * H, headC = .93 * H;
    const lean = Math.tan(clamp((P.hLean ?? 0) + (pose.lean || 0), -30, 30) * Math.PI / 180);
    const cz = y => lean * Math.max(0, y - hipY);

    const armAb = clamp((P.hArm ?? 45) + (pose.arm || 0), -10, 95) * Math.PI / 180;
    const elbowB = clamp((P.hElbow ?? 8) + (pose.elbow || 0), 0, 120) * Math.PI / 180;
    const swing = clamp((P.hSwing ?? 0) + (pose.swing || 0), -60, 60) * Math.PI / 180;
    const spread = clamp((P.hSpread ?? 6) + (pose.spread || 0), -4, 30) * Math.PI / 180;
    const kneeB = clamp((P.hKnee ?? 3) + (pose.knee || 0), 0, 120) * Math.PI / 180;
    const hipB = (pose.hip || 0) * Math.PI / 180;

    const upperLen = H * .17 * armK, foreLen = H * .15 * armK;
    const thighLen = H * .24 * legK, shinLen = H * .22 * legK;

    const joints = [];
    for (const side of [-1, 1]) {
      const sx = side * shoulderHalf, sy = shoulderY, sz = cz(shoulderY);
      const d1 = [Math.sin(armAb) * side, -Math.cos(armAb), Math.sin(swing) * .6];
      const l1 = len3(...d1); const u1 = d1.map(v => v / l1);
      const ex = sx + u1[0] * upperLen, ey = sy + u1[1] * upperLen, ez = sz + u1[2] * upperLen;
      const d2 = [u1[0] * Math.cos(elbowB), u1[1] * Math.cos(elbowB), u1[2] * Math.cos(elbowB) + Math.sin(elbowB)];
      const l2 = len3(...d2); const u2 = d2.map(v => v / l2);
      const wx = ex + u2[0] * foreLen, wy = ey + u2[1] * foreLen, wz = ez + u2[2] * foreLen;
      const hx = side * hipW * .55, hy = hipY, hz = cz(hipY);
      const dl = [Math.sin(spread) * side, -Math.cos(spread) * Math.cos(hipB), -Math.sin(hipB) * .8];
      const ll = len3(...dl); const ul = dl.map(v => v / ll);
      const kx = hx + ul[0] * thighLen, ky = hy + ul[1] * thighLen, kz = hz + ul[2] * thighLen;
      const d2l = [ul[0] * Math.cos(kneeB), ul[1] * Math.cos(kneeB), ul[2] * Math.cos(kneeB) - Math.sin(kneeB)];
      const l2l = len3(...d2l); const u2l = d2l.map(v => v / l2l);
      const ax = kx + u2l[0] * shinLen, ay = ky + u2l[1] * shinLen, az = kz + u2l[2] * shinLen;
      joints.push({ side, sx, sy, sz, ex, ey, ez, wx, wy, wz, u2, hx, hy, hz, kx, ky, kz, ax, ay, az, u2l });
    }

    /* ----- body field ----- */
    const bodyField = (x, y, z) => {
      const zz = z - cz(y);
      let d = sdEll(x, y, zz, 0, hipY + .02 * H, 0, hipW, .085 * H, hipD);
      d = smin(d, sdEll(x, y, zz, 0, waistY, 0, waistW, .07 * H, waistD), .05 * H);
      d = smin(d, sdEll(x, y, zz, 0, chestY, 0, chestW, .09 * H, chestD), .05 * H);
      d = smin(d, sdCap(x, y, zz, -shoulderHalf * .8, shoulderY, 0, shoulderHalf * .8, shoulderY, 0, .045 * H * muscle), .04 * H);
      d = smin(d, sdCap(x, y, zz, 0, neckBase - .02 * H, 0, 0, headC - .05 * H, .005 * H, .042 * H * neckK), .03 * H);
      d = smin(d, sdEll(x, y, zz, 0, waistY - .01 * H, waistD * .55, waistW * .8, .06 * H, waistD * (.5 + belly * .9)), .04 * H);
      for (const s of [-1, 1]) {
        d = smin(d, sdEll(x, y, zz, s * hipW * .45, hipY - .01 * H, -hipD * .5, hipW * .5, .075 * H, hipD * .6), .04 * H);
        if (fem > .35) d = smin(d, sdEll(x, y, zz, s * chestW * .45, chestY - .015 * H, chestD * .72, chestW * .42, .05 * H * fem, chestD * .5 * fem), .03 * H);
        else if (mus > .4) d = smin(d, sdEll(x, y, zz, s * chestW * .45, chestY - .01 * H, chestD * .68, chestW * .4, .035 * H * mus, chestD * .3 * mus), .03 * H);
      }
      if (mus > .45) for (let i = 0; i < 3; i++)
        d = smin(d, sdEll(x, y, zz, 0, waistY + .02 * H + i * .035 * H, waistD * .62, waistW * .5, .016 * H, .012 * H * mus), .02 * H);
      for (const j of joints) {
        d = smin(d, sdEll(x, y, z, j.sx, j.sy, j.sz, .052 * H * muscle, .06 * H * muscle, .05 * H * muscle), .03 * H);
        d = smin(d, sdCap(x, y, z, j.sx, j.sy, j.sz, j.ex, j.ey, j.ez, .040 * H * muscle * fat), .025 * H);
        d = smin(d, sdCap(x, y, z, j.ex, j.ey, j.ez, j.wx, j.wy, j.wz, .031 * H * fat), .02 * H);
        d = smin(d, sdEll(x, y, z, j.ex + j.u2[0] * foreLen * .3, j.ey + j.u2[1] * foreLen * .3, j.ez + j.u2[2] * foreLen * .3 - .008 * H, .034 * H * muscle, .04 * H * muscle, .034 * H * muscle), .02 * H);
        d = smin(d, sdCap(x, y, z, j.hx, j.hy, j.hz, j.kx, j.ky, j.kz, .068 * H * fat), .03 * H);
        d = smin(d, sdCap(x, y, z, j.kx, j.ky, j.kz, j.ax, j.ay, j.az, .045 * H * fat), .025 * H);
        d = smin(d, sdEll(x, y, z, j.kx - j.u2l[0] * shinLen * .3, j.ky - j.u2l[1] * shinLen * .3 + .02 * H, j.kz - j.u2l[2] * shinLen * .3 - .012 * H, .04 * H * muscle, .055 * H * muscle, .045 * H * muscle), .025 * H);
        d = smin(d, sdEll(x, y, z, j.kx, j.ky, j.kz + .01 * H, .04 * H, .04 * H, .04 * H), .02 * H);
      }
      /* head */
      const hz0 = cz(headC);
      let h = sdEll(x, y, z, 0, headC, hz0, .072 * H * headK, .092 * H * headK, .082 * H * headK);
      h = smin(h, sdEll(x, y, z, 0, headC - .045 * H * headK, hz0 + .018 * H * headK, .052 * H * headK, .048 * H * headK, .055 * H * headK), .02 * H);
      h = smin(h, sdEll(x, y, z, 0, headC - .075 * H * headK, hz0 + .030 * H * headK, .020 * H * headK, .016 * H * headK, .018 * H * headK), .012 * H);
      if (face > .15) {
        h = smin(h, sdEll(x, y, z, 0, headC - .012 * H * headK, hz0 + .078 * H * headK, .014 * H * headK, .022 * H * headK, .016 * H * headK * face), .008 * H);
        h = smin(h, sdEll(x, y, z, 0, headC - .040 * H * headK, hz0 + .072 * H * headK, .020 * H * headK, .008 * H * headK, .010 * H * headK * face), .006 * H);
        h = smin(h, sdEll(x, y, z, 0, headC - .052 * H * headK, hz0 + .070 * H * headK, .016 * H * headK, .007 * H * headK, .009 * H * headK * face), .005 * H);
        h = smin(h, sdEll(x, y, z, 0, headC + .028 * H * headK, hz0 + .066 * H * headK, .048 * H * headK, .010 * H * headK, .014 * H * headK * face), .008 * H);
        for (const s of [-1, 1]) {
          h = smin(h, sdEll(x, y, z, s * .045 * H * headK, headC - .020 * H * headK, hz0 + .052 * H * headK, .020 * H * headK, .022 * H * headK, .018 * H * headK), .01 * H);
          h = smin(h, sdEll(x, y, z, s * .072 * H * headK, headC - .005 * H * headK, hz0 - .004 * H, .008 * H * headK, .020 * H * headK, .014 * H * headK), .006 * H);
          h = smax(h, -sdEll(x, y, z, s * .030 * H * headK, headC + .008 * H * headK, hz0 + .068 * H * headK, .016 * H * headK, .012 * H * headK, .012 * H * headK), .006 * H);
        }
        h = smax(h, -sdEll(x, y, z, 0, headC - .046 * H * headK, hz0 + .078 * H * headK, .014 * H * headK, .004 * H * headK, .006 * H * headK), .004 * H);
      }
      d = smin(d, h, .015 * H);
      d = smax(d, -sdEll(x, y, z, 0, waistY + .01 * H, waistD * .95, .006 * H, .008 * H, .006 * H), .004 * H);
      return d;
    };

    const resK = mobile ? .8 : 1;
    const nx = Math.round((48 + detail * 1.5) * resK), ny = Math.round((120 + detail * 2) * resK), nz = Math.round((40 + detail) * resK);
    const mapY = v => v < .62 ? (v / .62) * neckBase : neckBase + ((v - .62) / .38) * (H * 1.02 - neckBase);
    const bodyGeo = nets(bodyField, -.62 * H, .62 * H, 0, H * 1.02, -.26 * H, .26 * H, nx, ny, nz, mapY);
    yield { p: .45, label: 'анатомия' };

    /* ----- hands & feet (local high-res nets) ----- */
    const handField = (x, y, z) => {
      let d = sdEll(x, y, z, 0, -.030 * H, 0, .030 * H, .042 * H, .014 * H);
      const fl = [.030, .036, .034, .028].map(v => v * H);
      for (let i = 0; i < 4; i++) {
        const fx = (-.021 + i * .014) * H;
        d = smin(d, sdCap(x, y, z, fx, -.062 * H, 0, fx, -.062 * H - fl[i], .004 * H, .0062 * H), .004 * H);
        d = smin(d, sdCap(x, y, z, fx, -.062 * H - fl[i], .004 * H, fx, -.062 * H - fl[i] * 1.55, .008 * H, .0052 * H), .003 * H);
      }
      d = smin(d, sdCap(x, y, z, -.028 * H, -.030 * H, .006 * H, -.048 * H, -.052 * H, .016 * H, .007 * H), .004 * H);
      d = smin(d, sdCap(x, y, z, -.048 * H, -.052 * H, .016 * H, -.058 * H, -.066 * H, .022 * H, .0058 * H), .003 * H);
      d = smin(d, sdCap(x, y, z, 0, .012 * H, 0, 0, -.01 * H, 0, .020 * H), .008 * H);
      return d;
    };
    const footField = (x, y, z) => {
      let d = sdEll(x, y, z, 0, .020 * H, -.020 * H, .026 * H, .026 * H, .034 * H);
      d = smin(d, sdEll(x, y, z, 0, .012 * H, .030 * H, .028 * H, .016 * H, .060 * H), .010 * H);
      d = smin(d, sdEll(x, y, z, 0, .008 * H, .085 * H, .030 * H, .010 * H, .022 * H), .006 * H);
      for (let i = 0; i < 5; i++) {
        const tx = (-.022 + i * .011) * H, tr = (i === 0 ? .009 : .006) * H;
        d = smin(d, sdCap(x, y, z, tx, .008 * H, .098 * H, tx, .007 * H, .112 * H - Math.abs(i - 1) * .004 * H, tr), .003 * H);
      }
      d = smin(d, sdCap(x, y, z, 0, .05 * H, -.01 * H, 0, .02 * H, -.015 * H, .020 * H), .010 * H);
      return d;
    };
    const extrem = [];
    for (const j of joints) {
      const hg = nets(handField, -.07 * H, .07 * H, -.14 * H, .03 * H, -.04 * H, .04 * H, 34, 44, 22);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...j.u2));
      m.compose(new THREE.Vector3(j.wx, j.wy, j.wz), q, new THREE.Vector3(j.side, 1, 1));
      hg.applyMatrix4(m); extrem.push(hg);
      const fg = nets(footField, -.05 * H, .05 * H, -.01 * H, .08 * H, -.07 * H, .13 * H, 30, 26, 40);
      const fm = new THREE.Matrix4();
      const fq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(j.u2l[0] * .2, -0.15, 1).normalize());
      fm.compose(new THREE.Vector3(j.ax, j.ay + .01 * H, j.az), fq, new THREE.Vector3(1, 1, 1));
      fg.applyMatrix4(fm); extrem.push(fg);
    }
    yield { p: .62, label: 'кисти и стопы' };

    const skinGeo = merge([bodyGeo, ...extrem]);
    skinMat.color.set(P.hSkin || '#c98d63');
    const skinMesh = new THREE.Mesh(skinGeo, skinMat);
    skinMesh.castShadow = true; skinMesh.receiveShadow = true; skinMesh.frustumCulled = false;
    group.add(skinMesh);

    /* ----- eyes ----- */
    const hz0 = cz(headC);
    const eyeGeos = [], irisGeos = [];
    for (const s of [-1, 1]) {
      const ex = s * .030 * H * headK, ey = headC + .008 * H * headK, ez = hz0 + .062 * H * headK;
      const eg = new THREE.SphereGeometry(.0135 * H * headK, 16, 12);
      eg.translate(ex, ey, ez); eyeGeos.push(eg);
      const ig = new THREE.CircleGeometry(.0062 * H * headK, 20);
      ig.translate(ex, ey, ez + .0122 * H * headK); irisGeos.push(ig);
    }
    irisMat.map = eyeTexture(128, P.hIris || '#5b7f9a');
    irisMat.needsUpdate = true;
    const eyeMesh = new THREE.Mesh(merge(eyeGeos), eyeMat);
    const irisMesh = new THREE.Mesh(merge(irisGeos), irisMat);
    eyeMesh.frustumCulled = false; irisMesh.frustumCulled = false;
    group.add(eyeMesh, irisMesh);

    /* ----- hair: scalp + real strands ----- */
    if (P.hHairOn !== false) {
      hairMat.color.set(P.hHair || '#2b1d16');
      hairMat.sheenColor.set(P.hHair || '#2b1d16').lerp(new THREE.Color(0xffffff), .38);
      const hr = { x: .075 * H * headK, y: .095 * H * headK, z: .085 * H * headK };
      const scalp = new THREE.SphereGeometry(1, 24, 16, 0, TAU, 0, 1.45);
      scalp.scale(hr.x * 1.04, hr.y * 1.04, hr.z * 1.04);
      scalp.translate(0, headC, hz0 - .004 * H);
      const strandGeos = [scalp];
      const longK = clamp(P.hLongHair ?? .2, 0, 1);
      const fringe = clamp(P.hFringe ?? .5, 0, 1);
      const count = mobile ? 240 : 480;
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < count; i++) {
        const u = rng() * 2 - 1, a = rng() * TAU, s = Math.sqrt(Math.max(0, 1 - u * u));
        const dir = new THREE.Vector3(Math.cos(a) * s, u, Math.sin(a) * s);
        if (dir.y < .18) continue;
        const front = dir.z > .5;
        if (front && dir.y < .55 && rng() > fringe) continue;
        const p0 = new THREE.Vector3(dir.x * hr.x * 1.03, headC + dir.y * hr.y * 1.03, hz0 + dir.z * hr.z * 1.03);
        const lenH = front ? .05 * H * (.6 + rng() * .7) : lerp(.05 * H, .32 * H, longK) * (.7 + rng() * .6);
        const end = p0.clone().add(new THREE.Vector3(dir.x * .02 * H, -lenH, dir.z * .02 * H - (front ? -.012 * H : .010 * H)));
        const mid = p0.clone().lerp(end, .5).addScaledVector(dir, .014 * H).add(new THREE.Vector3(0, 0, front ? .006 * H : -.006 * H));
        const curve = new THREE.CatmullRomCurve3([p0, p0.clone().lerp(mid, .4), mid, mid.clone().lerp(end, .6), end]);
        const tg = new THREE.TubeGeometry(curve, 5, (.0016 + rng() * .0012) * H / 1.8, 3, false);
        strandGeos.push(tg);
      }
      if (P.hBrows !== false) for (const s of [-1, 1]) {
        const bg = new THREE.BoxGeometry(.030 * H * headK, .005 * H * headK, .008 * H * headK);
        bg.rotateZ(s * -.12);
        bg.translate(s * .030 * H * headK, headC + .026 * H * headK, hz0 + .070 * H * headK);
        strandGeos.push(bg);
      }
      const hairMesh = new THREE.Mesh(merge(strandGeos), hairMat);
      hairMesh.castShadow = true; hairMesh.frustumCulled = false;
      group.add(hairMesh);
    }
    yield { p: .88, label: 'волосы' };

    let verts = 0, tris = 0;
    for (const c of group.children) { verts += c.geometry.attributes.position.count; tris += c.geometry.index.count / 3; }
    stats.height = H; stats.verts = verts; stats.tris = Math.round(tris);
    stats.ms = performance.now() - t0;
    yield { p: 1, label: 'фигура готова' };
    return stats;
  }

  return {
    group, stats, build, mat: skinMat,
    setWire(v) { for (const m of mats) m.wireframe = v; },
    materials: { skinMat, hairMat, eyeMat, irisMat }
  };
}
