import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, lerp, TAU, mulberry32, makeNoise3D } from './noise.js';
import { skinTextures, hairTextures, eyeTexture } from './textures.js';

export const HUMAN_POSES = [
  { k:'apose', n:'А-поза' }, { k:'tpose', n:'Т-поза' }, { k:'relax', n:'Расслаблен' },
  { k:'walk', n:'Шаг' }, { k:'sit', n:'Сидя' }
];

export function createHuman(U, ...rest) {
  const mobile = rest.find(a => typeof a === 'boolean') ?? (typeof matchMedia === 'function' && matchMedia('(max-width:960px)').matches);
  const group = new THREE.Group();
  const stats = { height: 1.8, verts: 0, tris: 0, ms: 0 };
  const skinTex = skinTextures(makeNoise3D(777), 256);
  const hairTex = hairTextures(makeNoise3D(313), 256);
  const skinMat = new THREE.MeshPhysicalMaterial({ color: 0xc98d63, map: skinTex.map, normalMap: skinTex.normalMap, normalScale: new THREE.Vector2(.35,.35), roughness: .5, metalness: 0, sheen: .5, sheenRoughness: .55, sheenColor: new THREE.Color(0xffc9a8) });
  const hairMat = new THREE.MeshPhysicalMaterial({ color: 0x2b1d16, map: hairTex.map, normalMap: hairTex.normalMap, normalScale: new THREE.Vector2(.6,.6), roughness: .38, metalness: 0, sheen: .9, sheenRoughness: .32, sheenColor: new THREE.Color(0x8a6a4a) });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf2ece6, roughness: .12 });
  const irisMat = new THREE.MeshStandardMaterial({ map: eyeTexture(128, '#5b7f9a'), roughness: .1 });
  const mats = [skinMat, hairMat, eyeMat, irisMat];

  let realScene = null, realAnims = null;
  new GLTFLoader().load(import.meta.env.BASE_URL + 'models/human.glb',
    g => { realScene = g.scene; realAnims = g.animations; }, undefined, () => {});

  function clear() { for (const c of [...group.children]) { group.remove(c); if (c.geometry) c.geometry.dispose(); } }

  // аккуратный гладкий манекен-fallback (не SDF-крипота)
  function mannequin(H, P) {
    const g = new THREE.Group();
    const skin = skinMat.clone(); skin.color.set(P.hSkin || '#c98d63');
    const capsule = (r, len, x, y, z, rz = 0) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), skin);
      m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; g.add(m); return m;
    };
    capsule(.09*H, .30*H, 0, .62*H, 0);            // торс
    capsule(.05*H, .06*H, 0, .86*H, 0);            // шея
    const head = new THREE.Mesh(new THREE.SphereGeometry(.075*H, 20, 16), skin);
    head.position.set(0, .95*H, 0); head.castShadow = true; g.add(head);
    for (const s of [-1, 1]) {
      capsule(.035*H, .30*H, s*.13*H, .62*H, 0, s*.2);   // рука
      capsule(.05*H, .34*H, s*.06*H, .25*H, 0);          // нога
    }
    return g;
  }

  function applyToReal(root, P, H) {
    const box = new THREE.Box3().setFromObject(root);
    const s = H / Math.max(.01, box.max.y - box.min.y);
    root.scale.setScalar(s); root.position.y = -box.min.y * s;
    const bone = n => { let f = null; root.traverse(o => { if (o.isBone && o.name.toLowerCase().includes(n)) f = o; }); return f; };
    const setBoneScale = (n, k) => { const b = bone(n); if (b) b.scale.multiplyScalar(k); };
    setBoneScale('leftarm', P.hArms ?? 1); setBoneScale('rightarm', P.hArms ?? 1);
    setBoneScale('leftupleg', P.hLegs ?? 1); setBoneScale('rightupleg', P.hLegs ?? 1);
    setBoneScale('spine', P.hShoulders ?? 1); setBoneScale('hips', P.hHips ?? 1);
    setBoneScale('neck', P.hNeck ?? 1); setBoneScale('head', P.hHead ?? 1);
    // морфы лица/тела, если есть
    root.traverse(o => {
      if (o.isMesh && o.morphTargetDictionary) {
        const set = (name, v) => { const i = o.morphTargetDictionary[name]; if (i != null) o.morphTargetInfluences[i] = clamp(v, 0, 1); };
        set('belly', P.hBelly ?? .1); set('face', P.hFace ?? 1); set('female', P.hFemale ?? .25);
        set('muscle', P.hMuscle ?? .35); set('build', P.hBuild ?? .3);
      }
    });
    // одежда / волосы / глаза по именам мешей + покраска
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      const n = (o.name || '').toLowerCase();
      const mt = o.material;
      if (n.includes('hair')) { if (P.hHairOn === false) o.visible = false; if (mt && mt.color) mt.color.set(P.hHair || '#2b1d16'); }
      else if (n.includes('eye') || n.includes('iris')) { if (mt && mt.color) mt.color.set(P.hIris || '#5b7f9a'); }
      else if (n.includes('outfit') || n.includes('cloth') || n.includes('shirt')) { if (P.hClothed === false) o.visible = false; if (mt && mt.color) mt.color.set(P.hShirt || '#3f6f4a'); }
      else if (n.includes('shoe')) { if (mt && mt.color) mt.color.set(P.hShoes || '#22201e'); }
      else if (n.includes('body') || n.includes('skin')) { if (mt && mt.color) mt.color.set(P.hSkin || '#c98d63'); }
    });
  }

  function* build(P, Q) {
    const t0 = performance.now();
    clear();
    const H = clamp(P.hHeight || 180, 120, 220) / 100;
    if (realScene && P.hReal !== false) {
      const root = realScene.clone(true);
      applyToReal(root, P, H);
      group.add(root);
      let verts = 0, tris = 0;
      root.traverse(o => { if (o.isMesh) { verts += o.geometry.attributes.position.count; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
      stats.height = H; stats.verts = verts; stats.tris = Math.round(tris); stats.ms = performance.now() - t0;
      yield { p: 1, label: 'фигура готова' };
      return stats;
    }
    const m = mannequin(H, P);
    group.add(m);
    let verts = 0, tris = 0;
    m.traverse(o => { if (o.isMesh) { verts += o.geometry.attributes.position.count; tris += o.geometry.index.count / 3; } });
    stats.height = H; stats.verts = verts; stats.tris = Math.round(tris); stats.ms = performance.now() - t0;
    yield { p: 1, label: 'фигура готова' };
    return stats;
  }

  return {
    group, stats, build, mat: skinMat,
    setWire(v) { for (const m of mats) m.wireframe = v; },
    materials: { skinMat, hairMat, eyeMat, irisMat }
  };
}
