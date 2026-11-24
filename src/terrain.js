import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, mulberry32, makeNoise3D, fbm, ridged } from './noise.js';
import { windify } from './engine.js';
import { flowerTexture } from './textures.js';

function bladeGeometry() {
  const g = new THREE.BufferGeometry();
  const rows = [0, .42, .76, 1], w = .05;
  const pos = [], col = [], idx = [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i], hw = w * (1 - t * .88), z = .26 * t * t;
    const shade = .40 + t * .78;
    if (i === rows.length - 1) { pos.push(0, t, z); col.push(shade, shade * 1.05, shade * .9); }
    else { pos.push(-hw, t, z, hw, t, z); col.push(shade * .9, shade, shade * .8, shade * .9, shade, shade * .8); }
  }
  for (let i = 0; i < rows.length - 2; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const tip = rows.length * 2 - 1, last = (rows.length - 2) * 2;
  idx.push(last, last + 1, tip);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function createTerrainSystem(U, groundTex, rockTex, mobile) {
  const group = new THREE.Group();
  const landMat = new THREE.MeshStandardMaterial({
    map: groundTex.map, normalMap: groundTex.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    vertexColors: true, roughness: 1, metalness: 0, dithering: true
  });
  landMat.map.repeat.set(60, 60); landMat.normalMap.repeat.set(60, 60);

  const grassMat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .82, metalness: 0, side: THREE.DoubleSide }),
    U, { key: 'grass', height: .6, flutter: .07, baseAttr: true });
  const flowerMat = windify(new THREE.MeshStandardMaterial({ map: flowerTexture(mobile ? 64 : 96), alphaTest: .4, side: THREE.DoubleSide, roughness: .7, metalness: 0 }),
    U, { key: 'flower', height: .5, flutter: .05, baseAttr: true });
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex.map, normalMap: rockTex.normalMap, roughness: .95, metalness: 0, color: 0x9a9a94 });
  const litterMat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, alphaTest: .4, side: THREE.DoubleSide, roughness: .9, metalness: 0 }),
    U, { key: 'litter', height: 1, flutter: 0, baseAttr: true });

  let land = null, grass = null, rocks = null, flowers = null, litter = null;
  let heightFn = () => 0;
  const stats = { tris: 0, grass: 0, flowers: 0, rocks: 0, ms: 0 };

  function makeHeight(P) {
    const n = makeNoise3D(P.seed * 131 + 7);
    const s = 1 / Math.max(12, P.tscale);
    const amp = P.relief, gain = lerp(.38, .62, P.tdetail);
    const raw = (x, z) => {
      const wx = x * s, wz = z * s;
      const qx = fbm(n, wx + 11.3, .5, wz + 3.7, 3);
      const qz = fbm(n, wx - 4.1, 2.5, wz + 9.2, 3);
      const px = wx + .4 * qx, pz = wz + .4 * qz;
      let h = fbm(n, px, 0, pz, 5, 2.02, gain);
      h = h * .8 + (ridged(n, px * .5 + 3.1, 0, pz * .5 - 1.7, 3) - .55) * .5;
      h *= amp;
      h += fbm(n, x * .35, 5, z * .35, 2) * amp * .05;
      return h;
    };
    const h0 = raw(0, 0);
    const pad = Math.max(2, P.pad);
    return (x, z) => {
      const h = raw(x, z);
      const d = Math.hypot(x, z);
      if (d >= pad * 2.4) return h;
      return lerp(h0, h, smoothstep(pad * .7, pad * 2.4, d));
    };
  }

  function normalAt(x, z) {
    const e = .6;
    const hL = heightFn(x - e, z), hR = heightFn(x + e, z);
    const hD = heightFn(x, z - e), hU = heightFn(x, z + e);
    return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
  }

  function dispose(m) { if (!m) return; group.remove(m); if (m.isInstancedMesh) m.dispose(); if (m.geometry) m.geometry.dispose(); }

  function* build(P, Q, withMesh, leafTex) {
    const t0 = performance.now();
    heightFn = makeHeight(P);
    const rng = mulberry32((P.seed * 17 + 3) >>> 0);
    const noise = makeNoise3D(P.seed * 977 + 5);
    const size = P.tsize;

    if (withMesh) {
      const seg = Q.landSeg;
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, heightFn(x, z));
        if (i % 4000 === 0) yield { p: .3 * (i / pos.count), label: 'рельеф' };
      }
      g.computeVertexNormals();
      const nrm = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nrm.getY(i);
        const moist = fbm(noise, x * .035, 3, z * .035, 3) * .5 + .5;
        const dry = fbm(noise, x * .12, 9, z * .12, 2) * .5 + .5;
        const rock = smoothstep(.86, .58, ny);
        const soil = smoothstep(.95, .80, ny) * (1 - rock) * .7;
        const gcol = c.setHSL(lerp(.22, .30, moist), lerp(.30, .52, moist), lerp(.13, .26, moist * .7 + dry * .3), THREE.SRGBColorSpace);
        let r = gcol.r, gg = gcol.g, b = gcol.b;
        const sc = new THREE.Color().setHSL(.09, .28, .17 + dry * .06, THREE.SRGBColorSpace);
        r = lerp(r, sc.r, soil); gg = lerp(gg, sc.g, soil); b = lerp(b, sc.b, soil);
        const rc = new THREE.Color().setHSL(.08, .04, .20 + dry * .10, THREE.SRGBColorSpace);
        r = lerp(r, rc.r, rock); gg = lerp(gg, rc.g, rock); b = lerp(b, rc.b, rock);
        const shade = .82 + .18 * smoothstep(-P.relief, P.relief, y);
        colors[i * 3] = r * shade; colors[i * 3 + 1] = gg * shade; colors[i * 3 + 2] = b * shade;
        if (i % 6000 === 0) yield { p: .3 + .2 * (i / pos.count), label: 'покров почвы' };
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      dispose(land);
      land = new THREE.Mesh(g, landMat);
      land.receiveShadow = true; land.frustumCulled = false;
      group.add(land);
      stats.tris = g.index.count / 3;
      landMat.map.repeat.set(size / 3, size / 3);
      landMat.normalMap.repeat.set(size / 3, size / 3);
    }
    yield { p: .52, label: 'расстановка травы' };

    /* --- трава --- */
    dispose(grass); grass = null;
    const want = Math.min(Math.round(P.grassCount), Q.grassCap);
    if (want > 0) {
      const bg = bladeGeometry();
      const gm = new THREE.InstancedMesh(bg, grassMat, want);
      const gc = new Float32Array(want * 3), gb = new Float32Array(want), ga = new Float32Array(want);
      const d = new THREE.Object3D(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const R = Math.min(size * .42, 46 + P.grassCount / 700);
      let placed = 0, guard = 0;
      while (placed < want && guard < want * 8) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * R;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (Math.hypot(x, z) < P.trunk * 1.3) continue;
        const nrm = normalAt(x, z);
        if (nrm.y < .72) continue;
        const patch = fbm(noise, x * .09, 21, z * .09, 3) * .5 + .5;
        if (rng() > patch * 1.25) continue;
        const y = heightFn(x, z);
        d.position.set(x, y - .02, z);
        d.quaternion.setFromUnitVectors(up, nrm);
        d.rotateY(rng() * TAU); d.rotateX((rng() - .5) * .35);
        const hgt = P.grassHeight * (.55 + rng() * .95) * lerp(.7, 1.15, patch);
        d.scale.set(hgt * (.8 + rng() * .5), hgt, hgt);
        d.updateMatrix(); gm.setMatrixAt(placed, d.matrix);
        const moist = fbm(noise, x * .035, 3, z * .035, 3) * .5 + .5;
        c.setHSL(lerp(.19, .30, moist) + (rng() - .5) * .05 * P.grassVar,
          clamp(lerp(.30, .55, moist) + (rng() - .5) * .25 * P.grassVar, .1, .8),
          clamp(lerp(.14, .30, moist) * (.7 + rng() * .7), .04, .6), THREE.SRGBColorSpace);
        gc[placed * 3] = c.r; gc[placed * 3 + 1] = c.g; gc[placed * 3 + 2] = c.b;
        gb[placed] = y; ga[placed] = .985;
        placed++;
        if (placed % 4000 === 0) yield { p: .52 + .3 * (placed / want), label: 'трава' };
      }
      gm.count = placed;
      bg.setAttribute('aBase', new THREE.InstancedBufferAttribute(gb, 1));
      bg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(ga, 1));
      gm.instanceColor = new THREE.InstancedBufferAttribute(gc, 3);
      gm.instanceMatrix.needsUpdate = true;
      gm.receiveShadow = true; gm.frustumCulled = false;
      group.add(gm); grass = gm;
      stats.grass = placed;
    } else stats.grass = 0;
    grassMat.userData.uH.value = Math.max(.2, P.grassHeight * 1.25);

    /* --- камни --- */
    dispose(rocks); rocks = null;
    const nRocks = Math.round(P.rocks);
    if (nRocks > 0) {
      const rg = new THREE.IcosahedronGeometry(1, 1);
      const rp = rg.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
        const k = 1 + fbm(noise, x * 1.7, y * 1.7, z * 1.7, 3) * .38;
        rp.setXYZ(i, x * k, y * k * .72, z * k);
      }
      rg.computeVertexNormals();
      const rm = new THREE.InstancedMesh(rg, rockMat, nRocks);
      const rc = new Float32Array(nRocks * 3);
      const d = new THREE.Object3D(), c = new THREE.Color();
      for (let i = 0; i < nRocks; i++) {
        const a = rng() * TAU, rr = 4 + Math.sqrt(rng()) * size * .35;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const s = .25 + rng() * 1.1;
        d.position.set(x, heightFn(x, z) - s * .28, z);
        d.rotation.set(rng() * .6, rng() * TAU, rng() * .6);
        d.scale.set(s * (.8 + rng() * .6), s * (.6 + rng() * .5), s * (.8 + rng() * .6));
        d.updateMatrix(); rm.setMatrixAt(i, d.matrix);
        const l = .28 + rng() * .22;
        c.setHSL(.09, .05, l, THREE.SRGBColorSpace);
        rc[i * 3] = c.r; rc[i * 3 + 1] = c.g; rc[i * 3 + 2] = c.b;
      }
      rm.instanceColor = new THREE.InstancedBufferAttribute(rc, 3);
      rm.castShadow = true; rm.receiveShadow = true; rm.frustumCulled = false;
      group.add(rm); rocks = rm;
    }
    stats.rocks = nRocks;
    yield { p: .86, label: 'камни' };

    /* --- цветы --- */
    dispose(flowers); flowers = null;
    const nF = Math.round(P.flowers);
    if (nF > 0) {
      const fg = new THREE.PlaneGeometry(1, 1, 1, 1);
      fg.translate(0, .5, 0);
      const fg2 = fg.clone(); fg2.rotateY(Math.PI / 2);
      const merged = mergeSimple(fg, fg2);
      const fm = new THREE.InstancedMesh(merged, flowerMat, nF);
      const fc = new Float32Array(nF * 3), fb = new Float32Array(nF), fa = new Float32Array(nF);
      const d = new THREE.Object3D(), c = new THREE.Color();
      const palette = [[.13, .55, .85], [.02, .35, .9], [.85, .35, .88], [.0, .0, .96]];
      let placed = 0, guard = 0;
      while (placed < nF && guard < nF * 10) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * Math.min(size * .4, 42);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (normalAt(x, z).y < .85) continue;
        if (fbm(noise, x * .13, 44, z * .13, 2) < .05) continue;
        const y = heightFn(x, z);
        d.position.set(x, y, z);
        d.rotation.set(0, rng() * TAU, (rng() - .5) * .2);
        const s = .16 + rng() * .18;
        d.scale.set(s, s * (1 + rng() * .6), s);
        d.updateMatrix(); fm.setMatrixAt(placed, d.matrix);
        const p = palette[(rng() * palette.length) | 0];
        c.setHSL(p[0], p[1], p[2] * (.7 + rng() * .3), THREE.SRGBColorSpace);
        fc[placed * 3] = c.r; fc[placed * 3 + 1] = c.g; fc[placed * 3 + 2] = c.b;
        fb[placed] = y; fa[placed] = .99;
        placed++;
      }
      fm.count = placed;
      merged.setAttribute('aBase', new THREE.InstancedBufferAttribute(fb, 1));
      merged.setAttribute('aGrow', new THREE.InstancedBufferAttribute(fa, 1));
      fm.instanceColor = new THREE.InstancedBufferAttribute(fc, 3);
      fm.instanceMatrix.needsUpdate = true;
      fm.frustumCulled = false;
      group.add(fm); flowers = fm;
      stats.flowers = placed;
    } else stats.flowers = 0;

    /* --- опавшие листья --- */
    dispose(litter); litter = null;
    const nL = Math.round(P.litter);
    if (nL > 0 && leafTex) {
      litterMat.map = leafTex; litterMat.needsUpdate = true;
      const lg = new THREE.PlaneGeometry(1, 1);
      lg.rotateX(-Math.PI / 2);
      const lm = new THREE.InstancedMesh(lg, litterMat, nL);
      const lc = new Float32Array(nL * 3), lb = new Float32Array(nL), la = new Float32Array(nL);
      const d = new THREE.Object3D(), c = new THREE.Color();
      const base = new THREE.Color(P.leafColor), hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl, THREE.SRGBColorSpace);
      for (let i = 0; i < nL; i++) {
        const a = rng() * TAU, rr = Math.sqrt(rng()) * Math.max(5, P.height * .6);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const y = heightFn(x, z);
        d.position.set(x, y + .03, z);
        d.rotation.set(0, rng() * TAU, 0);
        const s = .14 * (.7 + rng() * .8);
        d.scale.set(s, 1, s);
        d.updateMatrix(); lm.setMatrixAt(i, d.matrix);
        c.setHSL((hsl.h * .6 + .06 + rng() * .07) % 1, .5 + rng() * .3, .14 + rng() * .16, THREE.SRGBColorSpace);
        lc[i * 3] = c.r; lc[i * 3 + 1] = c.g; lc[i * 3 + 2] = c.b;
        lb[i] = y; la[i] = .99;
      }
      lg.setAttribute('aBase', new THREE.InstancedBufferAttribute(lb, 1));
      lg.setAttribute('aGrow', new THREE.InstancedBufferAttribute(la, 1));
      lm.instanceColor = new THREE.InstancedBufferAttribute(lc, 3);
      lm.receiveShadow = true; lm.frustumCulled = false;
      group.add(lm); litter = lm;
    }
    stats.ms = performance.now() - t0;
    yield { p: 1, label: 'ландшафт готов' };
    return stats;
  }

  function mergeSimple(a, b) {
    const g = new THREE.BufferGeometry();
    const pa = a.attributes.position.array, pb = b.attributes.position.array;
    const na = a.attributes.normal.array, nb = b.attributes.normal.array;
    const ua = a.attributes.uv.array, ub = b.attributes.uv.array;
    const ia = a.index.array, ib = b.index.array;
    const pos = new Float32Array(pa.length + pb.length);
    pos.set(pa); pos.set(pb, pa.length);
    const nor = new Float32Array(na.length + nb.length);
    nor.set(na); nor.set(nb, na.length);
    const uv = new Float32Array(ua.length + ub.length);
    uv.set(ua); uv.set(ub, ua.length);
    const off = pa.length / 3;
    const idx = new Uint16Array(ia.length + ib.length);
    idx.set(ia);
    for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    a.dispose(); b.dispose();
    return g;
  }

  return {
    group, stats, build, materials: { landMat, grassMat, rockMat, flowerMat },
    heightAt: (x, z) => heightFn(x, z),
    prepare(P) { heightFn = makeHeight(P); },
    get land() { return land; }, get rocks() { return rocks; },
    setWire(v) { landMat.wireframe = v; grassMat.wireframe = v; rockMat.wireframe = v; flowerMat.wireframe = v; }
  };
}
