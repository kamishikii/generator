import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, mulberry32, makeNoise3D, fbm, ridged } from './noise.js';
import { windify } from './engine.js';
import { flowerTexture, canvas2d, toTex } from './textures.js';
import { createWaterMaterial } from './water.js';

export const DRY = -1e9;
export const PAINTS = [
  { k: 'grass', n: 'Трава', c: '#4e7a30' }, { k: 'dry', n: 'Сухая', c: '#8d8a45' },
  { k: 'dirt', n: 'Земля', c: '#6d5636' }, { k: 'rock', n: 'Камень', c: '#7c7a72' },
  { k: 'sand', n: 'Песок', c: '#c8b183' }, { k: 'snow', n: 'Снег', c: '#e9f1f3' },
  { k: 'moss', n: 'Мох', c: '#37642b' }
];

const STOCH = `
vec2 stHash(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
vec3 stTile(sampler2D t, vec2 uv, vec2 cell){
  vec2 h = stHash(cell);
  float ang = floor(h.x * 4.0) * 1.5707963;
  vec2 c = uv - cell - 0.5;
  float cs = cos(ang), sn = sin(ang);
  c = mat2(cs, -sn, sn, cs) * c;
  if (h.y > 0.5) c.x = -c.x;
  return texture2D(t, c + 0.5).rgb;
}
vec3 stoch(sampler2D t, vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec3 c00 = stTile(t, p, i);
  vec3 c10 = stTile(t, p, i + vec2(1.0, 0.0));
  vec3 c01 = stTile(t, p, i + vec2(0.0, 1.0));
  vec3 c11 = stTile(t, p, i + vec2(1.0, 1.0));
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(c00, c10, w.x), mix(c01, c11, w.x), w.y);
}
`;

