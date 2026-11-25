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

function bladeGeometry() {
  const rows = [0, .38, .72, 1], w = .062, pos = [], col = [], idx = [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i], hw = w * (1 - t * .9), z = .30 * t * t, sh = .48 + t * .85;
    if (i === rows.length - 1) { pos.push(0, t, z); col.push(sh, sh * 1.06, sh * .92); }
    else { pos.push(-hw, t, z, hw, t, z); col.push(sh * .92, sh, sh * .82, sh * .92, sh, sh * .82); }
  }
  for (let i = 0; i < rows.length - 2; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push(4, 5, 6);
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
    map: paintTex, normalMap: groundTex.normalMap, normalScale: new THREE.Vector2(1.0, 1.0),
    vertexColors: true, roughness: 1, metalness: 0, dithering: true
  });
  /* фото-микродеталь земли: умножается поверх твоих биомов, когда ground_col.jpg загрузился */
  const detailU = { value: groundTex.map }, mixU = { value: 0 };
  if (groundTex.ready) groundTex.ready.then(ok => { if (ok) mixU.value = 1; });
  landMat.onBeforeCompile = sh => {
    sh.uniforms.tDetail = detailU;
    sh.uniforms.uDetailMix = mixU;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDetail;\nuniform float uDetailMix;')
      .replace('#include <map_fragment>',
        '#include <map_fragment>\nvec3 det = texture2D(tDetail, vMapUv * 90.0).rgb * 1.8;\ndiffuseColor.rgb *= mix(vec3(1.0), det, uDetailMix);');
  };
  const grassMat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide }), U, { key: 'grass', base: 'instance', height: 'attr', flutter: .09 });
  const flowerMat = windify(new THREE.MeshStandardMaterial({ map: flowerTexture(mobile ? 64 : 96), alphaTest: .4, side: THREE.DoubleSide, roughness: .7 }), U, { key: 'flower', base: 'instance', height: 'attr', flutter: .05 });
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex.map, normalMap: rockTex.normalMap, roughness: .95, color: 0xa8a8a0 });
  const waterMat = createWaterMaterial(U);

  let N = 0, size = 200, cell = 1;
  let h = null, wet = null, land = null, waterMesh = null;
  let grass = null, rocks = null, flowers = null;
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
    landMat.normalMap.repeat.set(size / 3.2, size / 3.2);
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
        const rock = smoothstep(.86, .56, ny), soil = smoothstep(.96, .80, ny) * (1 - rock) * .6;
        c.setHSL(lerp(.21, .30, moist), lerp(.34, .56, moist), lerp(.24, .40, moist * .7 + dry * .3), THREE.SRGBColorSpace);
        let r = c.r, g = c.g, b = c.b;
        const sc = new THREE.Color().setHSL(.09, .30, .26 + dry * .08, THREE.SRGBColorSpace);
        r = lerp(r, sc.r, soil); g = lerp(g, sc.g, soil); b = lerp(b, sc.b, soil);
        const rc = new THREE.Color().setHSL(.08, .05, .30 + dry * .12, THREE.SRGBColorSpace);
        r = lerp(r, rc.r, rock); g = lerp(g, rc.g, rock); b = lerp(b, rc.b, rock);
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
    const want = Math.min(Math.round(P.grassCount), Q.grassCap);
    if (want > 0) {
      const bg = bladeGeometry(), gm = new THREE.InstancedMesh(bg, grassMat, want);
      const gc = new Float32Array(want * 3), gb = new Float32Array(want), gh = new Float32Array(want), ga = new Float32Array(want);
      const d = new THREE.Object3D(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const R = Math.max(3, P.grassRadius), per = 6;
      let placed = 0, guard = 0;
      while (placed < want && guard < want * 6) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * R;
        const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
        if (normalAt(cx, cz).y < .66) continue;
        const cy = heightAt(cx, cz);
        if (P.water && wet[gi(clamp(Math.round((cx / size + .5) * (N - 1)), 0, N - 1), clamp(Math.round((cz / size + .5) * (N - 1)), 0, N - 1))] > DRY) continue;
        const patch = fbm(noise, cx * .10, 21, cz * .10, 3) * .5 + .5;
        if (rng() > patch * 1.35) continue;
        for (let b = 0; b < per && placed < want; b++) {
          const ba = rng() * TAU, br = rng() * .26;
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
      for (let j = 
