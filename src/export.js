import * as THREE from 'three';
const V = new THREE.Vector3(), N = new THREE.Vector3(), NM = new THREE.Matrix3();

function idxOf(geo) {
  if (geo.index) return geo.index;
  const n = geo.attributes.position.count;
  return { count: n, getX: i => i };
}
export function pushMesh(out, geo, matrix, mat, name) {
  const pos = geo.attributes.position; if (!pos) return;
  const nor = geo.attributes.normal, uv = geo.attributes.uv, col = geo.attributes.color, idx = idxOf(geo);
  const n = pos.count;
  const P = new Float32Array(n * 3), Nr = nor ? new Float32Array(n * 3) : null;
  const U = uv ? new Float32Array(n * 2) : null, C = col ? new Float32Array(n * 3) : null;
  NM.getNormalMatrix(matrix);
  for (let i = 0; i < n; i++) {
    V.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    P[i * 3] = V.x; P[i * 3 + 1] = V.y; P[i * 3 + 2] = V.z;
    if (Nr) { N.fromBufferAttribute(nor, i).applyMatrix3(NM).normalize(); Nr[i * 3] = N.x; Nr[i * 3 + 1] = N.y; Nr[i * 3 + 2] = N.z; }
    if (U) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = 1 - uv.getY(i); }
    if (C) { C[i * 3] = col.getX(i); C[i * 3 + 1] = col.getY(i); C[i * 3 + 2] = col.getZ(i); }
  }
  const I = new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i);
  out.push({ name, P, N: Nr, U, C, I, mat });
}
export function pushInstanced(out, im, parentMatrix, cap, mat, name) {
  if (!im || !im.count) return;
  const geo = im.geometry, pos = geo.attributes.position; if (!pos) return;
  const nor = geo.attributes.normal, uv = geo.attributes.uv, idx = idxOf(geo);
  const count = Math.min(im.count, cap), vn = pos.count;
  const P = new Float32Array(count * vn * 3), Nr = nor ? new Float32Array(count * vn * 3) : null;
  const U = uv ? new Float32Array(count * vn * 2) : null, C = im.instanceColor ? new Float32Array(count * vn * 3) : null;
  const I = new Uint32Array(count * idx.count);
  const local = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    im.getMatrixAt(k, local); world.multiplyMatrices(parentMatrix, local);
    NM.getNormalMatrix(world);
    for (let i = 0; i < vn; i++) {
      const o = k * vn + i;
      V.fromBufferAttribute(pos, i).applyMatrix4(world);
      P[o * 3] = V.x; P[o * 3 + 1] = V.y; P[o * 3 + 2] = V.z;
      if (Nr) { N.fromBufferAttribute(nor, i).applyMatrix3(NM).normalize(); Nr[o * 3] = N.x; Nr[o * 3 + 1] = N.y; Nr[o * 3 + 2] = N.z; }
      if (U) { U[o * 2] = uv.getX(i); U[o * 2 + 1] = 1 - uv.getY(i); }
      if (C) { const c = im.instanceColor; C[o * 3] = c.getX(k); C[o * 3 + 1] = c.getY(k); C[o * 3 + 2] = c.getZ(k); }
    }
    for (let i = 0; i < idx.count; i++) I[k * idx.count + i] = idx.getX(i) + k * vn;
  }
  out.push({ name, P, N: Nr, U, C, I, mat });
}
export function collectWorld({ forest, terrain, water }, opt) {
  const parts = [];
  const bm = forest.barkMat;
  const barkDesc = { key: 'bark', color: [1, 1, 1], map: bm.map, normalMap: bm.normalMap, rough: .95 };
  for (const t of forest.trees) {
    t.group.updateMatrixWorld(true);
    if (opt.wood && t.wood) pushMesh(parts, t.wood.geometry, t.group.matrixWorld, barkDesc, 'Tree_' + t.id + '_wood');
    if (opt.leaves && t.leaves) {
      const m = t.leaves.material;
      pushInstanced(parts, t.leaves, t.group.matrixWorld, opt.leafCap, { key: 'leaf_' + (m.map ? m.map.id : 'x'), color: [1, 1, 1], map: m.map, alpha: .42, rough: .66, doubleSided: true }, 'Tree_' + t.id + '_leaves');
    }
    if (opt.leaves && t.litter) {
      const m = t.litter.material;
      pushInstanced(parts, t.litter, t.group.matrixWorld, 1500, { key: 'litter', color: [1, 1, 1], map: m.map, alpha: .42, rough: .9, doubleSided: true }, 'Tree_' + t.id + '_litter');
    }
  }
  terrain.group.updateMatrixWorld(true);
  if (opt.land && terrain.land) pushMesh(parts, terrain.land.geometry, terrain.land.matrixWorld, { key: 'land', color: [1, 1, 1], map: terrain.materials.landMat.map, normalMap: terrain.materials.landMat.normalMap, rough: 1 }, 'Terrain');
  if (opt.rocks && terrain.rocks) pushInstanced(parts, terrain.rocks, terrain.rocks.matrixWorld, 400, { key: 'rock', color: [.66, .66, .63], map: terrain.materials.rockMat.map, normalMap: terrain.materials.rockMat.normalMap, rough: .95 }, 'Rocks');
  if (opt.grass && terrain.grass) pushInstanced(parts, terrain.grass, terrain.grass.matrixWorld, opt.grassCap, { key: 'grass', color: [1, 1, 1], rough: .8, doubleSided: true }, 'Grass');
  if (opt.grass && terrain.flowers) pushInstanced(parts, terrain.flowers, terrain.flowers.matrixWorld, 2500, { key: 'flower', color: [1, 1, 1], map: terrain.materials.flowerMat.map, alpha: .4, rough: .7, doubleSided: true }, 'Flowers');
  if (opt.water && water && water.mesh && water.mesh.visible) {
    water.mesh.updateMatrixWorld(true);
    pushMesh(parts, water.mesh.geometry, water.mesh.matrixWorld, { key: 'water', color: [.12, .35, .45], rough: .12, doubleSided: true, opacity: .82 }, 'Water');
  }
  return parts;
}
export function partsStats(parts) {
  let v = 0, t = 0;
  for (const p of parts) { v += p.P.length / 3; t += p.I.length / 3; }
  return { verts: v, tris: t, meshes: parts.length };
}
export function toOBJ(parts, meta) {
  const L = ['# DREVO world export', '# ' + meta];
  let off = 0;
  for (const p of parts) {
    L.push('o ' + p.name);
    const n = p.P.length / 3;
    for (let i = 0; i < n; i++) L.push(`v ${p.P[i * 3].toFixed(4)} ${p.P[i * 3 + 1].toFixed(4)} ${p.P[i * 3 + 2].toFixed(4)}`);
    if (p.N) for (let i = 0; i < n; i++) L.push(`vn ${p.N[i * 3].toFixed(3)} ${p.N[i * 3 + 1].toFixed(3)} ${p.N[i * 3 + 2].toFixed(3)}`);
    if (p.U) for (let i = 0; i < n; i++) L.push(`vt ${p.U[i * 2].toFixed(4)} ${p.U[i * 2 + 1].toFixed(4)}`);
    for (let i = 0; i < p.I.length; i += 3) {
      const a = off + p.I[i] + 1, b = off + p.I[i + 1] + 1, c = off + p.I[i + 2] + 1;
      L.push(p.N && p.U ? `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}` : `f ${a} ${b} ${c}`);
    }
    off += n;
  }
  return L.join('\n');
}
export async function toGLB(parts, meta, onProgress) {
  const json = { asset: { version: '2.0', generator: 'DREVO world lab', copyright: meta }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [], images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] };
  const chunks = []; let byteLen = 0;
  const align = () => { const pad = (4 - (byteLen % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; } };
  function view(arr, target) {
    align();
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes); byteLen += bytes.byteLength;
    return json.bufferViews.length - 1;
  }
  function accessor(arr, type, comp, count, target, mm) {
    const a = { bufferView: view(arr, target), componentType: comp, count, type };
    if (mm) { a.min = mm.min; a.max = mm.max; }
    json.accessors.push(a); return json.accessors.length - 1;
  }
  const matCache = new Map(), texCache = new Map();
  async function texture(tex) {
    if (!tex || !tex.image || !tex.image.toBlob) return null;
    if (texCache.has(tex.id)) return texCache.get(tex.id);
    const blob = await new Promise(res => tex.image.toBlob(res, 'image/png'));
    if (!blob) return null;
    const bv = view(new Uint8Array(await blob.arrayBuffer()));
    json.images.push({ bufferView: bv, mimeType: 'image/png' });
    json.textures.push({ sampler: 0, source: json.images.length - 1 });
    const id = json.textures.length - 1; texCache.set(tex.id, id); return id;
  }
  async function material(d) {
    if (matCache.has(d.key)) return matCache.get(d.key);
    const m = { name: d.key, doubleSided: !!d.doubleSided, pbrMetallicRoughness: { baseColorFactor: [d.color[0], d.color[1], d.color[2], d.opacity != null ? d.opacity : 1], metallicFactor: 0, roughnessFactor: d.rough != null ? d.rough : .9 } };
    const t = await texture(d.map); if (t != null) m.pbrMetallicRoughness.baseColorTexture = { index: t };
    const nt = await texture(d.normalMap); if (nt != null) m.normalTexture = { index: nt, scale: 1.2 };
    if (d.alpha) { m.alphaMode = 'MASK'; m.alphaCutoff = d.alpha; }
    else if (d.opacity != null && d.opacity < 1) m.alphaMode = 'BLEND';
    json.materials.push(m);
    const id = json.materials.length - 1; matCache.set(d.key, id); return id;
  }
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    if (onProgress) onProgress(pi / parts.length, p.name);
    const n = p.P.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = p.P[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    const attrs = { POSITION: accessor(p.P, 'VEC3', 5126, n, 34962, { min, max }) };
    if (p.N) attrs.NORMAL = accessor(p.N, 'VEC3', 5126, n, 34962);
    if (p.U) attrs.TEXCOORD_0 = accessor(p.U, 'VEC2', 5126, n, 34962);
    if (p.C) attrs.COLOR_0 = accessor(p.C, 'VEC3', 5126, n, 34962);
    const indices = accessor(p.I, 'SCALAR', 5125, p.I.length, 34963);
    json.meshes.push({ name: p.name, primitives: [{ attributes: attrs, indices, material: await material(p.mat), mode: 4 }] });
    json.nodes.push({ name: p.name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
    await new Promise(r => setTimeout(r, 0));
  }
  align();
  json.buffers.push({ byteLength: byteLen });
  const bin = new Uint8Array(byteLen);
  let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  let js = JSON.stringify(json);
  while (js.length % 4) js += ' ';
  const jb = new TextEncoder().encode(js);
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true);
  u8.set(jb, 20);
  const bo = 20 + jb.length;
  dv.setUint32(bo, bin.length, true); dv.setUint32(bo + 4, 0x004E4942, true);
  u8.set(bin, bo + 8);
  return new Blob([out], { type: 'model/gltf-binary' });
}