function bladeGeometry() {
  const rows = [0, .3, .6, .82, 1], w = .012, pos = [], col = [], idx = [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i], hw = w * (1 - t * .92), z = .34 * t * t, sh = .40 + t * .85;
    if (i === rows.length - 1) { pos.push(0, t, z); col.push(sh * 1.22, sh * 1.1, sh * .68); }
    else { pos.push(-hw, t, z, hw, t, z); col.push(sh * .8, sh * .92, sh * .7, sh * .8, sh * .92, sh * .7); }
  }
  for (let i = 0; i < rows.length - 2; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const last = (rows.length - 2) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function crossGeo() {
  const a = new THREE.PlaneGeometry(1, 1); a.translate(0, .5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array, pb = b.attributes.position.array;
  const na = a.attributes.normal.array, nb = b.attributes.normal.array;
  const ua = a.attributes.uv.array, ub = b.attributes.uv.array;
  const ia = a.index.array, ib = b.index.array, off = pa.length / 3;
  const p = new Float32Array(pa.length + pb.length); p.set(pa); p.set(pb, pa.length);
  const n = new Float32Array(na.length + nb.length); n.set(na); n.set(nb, na.length);
  const u = new Float32Array(ua.length + ub.length); u.set(ua); u.set(ub, ua.length);
  const ix = new Uint16Array(ia.length + ib.length); ix.set(ia);
  for (let i = 0; i < ib.length; i++) ix[ia.length + i] = ib[i] + off;
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  g.setIndex(new THREE.BufferAttribute(ix, 1));
  a.dispose(); b.dispose(); return g;
}
function mark(attr, start, count) {
  try { if (attr.addUpdateRange) attr.addUpdateRange(start, count); } catch (e) {}
  attr.needsUpdate = true;
}

export function createTerrainSystem(U, groundTex, rockTex, mobile) {
  const group = new THREE.Group();
  const paintSize = mobile ? 512 : 1024;
  const paintCv = canvas2d(paintSize, paintSize);
  const paintCtx = paintCv.getContext('2d', { willReadFrequently: true });
  const paintTex = toTex(paintCv, true, false);
  paintTex.flipY = false;
  const landMat = new THREE.MeshStandardMaterial({
    map: paintTex, normalMap: groundTex.normalMap, normalScale: new THREE.Vector2(2.2, 2.2),
    vertexColors: true, roughness: 1, metalness: 0, dithering: true
  });
  const NL = String.fromCharCode(10);
  const LT = String.fromCharCode(60), GT = String.fromCharCode(62);
  const INC_COMMON = '#include ' + LT + 'common' + GT;
  const INC_MAP = '#include ' + LT + 'map_fragment' + GT;
  const INC_BEGIN = '#include ' + LT + 'begin_vertex' + GT;
  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteTex.needsUpdate = true;
  const detailU = { value: groundTex.map }, mixU = { value: 0 };
  const dispU = { value: whiteTex }, dispOn = { value: 0 };
  if (groundTex.ready) groundTex.ready.then(ok => { if (ok) mixU.value = 1; });
  new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'tex/ground_disp.jpg', dt => {
    dt.wrapS = dt.wrapT = THREE.RepeatWrapping;
    dispU.value = dt; dispOn.value = 1;
  }, undefined, () => {});
  landMat.onBeforeCompile = sh => {
    sh.uniforms.tDetail = detailU;
    sh.uniforms.uDetailMix = mixU;
    sh.uniforms.tDisp = dispU;
    sh.uniforms.uDispOn = dispOn;
    sh.vertexShader = sh.vertexShader
      .replace(INC_COMMON, INC_COMMON + NL + 'uniform sampler2D tDisp;' + NL + 'uniform float uDispOn;' + NL + STOCH)
      .replace(INC_BEGIN, INC_BEGIN + NL + 'transformed += normal * (stoch(tDisp, uv * 55.0).r - 0.5) * 0.18 * uDispOn;');
    sh.fragmentShader = sh.fragmentShader
      .replace(INC_COMMON, INC_COMMON + NL + 'uniform sampler2D tDetail;' + NL + 'uniform float uDetailMix;' + NL + 'uniform sampler2D tDisp;' + NL + 'uniform float uDispOn;' + NL + STOCH)
      .replace(INC_MAP, INC_MAP + NL + [
        'vec3 det = stoch(tDetail, vMapUv * 55.0) * 1.6;',
        'diffuseColor.rgb *= mix(vec3(1.0), det, uDetailMix);',
        'diffuseColor.rgb *= mix(1.0, 0.7 + 0.6 * stoch(tDisp, vMapUv * 55.0).r, uDispOn);'
      ].join(NL));
  };
  const grassMat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide }), U, { key: 'grass', base: 'instance', height: 'attr', flutter: .09, lodWidth: true });
  const flowerMat = windify(new THREE.MeshStandardMaterial({ map: flowerTexture(mobile ? 64 : 96), alphaTest: .4, side: THREE.DoubleSide, roughness: .7 }), U, { key: 'flower', base: 'instance', height: 'attr', flutter: .05 });
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex.map, normalMap: rockTex.normalMap, roughness: .95, color: 0xa8a8a0 });
  const twigMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, metalness: 0 });
  const waterMat = createWaterMaterial(U);

  let N = 0, size = 200, cell = 1;
  let h = null, wet = null, land = null, waterMesh = null;
  let grass = null, rocks = null, flowers = null, twigs = null;
  let noise = makeNoise3D(1);
  let paintDirty = false, waterBox = null, waterBudget = 0;
  const stats = { tris: 0, grass: 0, flowers: 0, rocks: 0, ms: 0, water: 0, wet: 0 };

  const gi = (i, j) => j * N + i;
  const wx = i => (i / (N - 1) - .5) * size;
  const wz = j => (j / (N - 1) - .5) * size;

  function heightAt(x, z) {
    if (!h) return 0;
    const fx = clamp((x / size + .5) * (N - 1), 0, N - 1.001), fz = clamp((z / size + .5) * (N - 1), 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = h[gi(i, j)], b = h[gi(i + 1, j)], c = h[gi(i, j + 1)], d = h[gi(i + 1, j + 1)];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  function normalAt(x, z) {
    const e = cell;
    return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  }
  function makeField(P) {
    const n = makeNoise3D(P.seed * 131 + 7);
    const s = 1 / Math.max(12, P.tscale), amp = P.relief, gain = lerp(.38, .62, P.tdetail);
    const raw = (x, z) => {
      const ux = x * s, uz = z * s;
      const qx = fbm(n, ux + 11.3, .5, uz + 3.7, 3), qz = fbm(n, ux - 4.1, 2.5, uz + 9.2, 3);
      const px = ux + .4 * qx, pz = uz + .4 * qz;
      let v = fbm(n, px, 0, pz, 5, 2.02, gain);
      v = v * .8 + (ridged(n, px * .5 + 3.1, 0, pz * .5 - 1.7, 3) - .55) * .5;
      v *= amp;
      v += fbm(n, x * .35, 5, z * .35, 2) * amp * .05;
      if (P.river) {
        const t = x / Math.max(30, P.tscale);
        const cz = P.riverOffset + Math.sin(t * 1.15) * P.riverMeander * 26 + fbm(n, t * .9, 3.3, 0, 3) * P.riverMeander * 34;
        const d = Math.abs(z - cz), w = Math.max(1.5, P.riverWidth);
        const carve = Math.exp(-Math.pow(d / (w * 1.45), 2));
        const bed = P.waterLevel - P.riverDepth;
        v = lerp(v, Math.min(v, bed), carve);
        const bank = Math.exp(-Math.pow(d / (w * 3.2), 2)) * (1 - carve);
        v = lerp(v, lerp(v, P.waterLevel + .35, .55), bank * .7);
      }
      return v;
    };
    const h0 = raw(0, 0), pad = Math.max(2, P.pad);
    return (x, z) => {
      const v = raw(x, z), d = Math.hypot(x, z);
      return d >= pad * 2.4 ? v : lerp(h0, v, smoothstep(pad * .7, pad * 2.4, d));
    };
  }
  function dispose(m) { if (!m) return; group.remove(m); if (m.isInstancedMesh) m.dispose(); if (m.geometry) m.geometry.dispose(); }

  function buildGrids(P, Q) {
    size = P.tsize;
    N = Math.round(lerp(72, Q.landSeg, P.landDetail)) + 1;
    cell = size / (N - 1);
    h = new Float32Array(N * N); wet = new Float32Array(N * N).fill(DRY);
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), col = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3);
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = gi(i, j);
      pos[v * 3] = wx(i); pos[v * 3 + 2] = wz(j);
      uv[v * 2] = i / (N - 1); uv[v * 2 + 1] = j / (N - 1);
      col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = 1;
      nor[v * 3 + 1] = 1;
      if (i < N - 1 && j < N - 1) {
        const a = v, b = v + 1, c = v + N, d = v + N + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    dispose(land);
    land = new THREE.Mesh(g, landMat);
    land.receiveShadow = true; land.frustumCulled = false; group.add(land);
    landMat.normalMap.repeat.set(55, 55);
    const wp = new Float32Array(N * N * 3), wd = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = gi(i, j); wp[v * 3] = wx(i); wp[v * 3 + 2] = wz(j); }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    wg.setAttribute('aDepth', new THREE.BufferAttribute(wd, 1));
    wg.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    if (waterMesh) { group.remove(waterMesh); waterMesh.geometry.dispose(); }
    waterMesh = new THREE.Mesh(wg, waterMat);
    waterMesh.frustumCulled = false; waterMesh.renderOrder = 3; group.add(waterMesh);
    stats.tris = idx.length / 3;
  }
  function refreshRows(i0, i1, j0, j1) {
    const g = land.geometry, pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
    const a = Math.max(0, i0 - 1), b = Math.min(N - 1, i1 + 1), c = Math.max(0, j0 - 1), d = Math.min(N - 1, j1 + 1);
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) {
      const v = gi(i, j);
      pos.array[v * 3 + 1] = h[v];
      const hl = h[gi(Math.max(0, i - 1), j)], hr = h[gi(Math.min(N - 1, i + 1), j)];
      const hd = h[gi(i, Math.max(0, j - 1))], hu = h[gi(i, Math.min(N - 1, j + 1))];
      let nx = hl - hr, ny = 2 * cell, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nor.array[v * 3] = nx; nor.array[v * 3 + 1] = ny; nor.array[v * 3 + 2] = nz;
      const lap = (hl + hr + hd + hu) * .25 - h[v];
      const shade = clamp(.66 + .34 * ny - clamp(lap * .12, -.18, .18), .35, 1.15);
      col.array[v * 3] = shade; col.array[v * 3 + 1] = shade; col.array[v * 3 + 2] = shade;
    }
    for (let j = c; j <= d; j++) {
      const s = (j * N + a) * 3, n = (b - a + 1) * 3;
      mark(pos, s, n); mark(nor, s, n); mark(col, s, n);
    }
    g.computeBoundingSphere();
  }
  function refreshWater(i0, i1, j0, j1) {
    if (!waterMesh) return;
    const g = waterMesh.geometry, pos = g.attributes.position, dep = g.attributes.aDepth;
    const a = Math.max(0, i0 - 1), b = Math.min(N - 1, i1 + 1), c = Math.max(0, j0 - 1), d = Math.min(N - 1, j1 + 1);
    let wetCount = 0;
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) {
      const v = gi(i, j), w = wet[v];
      const dp = w > DRY ? Math.max(0, w - h[v]) : 0;
      pos.array[v * 3 + 1] = dp > 0 ? w : h[v] - .06;
      dep.array[v] = dp;
      if (dp > .01) wetCount++;
    }
    for (let j = c; j <= d; j++) { mark(pos, (j * N + a) * 3, (b - a + 1) * 3); mark(dep, j * N + a, b - a + 1); }
    g.computeBoundingSphere();
    stats.wet = wetCount;
    stats.water = Math.round(wetCount / (N * N) * 100);
  }
  function boxUnion(a, b) {
    if (!a) return b; if (!b) return a;
    return { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) };
  }
  function* paintField(P) {
    const S = paintSize, im = paintCtx.createImageData(S, S), d = im.data;
    const c = new THREE.Color();
    for (let j = 0; j < S; j++) {
      const z = (j / (S - 1) - .5) * size;
      for (let i = 0; i < S; i++) {
        const x = (i / (S - 1) - .5) * size;
        const y = heightAt(x, z), ny = normalAt(x, z).y;
        const moist = fbm(noise, x * .035, 3, z * .035, 3) * .5 + .5;
        const dry = fbm(noise, x * .12, 9, z * .12, 2) * .5 + .5;
        const patch = fbm(noise, x * .06, 31, z * .06, 3) * .5 + .5;
        const rock = smoothstep(.86, .56, ny), soil = smoothstep(.96, .80, ny) * (1 - rock) * .6;
        c.setHSL(lerp(.21, .30, moist), lerp(.34, .56, moist), lerp(.24, .40, moist * .7 + dry * .3), THREE.SRGBColorSpace);
        let r = c.r, g = c.g, b = c.b;
        const sc = new THREE.Color().setHSL(.09, .30, .26 + dry * .08, THREE.SRGBColorSpace);
        r = lerp(r, sc.r, soil); g = lerp(g, sc.g, soil); b = lerp(b, sc.b, soil);
        const rc = new THREE.Color().setHSL(.08, .05, .30 + dry * .12, THREE.SRGBColorSpace);
        r = lerp(r, rc.r, rock); g = lerp(g, rc.g, rock); b = lerp(b, rc.b, rock);
        const bare = smoothstep(.5, .3, patch) * .55;
        r = lerp(r, .32, bare); g = lerp(g, .26, bare); b = lerp(b, .18, bare);
        if (P.water) {
          const sh = smoothstep(P.waterLevel + 1.1, P.waterLevel - .2, y);
          const wc = new THREE.Color().setHSL(.11, .26, .40, THREE.SRGBColorSpace);
          r = lerp(r, wc.r, sh * .8); g = lerp(g, wc.g, sh * .8); b = lerp(b, wc.b, sh * .8);
          const un = smoothstep(P.waterLevel, P.waterLevel - 3.5, y);
          r = lerp(r, .05, un); g = lerp(g, .13, un); b = lerp(b, .16, un);
        }
        const grain = .88 + .24 * (fbm(noise, x * 1.6, 71, z * 1.6, 2) * .5 + .5);
        const k = (j * S + i) * 4;
        const lin2srgb = v => Math.round(clamp(v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055, 0, 1) * 255);
        d[k] = lin2srgb(r * grain); d[k + 1] = lin2srgb(g * grain); d[k + 2] = lin2srgb(b * grain); d[k + 3] = 255;
      }
      if (j % 24 === 0) yield { p: .34 + .2 * (j / S), label: 'покров почвы' };
    }
    paintCtx.putImageData(im, 0, 0);
    paintTex.needsUpdate = true;
  }
  function* scatter(P, Q) {
    const rng = mulberry32((P.seed * 17 + 3) >>> 0);
    dispose(grass); grass = null;
    const R = Math.max(3, P.grassRadius);
    const areaK = clamp((R * R) / 256, 1, 4);
    const want = Math.min(Math.round(P.grassCount * 2.5 * areaK), Q.grassCap * 4);
    if (want > 0) {
      const bg = bladeGeometry(), gm = new THREE.InstancedMesh(bg, grassMat, want);
      const gc = new Float32Array(want * 3), gb = new Float32Array(want), gh = new Float32Array(want), ga = new Float32Array(want);
      const d = new THREE.Object3D(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const per = 16;
      let placed = 0, guard = 0;
      while (placed < want && guard < want * 6) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * R;
        const edge = clamp((R - rr) / (R * .3), 0, 1);
        if (rng() > edge * .92 + .08) continue;
        const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
        if (normalAt(cx, cz).y < .66) continue;
        const cy = heightAt(cx, cz);
        if (P.water && wet[gi(clamp(Math.round((cx / size + .5) * (N - 1)), 0, N - 1), clamp(Math.round((cz / size + .5) * (N - 1)), 0, N - 1))] > DRY) continue;
        const patch = fbm(noise, cx * .10, 21, cz * .10, 3) * .5 + .5;
        if (rng() > patch * 1.35) continue;
        for (let b = 0; b < per && placed < want; b++) {
          const ba = rng() * TAU, br = rng() * .3;
          const x = cx + Math.cos(ba) * br, z = cz + Math.sin(ba) * br, y = heightAt(x, z);
          const near = P.water ? clamp(1 - (y - P.waterLevel) / 1.6, 0, 1) : 0;
          d.position.set(x, y - .02, z);
          d.quaternion.setFromUnitVectors(up, normalAt(x, z));
          d.rotateY(rng() * TAU); d.rotateX((rng() - .5) * .4);
          const hgt = P.grassHeight * (.6 + rng() * .9) * lerp(.75, 1.2, patch) * (1 + near * .9);
          d.scale.set(hgt * (.85 + rng() * .5), hgt, hgt);
          d.updateMatrix(); gm.setMatrixAt(placed, d.matrix);
          const moist = fbm(noise, x * .035, 3, z * .035, 3) * .5 + .5;
          c.setHSL(lerp(.20, .31, moist) + (rng() - .5) * .06 * P.grassVar - near * .04,
            clamp(lerp(.38, .62, moist) + (rng() - .5) * .25 * P.grassVar, .15, .85),
            clamp(lerp(.30, .48, moist) * (.75 + rng() * .6), .12, .72), THREE.SRGBColorSpace);
          if (rng() < .22) c.setHSL(.11 + rng() * .06, .42 + rng() * .25, .30 + rng() * .2, THREE.SRGBColorSpace);
          gc[placed * 3] = c.r; gc[placed * 3 + 1] = c.g; gc[placed * 3 + 2] = c.b;
          gb[placed] = y; gh[placed] = hgt; ga[placed] = .985; placed++;
        }
        if (placed % 6000 < per) yield { p: .56 + .26 * (placed / want), label: 'трава' };
      }
      gm.count = placed;
      bg.setAttribute('aBase', new THREE.InstancedBufferAttribute(gb, 1));
      bg.setAttribute('aH', new THREE.InstancedBufferAttribute(gh, 1));
      bg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(ga, 1));
      gm.instanceColor = new THREE.InstancedBufferAttribute(gc, 3);
      gm.instanceMatrix.needsUpdate = true;
      gm.receiveShadow = true; gm.frustumCulled = false;
      group.add(gm); grass = gm; stats.grass = placed;
    } else stats.grass = 0;
    dispose(rocks); rocks = null;
    const nR = Math.round(P.rocks);
    if (nR > 0) {
      const rg = new THREE.IcosahedronGeometry(1, Q.rockDetail), rp = rg.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
        const k = 1 + fbm(noise, x * 1.7, y * 1.7, z * 1.7, 3) * .38;
        rp.setXYZ(i, x * k, y * k * .72, z * k);
      }
      rg.computeVertexNormals();
      const rm = new THREE.InstancedMesh(rg, rockMat, nR);
      const rc = new Float32Array(nR * 3), d = new THREE.Object3D(), c = new THREE.Color();
      for (let i = 0; i < nR; i++) {
        const a = rng() * TAU, rr = 4 + Math.sqrt(rng()) * size * .34;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr, s = .25 + rng() * 1.2;
        d.position.set(x, heightAt(x, z) - s * .26, z);
        d.rotation.set(rng() * .6, rng() * TAU, rng() * .6);
        d.scale.set(s * (.8 + rng() * .6), s * (.6 + rng() * .5), s * (.8 + rng() * .6));
        d.updateMatrix(); rm.setMatrixAt(i, d.matrix);
        c.setHSL(.09, .05, .30 + rng() * .24, THREE.SRGBColorSpace);
        rc[i * 3] = c.r; rc[i * 3 + 1] = c.g; rc[i * 3 + 2] = c.b;
      }
      rm.instanceColor = new THREE.InstancedBufferAttribute(rc, 3);
      rm.castShadow = true; rm.receiveShadow = true; rm.frustumCulled = false;
      group.add(rm); rocks = rm;
    }
    stats.rocks = nR;
    dispose(twigs); twigs = null;
    const nT = Math.round(P.rocks * 4) + 60;
    {
      const tg = new THREE.BoxGeometry(1, .05, .07);
      const tim = new THREE.InstancedMesh(tg, twigMat, nT);
      const tc = new Float32Array(nT * 3), d = new THREE.Object3D(), c = new THREE.Color();
      for (let i = 0; i < nT; i++) {
        const a = rng() * TAU, rr = Math.sqrt(rng()) * Math.max(8, P.grassRadius * 1.3);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        d.position.set(x, heightAt(x, z) + .02, z);
        d.rotation.set((rng() - .5) * .3, rng() * TAU, (rng() - .5) * .3);
        const s = .3 + rng() * 1.1; d.scale.set(s, .6 + rng(), .6 + rng());
        d.updateMatrix(); tim.setMatrixAt(i, d.matrix);
        c.setHSL(.08 + rng() * .04, .3 + rng() * .2, .16 + rng() * .14, THREE.SRGBColorSpace);
        tc[i * 3] = c.r; tc[i * 3 + 1] = c.g; tc[i * 3 + 2] = c.b;
      }
      tim.instanceColor = new THREE.InstancedBufferAttribute(tc, 3);
      tim.castShadow = true; tim.receiveShadow = true; tim.frustumCulled = false;
      group.add(tim); twigs = tim;
    }
    dispose(flowers); flowers = null;
    const nF = Math.round(P.flowers);
    if (nF > 0) {
      const fg = crossGeo(), fm = new THREE.InstancedMesh(fg, flowerMat, nF);
      const fc = new Float32Array(nF * 3), fb = new Float32Array(nF), fh = new Float32Array(nF), fa = new Float32Array(nF);
      const d = new THREE.Object3D(), c = new THREE.Color();
      const pal = [[.13, .6, .88], [.02, .4, .92], [.85, .38, .9], [0, 0, .97]];
      let placed = 0, guard = 0;
      while (placed < nF && guard < nF * 12) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * Math.max(6, P.grassRadius * 1.1);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (normalAt(x, z).y < .84) continue;
        const y = heightAt(x, z);
        if (fbm(noise, x * .13, 44, z * .13, 2) < .04) continue;
        d.position.set(x, y, z); d.rotation.set(0, rng() * TAU, (rng() - .5) * .2);
        const s = .18 + rng() * .2; d.scale.set(s, s * (1 + rng() * .6), s);
        d.updateMatrix(); fm.setMatrixAt(placed, d.matrix);
        const p = pal[(rng() * pal.length) | 0];
        c.setHSL(p[0], p[1], p[2] * (.72 + rng() * .28), THREE.SRGBColorSpace);
        fc[placed * 3] = c.r; fc[placed * 3 + 1] = c.g; fc[placed * 3 + 2] = c.b;
        fb[placed] = y; fh[placed] = s * 1.4; fa[placed] = .99; placed++;
      }
      fm.count = placed;
      fg.setAttribute('aBase', new THREE.InstancedBufferAttribute(fb, 1));
      fg.setAttribute('aH', new THREE.InstancedBufferAttribute(fh, 1));
      fg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(fa, 1));
      fm.instanceColor = new THREE.InstancedBufferAttribute(fc, 3);
      fm.instanceMatrix.needsUpdate = true; fm.frustumCulled = false;
      group.add(fm); flowers = fm; stats.flowers = placed;
    } else stats.flowers = 0;
  }
  function* build(P, Q, opts) {
    const t0 = performance.now();
    noise = makeNoise3D(P.seed * 977 + 5);
    const o = opts || {};
    if (o.grid || !h || N !== Math.round(lerp(72, Q.landSeg, P.landDetail)) + 1 || size !== P.tsize) buildGrids(P, Q);
    if (o.heights !== false) {
      const f = makeField(P);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) h[gi(i, j)] = f(wx(i), wz(j));
        if (j % 24 === 0) yield { p: .28 * (j / N), label: 'рельеф' };
      }
      wet.fill(DRY);
      if (P.water) for (let k = 0; k < N * N; k++) if (h[k] < P.waterLevel) wet[k] = P.waterLevel;
      refreshRows(0, N - 1, 0, N - 1);
      refreshWater(0, N - 1, 0, N - 1);
      for (let i = 0; i < 24; i++) relax(2, null);
      refreshWater(0, N - 1, 0, N - 1);
    }
    if (o.paint !== false) yield* paintField(P);
    if (o.veg !== false) yield* scatter(P, Q);
    waterMat.uniforms.uWaves.value = P.waves;
    waterMat.uniforms.uFlow.value.set(P.river ? 1 : .2, P.river ? .25 : .1);
    waterMesh.visible = P.water;
    stats.ms = performance.now() - t0;
    yield { p: 1, label: 'ландшафт готов' };
    return stats;
  }
  function sculpt(x, z, tool, radius, strength, hardness, dt, target) {
    const ci = (x / size + .5) * (N - 1), cj = (z / size + .5) * (N - 1);
    const ri = Math.ceil(radius / cell) + 1;
    const i0 = clamp(Math.floor(ci - ri), 0, N - 1), i1 = clamp(Math.ceil(ci + ri), 0, N - 1);
    const j0 = clamp(Math.floor(cj - ri), 0, N - 1), j1 = clamp(Math.ceil(cj + ri), 0, N - 1);
    if (i1 < i0 || j1 < j0) return null;
    const rate = strength * 9 * dt, expo = 1 + (1 - hardness) * 3.2;
    let touched = false, wtouch = false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = wx(i) - x, dz = wz(j) - z, d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const f = Math.pow(1 - d / radius, expo), v = gi(i, j);
      if (tool === 'raise') { h[v] = clamp(h[v] + rate * f, -160, 220); touched = true; }
      else if (tool === 'lower') { h[v] = clamp(h[v] - rate * f, -160, 220); touched = true; }
      else if (tool === 'smooth') {
        const s = (h[gi(Math.max(0, i - 1), j)] + h[gi(Math.min(N - 1, i + 1), j)] + h[gi(i, Math.max(0, j - 1))] + h[gi(i, Math.min(N - 1, j + 1))]) * .25;
        h[v] = lerp(h[v], s, clamp(strength * 7 * dt * f, 0, .9)); touched = true;
      } else if (tool === 'plateau') { h[v] = lerp(h[v], target, clamp(strength * 6 * dt * f, 0, .9)); touched = true; }
      else if (tool === 'water') {
        const base = wet[v] > DRY ? wet[v] : h[v];
        wet[v] = Math.min(base + strength * 5 * dt * f, h[v] + 26); wtouch = true;
      } else if (tool === 'dry') { if (wet[v] > DRY) { wet[v] = DRY; wtouch = true; } }
    }
    const box = { i0, i1, j0, j1 };
    if (touched) { refreshRows(i0, i1, j0, j1); waterBox = boxUnion(waterBox, box); waterBudget = 260; }
    if (wtouch || touched) { waterBox = boxUnion(waterBox, box); waterBudget = 260; }
    return box;
  }
  function relax(iters, box) {
    const b = box || { i0: 1, i1: N - 2, j0: 1, j1: N - 2 };
    const i0 = Math.max(1, b.i0 - 2), i1 = Math.min(N - 2, b.i1 + 2), j0 = Math.max(1, b.j0 - 2), j1 = Math.min(N - 2, b.j1 + 2);
    let change = 0;
    for (let it = 0; it < iters; it++) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = gi(i, j);
        if (wet[v] <= DRY) continue;
        let s = wet[v], sum = s, cnt = 1;
        const nb = [v - 1, v + 1, v - N, v + N];
        for (const q of nb) {
          if (wet[q] > DRY) { sum += wet[q]; cnt++; }
          else if (s > h[q] + .02) { wet[q] = h[q] + (s - h[q]) * .45; change += .01; }
        }
        let t = lerp(s, sum / cnt, .42);
        t = Math.max(t, h[v]);
        if (t - h[v] < .006) { wet[v] = DRY; change += .02; }
        else { change += Math.abs(t - s); wet[v] = t; }
      }
    }
    return change;
  }
  function tickWater() {
    if (waterBudget <= 0 || !waterBox) return false;
    const ch = relax(2, waterBox);
    refreshWater(waterBox.i0, waterBox.i1, waterBox.j0, waterBox.j1);
    waterBox = { i0: Math.max(0, waterBox.i0 - 1), i1: Math.min(N - 1, waterBox.i1 + 1), j0: Math.max(0, waterBox.j0 - 1), j1: Math.min(N - 1, waterBox.j1 + 1) };
    waterBudget -= ch < .02 ? 40 : 1;
    if (waterBudget <= 0) waterBox = null;
    return true;
  }
  function paint(x, z, radius, strength, hardness, hex, px, pz) {
    const S = paintSize, sc = S / size;
    const cx = (x / size + .5) * S, cy = (z / size + .5) * S, r = Math.max(2, radius * sc);
    const steps = px == null ? 1 : Math.max(1, Math.ceil(Math.hypot(cx - px, cy - pz) / (r * .35)));
    paintCtx.save();
    for (let s = 0; s < steps; s++) {
      const t = steps === 1 ? 1 : s / (steps - 1);
      const gx = px == null ? cx : lerp(px, cx, t), gy = pz == null ? cy : lerp(pz, cy, t);
      const g = paintCtx.createRadialGradient(gx, gy, 0, gx, gy, r);
      const c = new THREE.Color(hex);
      const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
      const a = clamp(strength * .5, .02, .9);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(clamp(hardness, .05, .95), `rgba(${rgb},${a * .55})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      paintCtx.fillStyle = g;
      paintCtx.beginPath(); paintCtx.arc(gx, gy, r, 0, TAU); paintCtx.fill();
    }
    paintCtx.restore();
    paintDirty = true;
    return { cx, cy };
  }
  function flushPaint() { if (paintDirty) { paintTex.needsUpdate = true; paintDirty = false; } }
  function refreshVeg(box) {
    if (!box) return;
    const x0 = wx(Math.max(0, box.i0 - 1)), x1 = wx(Math.min(N - 1, box.i1 + 1));
    const z0 = wz(Math.max(0, box.j0 - 1)), z1 = wz(Math.min(N - 1, box.j1 + 1));
    const m = new THREE.Matrix4();
    for (const im of [grass, flowers]) {
      if (!im) continue;
      const base = im.geometry.attributes.aBase;
      let ch = false;
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, m);
        const x = m.elements[12], z = m.elements[14];
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const y = heightAt(x, z);
        const i = clamp(Math.round((x / size + .5) * (N - 1)), 0, N - 1), j = clamp(Math.round((z / size + .5) * (N - 1)), 0, N - 1);
        const under = wet[gi(i, j)] > DRY && wet[gi(i, j)] > y + .05;
        if (under) { const s = 0; m.elements[0] = s; m.elements[5] = s; m.elements[10] = s; }
        else if (m.elements[5] === 0) { im.getMatrixAt(k, m); }
        m.elements[13] = y - .02;
        base.array[k] = y;
        im.setMatrixAt(k, m); ch = true;
      }
      if (ch) { im.instanceMatrix.needsUpdate = true; base.needsUpdate = true; }
    }
  }
  function flood(level) {
    for (let k = 0; k < N * N; k++) if (h[k] < level) wet[k] = Math.max(wet[k] > DRY ? wet[k] : DRY, level);
    waterBox = { i0: 0, i1: N - 1, j0: 0, j1: N - 1 }; waterBudget = 200;
    refreshWater(0, N - 1, 0, N - 1);
  }
  function drain() { wet.fill(DRY); waterBox = null; waterBudget = 0; refreshWater(0, N - 1, 0, N - 1); }
  function snapshot(withPaint) {
    return { h: h.slice(), wet: wet.slice(), paint: withPaint ? paintCtx.getImageData(0, 0, paintSize, paintSize) : null, N, size };
  }
  function restore(s) {
    if (!s || s.N !== N || s.size !== size) return false;
    h.set(s.h); wet.set(s.wet);
    if (s.paint) { paintCtx.putImageData(s.paint, 0, 0); paintTex.needsUpdate = true; }
    refreshRows(0, N - 1, 0, N - 1); refreshWater(0, N - 1, 0, N - 1);
    refreshVeg({ i0: 0, i1: N - 1, j0: 0, j1: N - 1 });
    return true;
  }
  return {
    group, stats, build, heightAt, normalAt, sculpt, paint, flushPaint, tickWater, refreshVeg, flood, drain,
    snapshot, restore, relax, refreshWater, refreshRows,
    materials: { landMat, grassMat, rockMat, flowerMat, waterMat },
    get land() { return land; }, get waterMesh() { return waterMesh; },
    get grass() { return grass; }, get rocks() { return rocks; }, get flowers() { return flowers; },
    get N() { return N; }, get size() { return size; }, get paintTex() { return paintTex; },
    setWire(v) { landMat.wireframe = v; grassMat.wireframe = v; rockMat.wireframe = v; flowerMat.wireframe = v; },
    setWater(v) { if (waterMesh) waterMesh.visible = v; },
    setWaves(v) { waterMat.uniforms.uWaves.value = v; }
  };
}
