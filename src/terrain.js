import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, mulberry32, makeNoise3D, fbm, ridged } from './noise.js';
import { windify } from './engine.js';
import { flowerTexture } from './textures.js';

function bladeGeometry() {
  const rows = [0, .38, .72, 1], w = .062;
  const pos = [], col = [], idx = [];
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
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function crossGeo() {
  const a = new THREE.PlaneGeometry(1, 1); a.translate(0, .5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array, pb = b.attributes.position.array;
  const na = a.attributes.normal.array, nb = b.attributes.normal.array;
  const ua = a.attributes.uv.array, ub = b.attributes.uv.array;
  const ia = a.index.array, ib = b.index.array, off = pa.length / 3;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  const nor = new Float32Array(na.length + nb.length); nor.set(na); nor.set(nb, na.length);
  const uv = new Float32Array(ua.length + ub.length); uv.set(ua); uv.set(ub, ua.length);
  const idx = new Uint16Array(ia.length + ib.length); idx.set(ia);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  a.dispose(); b.dispose(); return g;
}

export function createTerrainSystem(U, groundTex, rockTex, mobile) {
  const group = new THREE.Group();
  const landMat = new THREE.MeshStandardMaterial({ map: groundTex.map, normalMap: groundTex.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, roughness: 1, metalness: 0, dithering: true });
  const grassMat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide }), U, { key: 'grass', base: 'instance', height: 'attr', flutter: .09 });
  const flowerMat = windify(new THREE.MeshStandardMaterial({ map: flowerTexture(mobile ? 64 : 96), alphaTest: .4, side: THREE.DoubleSide, roughness: .7, metalness: 0 }), U, { key: 'flower', base: 'instance', height: 'attr', flutter: .05 });
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex.map, normalMap: rockTex.normalMap, roughness: .95, metalness: 0, color: 0xa8a8a0 });
  let land = null, grass = null, rocks = null, flowers = null;
  let heightFn = () => 0, hMin = -1, hMax = 1, heightTex = null;
  const stats = { tris: 0, grass: 0, flowers: 0, rocks: 0, ms: 0, water: 0 };

  function makeHeight(P) {
    const n = makeNoise3D(P.seed * 131 + 7);
    const s = 1 / Math.max(12, P.tscale), amp = P.relief, gain = lerp(.38, .62, P.tdetail);
    const raw = (x, z) => {
      const wx = x * s, wz = z * s;
      const qx = fbm(n, wx + 11.3, .5, wz + 3.7, 3), qz = fbm(n, wx - 4.1, 2.5, wz + 9.2, 3);
      const px = wx + .4 * qx, pz = wz + .4 * qz;
      let h = fbm(n, px, 0, pz, 5, 2.02, gain);
      h = h * .8 + (ridged(n, px * .5 + 3.1, 0, pz * .5 - 1.7, 3) - .55) * .5;
      h *= amp;
      h += fbm(n, x * .35, 5, z * .35, 2) * amp * .05;
      if (P.river) {
        const t = x / Math.max(30, P.tscale);
        const cz = P.riverOffset + Math.sin(t * 1.15) * P.riverMeander * 26 + fbm(n, t * .9, 3.3, 0, 3) * P.riverMeander * 34;
        const d = Math.abs(z - cz), w = Math.max(1.5, P.riverWidth);
        const carve = Math.exp(-Math.pow(d / (w * 1.45), 2));
        const bed = P.waterLevel - P.riverDepth;
        h = lerp(h, Math.min(h, bed), carve);
        const bank = Math.exp(-Math.pow(d / (w * 3.2), 2)) * (1 - carve);
        h = lerp(h, lerp(h, P.waterLevel + .35, .55), bank * .7);
      }
      return h;
    };
    const h0 = raw(0, 0), pad = Math.max(2, P.pad);
    return (x, z) => {
      const h = raw(x, z), d = Math.hypot(x, z);
      return d >= pad * 2.4 ? h : lerp(h0, h, smoothstep(pad * .7, pad * 2.4, d));
    };
  }
  function normalAt(x, z) {
    const e = .7;
    return new THREE.Vector3(heightFn(x - e, z) - heightFn(x + e, z), 2 * e, heightFn(x, z - e) - heightFn(x, z + e)).normalize();
  }
  function dispose(m) { if (!m) return; group.remove(m); if (m.isInstancedMesh) m.dispose(); if (m.geometry) m.geometry.dispose(); }

  function* build(P, Q, withMesh) {
    const t0 = performance.now();
    heightFn = makeHeight(P);
    const rng = mulberry32((P.seed * 17 + 3) >>> 0);
    const noise = makeNoise3D(P.seed * 977 + 5);
    const size = P.tsize, wy = P.waterLevel;

    if (withMesh) {
      const seg = Math.round(lerp(72, Q.landSeg, P.landDetail));
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position;
      let mn = Infinity, mx = -Infinity, wet = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = heightFn(x, z);
        pos.setY(i, y);
        if (y < mn) mn = y; if (y > mx) mx = y;
        if (P.water && y < wy) wet++;
        if (i % 5000 === 0) yield { p: .26 * (i / pos.count), label: 'рельеф' };
      }
      hMin = mn - .5; hMax = mx + .5;
      stats.water = Math.round(wet / pos.count * 100);
      g.computeVertexNormals();
      const nrm = g.attributes.normal, colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color(), sc = new THREE.Color(), rc = new THREE.Color(), wc = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nrm.getY(i);
        const moist = fbm(noise, x * .035, 3, z * .035, 3) * .5 + .5;
        const dry = fbm(noise, x * .12, 9, z * .12, 2) * .5 + .5;
        const rock = smoothstep(.86, .56, ny);
        const soil = smoothstep(.96, .80, ny) * (1 - rock) * .6;
        c.setHSL(lerp(.21, .30, moist), lerp(.34, .56, moist), lerp(.24, .40, moist * .7 + dry * .3), THREE.SRGBColorSpace);
        let r = c.r, gg = c.g, b = c.b;
        sc.setHSL(.09, .30, .26 + dry * .08, THREE.SRGBColorSpace);
        r = lerp(r, sc.r, soil); gg = lerp(gg, sc.g, soil); b = lerp(b, sc.b, soil);
        rc.setHSL(.08, .05, .30 + dry * .12, THREE.SRGBColorSpace);
        r = lerp(r, rc.r, rock); gg = lerp(gg, rc.g, rock); b = lerp(b, rc.b, rock);
        if (P.water) {
          const shore = smoothstep(wy + 1.1, wy - .2, y);
          wc.setHSL(.11, .26, .40, THREE.SRGBColorSpace);
          r = lerp(r, wc.r, shore * .8); gg = lerp(gg, wc.g, shore * .8); b = lerp(b, wc.b, shore * .8);
          const under = smoothstep(wy, wy - 3.5, y);
          r = lerp(r, .05, under); gg = lerp(gg, .13, under); b = lerp(b, .16, under);
        }
        const shade = .84 + .16 * smoothstep(-P.relief, P.relief, y);
        colors[i * 3] = r * shade; colors[i * 3 + 1] = gg * shade; colors[i * 3 + 2] = b * shade;
        if (i % 8000 === 0) yield { p: .26 + .16 * (i / pos.count), label: 'покров почвы' };
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      dispose(land);
      land = new THREE.Mesh(g, landMat);
      land.receiveShadow = true; land.frustumCulled = false; group.add(land);
      stats.tris = g.index.count / 3;
      landMat.map.repeat.set(size / 3.2, size / 3.2);
      landMat.normalMap.repeat.set(size / 3.2, size / 3.2);

      const HN = Q.heightRes, data = new Uint8Array(HN * HN * 4), span = Math.max(.001, hMax - hMin);
      for (let j = 0; j < HN; j++) {
        const z = (j / (HN - 1) - .5) * size;
        for (let i = 0; i < HN; i++) {
          const x = (i / (HN - 1) - .5) * size;
          const v = clamp((heightFn(x, z) - hMin) / span, 0, 1) * 255;
          const k = (j * HN + i) * 4;
          data[k] = v; data[k + 1] = v; data[k + 2] = v; data[k + 3] = 255;
        }
        if (j % 32 === 0) yield { p: .42 + .1 * (j / HN), label: 'карта глубин' };
      }
      if (heightTex) heightTex.dispose();
      heightTex = new THREE.DataTexture(data, HN, HN, THREE.RGBAFormat, THREE.UnsignedByteType);
      heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
      heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
      heightTex.needsUpdate = true;
    }
    yield { p: .54, label: 'трава' };

    dispose(grass); grass = null;
    const want = Math.min(Math.round(P.grassCount), Q.grassCap);
    if (want > 0) {
      const bg = bladeGeometry();
      const gm = new THREE.InstancedMesh(bg, grassMat, want);
      const gc = new Float32Array(want * 3), gb = new Float32Array(want), gh = new Float32Array(want), ga = new Float32Array(want);
      const d = new THREE.Object3D(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const R = Math.max(3, P.grassRadius), per = 6;
      let placed = 0, guard = 0;
      while (placed < want && guard < want * 6) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * R;
        const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
        const nrm = normalAt(cx, cz);
        if (nrm.y < .66) continue;
        const cy = heightFn(cx, cz);
        if (P.water && cy < wy + .04) continue;
        const patch = fbm(noise, cx * .10, 21, cz * .10, 3) * .5 + .5;
        if (rng() > patch * 1.35) continue;
        for (let b = 0; b < per && placed < want; b++) {
          const ba = rng() * TAU, br = rng() * .26;
          const x = cx + Math.cos(ba) * br, z = cz + Math.sin(ba) * br;
          const y = heightFn(x, z);
          if (P.water && y < wy + .02) continue;
          const near = P.water ? clamp(1 - (y - wy) / 1.6, 0, 1) : 0;
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
          gb[placed] = y; gh[placed] = hgt; ga[placed] = .985;
          placed++;
        }
        if (placed % 6000 < per) yield { p: .54 + .28 * (placed / want), label: 'трава' };
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
      const rg = new THREE.IcosahedronGeometry(1, Q.rockDetail);
      const rp = rg.attributes.position;
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
        d.position.set(x, heightFn(x, z) - s * .26, z);
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
    yield { p: .86, label: 'камни' };

    dispose(flowers); flowers = null;
    const nF = Math.round(P.flowers);
    if (nF > 0) {
      const fg = crossGeo();
      const fm = new THREE.InstancedMesh(fg, flowerMat, nF);
      const fc = new Float32Array(nF * 3), fb = new Float32Array(nF), fh = new Float32Array(nF), fa = new Float32Array(nF);
      const d = new THREE.Object3D(), c = new THREE.Color();
      const pal = [[.13, .6, .88], [.02, .4, .92], [.85, .38, .9], [0, 0, .97]];
      let placed = 0, guard = 0;
      while (placed < nF && guard < nF * 12) {
        guard++;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * Math.max(6, P.grassRadius * 1.1);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (normalAt(x, z).y < .84) continue;
        const y = heightFn(x, z);
        if (P.water && y < wy + .25) continue;
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
    stats.ms = performance.now() - t0;
    yield { p: 1, label: 'ландшафт готов' };
    return stats;
  }
  return {
    group, stats, build, materials: { landMat, grassMat, rockMat, flowerMat },
    prepare(P) { heightFn = makeHeight(P); },
    heightAt: (x, z) => heightFn(x, z), normalAt,
    get land() { return land; }, get rocks() { return rocks; }, get grass() { return grass; }, get flowers() { return flowers; },
    get heightTex() { return heightTex; }, get hMin() { return hMin; }, get hMax() { return hMax; },
    setWire(v) { landMat.wireframe = v; grassMat.wireframe = v; rockMat.wireframe = v; flowerMat.wireframe = v; }
  };
}
