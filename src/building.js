import * as THREE from 'three';
import { clamp, lerp, TAU, mulberry32 } from './noise.js';

export function createBuilding() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b3550, emissive: 0xffb020, emissiveIntensity: .35, roughness: .18, metalness: .2, transparent: true, opacity: .82 });
  let mesh = null, glass = null;
  const stats = { tris: 0, verts: 0, ms: 0, height: 6 };
  const A = () => ({ p: [], n: [], u: [], c: [], i: [] });
  const C = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  function box(a, cx, cy, cz, w, h, d, col) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const F = [[[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]]];
    const hw = w / 2, hh = h / 2, hd = d / 2;
    for (const [n, u, v] of F) {
      const off = a.p.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        a.p.push(cx + (n[0] + u[0] * su + v[0] * sv) * hw, cy + (n[1] + u[1] * su + v[1] * sv) * hh, cz + (n[2] + u[2] * su + v[2] * sv) * hd);
        a.n.push(n[0], n[1], n[2]); a.u.push((su + 1) / 2, (sv + 1) / 2); a.c.push(col[0], col[1], col[2]);
      }
      a.i.push(off, off + 1, off + 2, off, off + 2, off + 3);
    }
  }
  function quad(a, p0, p1, p2, p3, col) {
    const off = a.p.length / 3;
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    [p0, p1, p2, p3].forEach((p, k) => { a.p.push(p[0], p[1], p[2]); a.n.push(nx, ny, nz); a.u.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0); a.c.push(col[0], col[1], col[2]); });
    a.i.push(off, off + 1, off + 2, off, off + 2, off + 3);
  }
  function tri(a, p0, p1, p2, col) {
    const off = a.p.length / 3;
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    [p0, p1, p2].forEach(p => { a.p.push(p[0], p[1], p[2]); a.n.push(nx / l, ny / l, nz / l); a.u.push(0, 0); a.c.push(col[0], col[1], col[2]); });
    a.i.push(off, off + 1, off + 2);
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

  function* build(P) {
    const t0 = performance.now();
    const a = A(), gl = A();
    const rng = mulberry32(P.seed * 7 + 11);
    const W = P.bWidth, D = P.bDepth, FH = P.bFloorH, FL = Math.round(P.bFloors);
    const wall = C(P.bWall), roofC = C(P.bRoof), trim = C(P.bTrim), stone = C('#6d6a63');
    const th = .22, plinth = .35;
    const tower = P.bType === 'tower';
    const ruin = P.bType === 'ruin';
    const ww = tower ? Math.min(W, D) : W;
    const dd = tower ? Math.min(W, D) : D;
    box(a, 0, plinth / 2, 0, ww + .5, plinth, dd + .5, stone);
    const nWin = Math.max(0, Math.round(P.bWindows));
    const winW = P.bWinSize, winH = P.bWinSize * 1.5;
    for (let f = 0; f < FL; f++) {
      const y0 = plinth + f * FH;
      const sill = y0 + FH * .30, head = Math.min(y0 + FH - .25, sill + winH);
      const sides = [
        { ax: 'x', len: ww, nz: dd / 2, sign: 1 }, { ax: 'x', len: ww, nz: -dd / 2, sign: -1 },
        { ax: 'z', len: dd, nz: ww / 2, sign: 1 }, { ax: 'z', len: dd, nz: -ww / 2, sign: -1 }
      ];
      for (const s of sides) {
        const put = (cAlong, y, len, h, t, col) => {
          if (s.ax === 'x') box(a, cAlong, y, s.nz, len, h, t, col);
          else box(a, s.nz, y, cAlong, t, h, len, col);
        };
        const doorHere = f === 0 && s.sign === 1 && s.ax === 'x' && P.bDoor;
        const n = doorHere ? nWin : nWin;
        const cells = [];
        const step = s.len / (n + 1);
        for (let i = 1; i <= n; i++) cells.push(-s.len / 2 + step * i);
        if (ruin && rng() < .35) { put(0, y0 + FH * .35, s.len, FH * .7, th, wall); continue; }
        put(0, y0 + (sill - y0) / 2, s.len, sill - y0, th, wall);
        put(0, (head + y0 + FH) / 2, s.len, y0 + FH - head, th, wall);
        let prev = -s.len / 2;
        for (const cx of cells) {
          const left = cx - winW / 2, right = cx + winW / 2;
          put((prev + left) / 2, (sill + head) / 2, left - prev, head - sill, th, wall);
          prev = right;
          const isDoor = doorHere && Math.abs(cx) < step * .6;
          if (isDoor) {
            put(cx, (y0 + head) / 2, winW, head - y0, th * .5, trim);
            if (s.ax === 'x') box(gl, cx, (y0 + head) / 2, s.nz + .02, winW * .8, (head - y0) * .9, .04, [1, 1, 1]);
          } else {
            if (s.ax === 'x') box(gl, cx, (sill + head) / 2, s.nz, winW * .92, (head - sill) * .92, .06, [1, 1, 1]);
            else box(gl, s.nz, (sill + head) / 2, cx, .06, (head - sill) * .92, winW * .92, [1, 1, 1]);
            put(cx, sill - .04, winW + .16, .08, th * 1.3, trim);
            put(cx, head + .04, winW + .16, .08, th * 1.3, trim);
          }
        }
        put((prev + s.len / 2) / 2, (sill + head) / 2, s.len / 2 - prev, head - sill, th, wall);
        if (P.bType === 'izba') for (let k = 0; k < 3; k++) put(0, y0 + FH * (.2 + k * .3), s.len + .06, .07, th * 1.25, trim);
      }
      yield { p: .1 + .55 * (f / FL), label: 'этаж ' + (f + 1) };
    }
    const topY = plinth + FL * FH;
    const rh = P.bRoofH;
    if (!ruin) {
      if (P.bRoofType === 'flat') {
        box(a, 0, topY + .12, 0, ww + .4, .24, dd + .4, roofC);
        box(a, 0, topY + .45, (dd + .4) / 2 - .1, ww + .4, .5, .2, roofC);
        box(a, 0, topY + .45, -(dd + .4) / 2 + .1, ww + .4, .5, .2, roofC);
      } else if (P.bRoofType === 'gable') {
        const w = ww / 2 + .35, d = dd / 2 + .35;
        quad(a, [-w, topY, d], [0, topY + rh, d], [0, topY + rh, -d], [-w, topY, -d], roofC);
        quad(a, [w, topY, -d], [0, topY + rh, -d], [0, topY + rh, d], [w, topY, d], roofC);
        tri(a, [-w, topY, d], [w, topY, d], [0, topY + rh, d], wall);
        tri(a, [w, topY, -d], [-w, topY, -d], [0, topY + rh, -d], wall);
        box(a, 0, topY + rh + .05, 0, .18, .12, dd + .8, trim);
      } else if (P.bRoofType === 'hip') {
        const w = ww / 2 + .35, d = dd / 2 + .35;
        const r = Math.max(.2, (ww - dd) / 2);
        const p1 = [-r, topY + rh, 0], p2 = [r, topY + rh, 0];
        quad(a, [-w, topY, d], p1, p2, [w, topY, d], roofC);
        quad(a, [w, topY, -d], p2, p1, [-w, topY, -d], roofC);
        tri(a, [w, topY, d], p2, [w, topY, -d], roofC);
        tri(a, [-w, topY, -d], p1, [-w, topY, d], roofC);
      } else {
        const R = Math.max(ww, dd) / 2 + .4, seg = 16;
        for (let i = 0; i < seg; i++) {
          const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
          tri(a, [Math.cos(a0) * R, topY, Math.sin(a0) * R], [Math.cos(a1) * R, topY, Math.sin(a1) * R], [0, topY + rh, 0], roofC);
        }
      }
      if (P.bChimney) box(a, ww * .28, topY + rh * .7, dd * .2, .5, rh * 1.4, .5, stone);
    } else {
      for (let i = 0; i < 8; i++) box(a, (rng() - .5) * ww, topY + rng() * .6, (rng() - .5) * dd, .4 + rng(), .3 + rng() * .5, .4 + rng(), stone);
    }
    if (P.bDoor) box(a, 0, .12, dd / 2 + .45, 1.6, .24, .9, stone);
    yield { p: .85, label: 'крыша' };

    const g = geoOf(a), gg = gl.p.length ? geoOf(gl) : null;
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    if (glass) { group.remove(glass); glass.geometry.dispose(); glass = null; }
    if (gg) { glass = new THREE.Mesh(gg, glassMat); glass.frustumCulled = false; group.add(glass); }
    stats.tris = g.index.count / 3 + (gg ? gg.index.count / 3 : 0);
    stats.verts = g.attributes.position.count + (gg ? gg.attributes.position.count : 0);
    stats.height = topY + rh; stats.ms = performance.now() - t0;
    yield { p: 1, label: 'здание готово' };
    return stats;
  }
  return { group, build, stats, mat, glassMat, get mesh() { return mesh; }, get glass() { return glass; } };
}
