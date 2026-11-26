import * as THREE from 'three';
import { clamp, lerp, fbm, ridged, mulberry32, makeNoise3D } from './noise.js';

export function canvas2d(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function toTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4; t.needsUpdate = true; return t;
}
const photoLoader = new THREE.TextureLoader();
function photoUpgrade(t, file) {
  return new Promise(resolve => {
    photoLoader.load(import.meta.env.BASE_URL + 'tex/' + file, ok => {
      t.image = ok.image;
      t.needsUpdate = true;
      resolve(true);
    }, undefined, () => resolve(false));
  });
}
export function leafScan(size) {
  const t = leafTexture('cluster', size);
  const x = t.image.getContext('2d');
  const base = import.meta.env.BASE_URL + 'tex/';
  photoLoader.load(base + 'leaf_col.png', col => {
    photoLoader.load(base + 'leaf_alpha.png', al => {
      x.clearRect(0, 0, size, size);
      x.drawImage(col.image, 0, 0, size, size);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(al.image, 0, 0, size, size);
      x.globalCompositeOperation = 'source-over';
      t.needsUpdate = true;
    }, undefined, () => {});
  }, undefined, () => {});
  return t;
}
function normalCanvas(H, w, h, s) {
  const c = canvas2d(w, h), x = c.getContext('2d'), o = x.createImageData(w, h), d = o.data;
  const at = (i, j) => H[((j + h) % h) * w + ((i + w) % w)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * s, dy = (at(i, j + 1) - at(i, j - 1)) * s;
    let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz);
    const k = (j * w + i) * 4;
    d[k] = (nx / l * .5 + .5) * 255; d[k + 1] = (ny / l * .5 + .5) * 255; d[k + 2] = (nz / l * .5 + .5) * 255; d[k + 3] = 255;
  }
  x.putImageData(o, 0, 0); return c;
}
export function* barkJob(noise, w) {
  const h = w * 2, H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w, wx = u * 9 + fbm(noise, u * 3.1, v * 1.4, 3.3, 2) * .6;
      const pl = ridged(noise, wx * 3, v * 2.2, 0, 4, 2.1, .55);
      const fine = fbm(noise, u * 46, v * 12, 7.7, 3) * .5 + .5;
      const cr = ridged(noise, wx * 6.2 + 13, v * 3.1, 5, 2);
      let hh = Math.pow(pl, 1.7) * .82 + fine * .18;
      hh -= Math.pow(Math.max(0, cr - .70) / .30, 1.4) * .62;
      const br = fbm(noise, u * 7, v * 30, 21, 2);
      if (br > .40) hh -= (br - .40) * 1.1;
      H[y * w + x] = clamp(hh, 0, 1);
    }
    if (y % 48 === 0) yield { p: .6 * (y / h), label: 'кора' };
  }
  const al = canvas2d(w, h), ax = al.getContext('2d'), im = ax.createImageData(w, h), d = im.data;
  const ro = canvas2d(w, h), rx = ro.getContext('2d'), rim = rx.createImageData(w, h), rd = rim.data;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w, i = y * w + x, k = i * 4, hh = H[i];
      const sh = .20 + .80 * Math.pow(hh, .85), ti = fbm(noise, u * 5.5, v * 3.2, 40, 2);
      let r = sh * (1 + ti * .07), g = sh * (.97 + ti * .03), b = sh * (.92 - ti * .05);
      const li = fbm(noise, u * 15, v * 8, 60, 3);
      if (li > .34) { const t = clamp((li - .34) / .4, 0, 1) * .65; r = lerp(r, .60, t); g = lerp(g, .68, t); b = lerp(b, .54, t); }
      d[k] = clamp(r, 0, 1) * 255; d[k + 1] = clamp(g, 0, 1) * 255; d[k + 2] = clamp(b, 0, 1) * 255; d[k + 3] = 255;
      const q = clamp(.96 - hh * .28, .45, 1) * 255;
      rd[k] = q; rd[k + 1] = q; rd[k + 2] = q; rd[k + 3] = 255;
    }
    if (y % 96 === 0) yield { p: .6 + .3 * (y / h), label: 'альбедо коры' };
  }
  ax.putImageData(im, 0, 0); rx.putImageData(rim, 0, 0);
  yield { p: .95, label: 'нормали коры' };
  return { map: toTex(al), normalMap: toTex(normalCanvas(H, w, h, 5.5), false), roughnessMap: toTex(ro, false) };
}
export function barkTextures(n, w) {
  const g = barkJob(n, w); let r = g.next(); while (!r.done) r = g.next();
  const set = r.value;
  photoUpgrade(set.map, 'bark_col.jpg');
  photoUpgrade(set.normalMap, 'bark_nor.jpg');
  photoUpgrade(set.roughnessMap, 'bark_rough.jpg');
  return set;
}
export function photoBark() { return barkTextures(makeNoise3D(90210), 256); }
export function photoGround() { return groundTextures(makeNoise3D(90210), 256); }
export function photoLeaf() { return leafScan(256); }

function leafPath(x, kind, cx, cy, s, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
  const nr = kind === 'needle';
  x.beginPath(); x.moveTo(0, 60);
  x.bezierCurveTo(nr ? -18 : -56, 24, nr ? -14 : -48, -36, 0, -60);
  x.bezierCurveTo(nr ? 14 : 48, -36, nr ? 18 : 56, 24, 0, 60);
  x.closePath(); x.fill();
  x.strokeStyle = 'rgba(105,125,95,.5)'; x.lineWidth = nr ? 1.6 : 2.2;
  x.beginPath(); x.moveTo(0, 56); x.lineTo(0, -56); x.stroke();
  if (!nr) { x.lineWidth = 1.1;
    for (let i = -3; i <= 3; i++) { const y = i * 14, sp = (1 - Math.abs(y) / 66) * 34;
      x.beginPath(); x.moveTo(0, y); x.lineTo(-sp, y - 10); x.stroke();
      x.beginPath(); x.moveTo(0, y); x.lineTo(sp, y - 10); x.stroke(); } }
  x.restore();
}
export function leafTexture(kind, size) {
  const c = canvas2d(size, size), x = c.getContext('2d');
  const g = x.createLinearGradient(0, size, 0, 0);
  g.addColorStop(0, '#b6c7ab'); g.addColorStop(.45, '#eef5e6'); g.addColorStop(1, '#fff');
  x.fillStyle = g; const S = size / 128;
  if (kind === 'bloom') {
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283 - 1.57;
      x.beginPath(); x.ellipse(64 * S + Math.cos(a) * 26 * S, 64 * S + Math.sin(a) * 26 * S, 25 * S, 20 * S, a, 0, 6.283); x.fill(); }
    x.fillStyle = 'rgba(255,240,200,.95)'; x.beginPath(); x.arc(64 * S, 64 * S, 11 * S, 0, 6.283); x.fill();
  } else if (kind === 'cluster') {
    const r = mulberry32(99);
    for (const [px, py, s, ro] of [[.5, .22, .40, -.1], [.26, .42, .36, -.7], [.74, .42, .36, .7], [.34, .70, .34, -.4], [.68, .72, .34, .5], [.5, .52, .38, .15]])
      leafPath(x, 'broad', px * size, py * size, s * S * (.9 + r() * .2), ro);
  } else leafPath(x, kind, 64 * S, 64 * S, S, 0);
  return toTex(c, true, false);
}
export function groundTextures(noise, size) {
  const H = new Float32Array(size * size);
  const c = canvas2d(size, size), x = c.getContext('2d'), im = x.createImageData(size, size), d = im.data;
  const r = mulberry32(4242);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const gr = fbm(noise, u * 60, v * 60, 2, 4) * .5 + .5;
    const bl = ridged(noise, u * 150, v * 40, 9, 2);
    const cl = fbm(noise, u * 9, v * 9, 17, 3) * .5 + .5;
    const hh = clamp(gr * .5 + bl * .35 + cl * .15, 0, 1);
    H[j * size + i] = hh;
    const s = .62 + hh * .55, k = (j * size + i) * 4;
    d[k] = clamp(s * (1 + (r() - .5) * .08), 0, 1) * 255; d[k + 1] = clamp(s * 1.03, 0, 1) * 255; d[k + 2] = clamp(s * .93, 0, 1) * 255; d[k + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const set = { map: toTex(c), normalMap: toTex(normalCanvas(H, size, size, 2.6), false) };
  set.ready = Promise.all([
    photoUpgrade(set.map, 'ground_col.jpg'),
    photoUpgrade(set.normalMap, 'ground_nor.jpg')
  ]).then(rr => rr[0]);
  return set;
}
export function rockTextures(noise, size) {
  const H = new Float32Array(size * size);
  const c = canvas2d(size, size), x = c.getContext('2d'), im = x.createImageData(size, size), d = im.data;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const hh = clamp(ridged(noise, u * 7, v * 7, 30, 4) * .7 + (fbm(noise, u * 30, v * 30, 5, 3) * .5 + .5) * .3, 0, 1);
    H[j * size + i] = hh; const s = .48 + hh * .55, k = (j * size + i) * 4;
    d[k] = s * 255; d[k + 1] = s * 252; d[k + 2] = s * 244; d[k + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return { map: toTex(c), normalMap: toTex(normalCanvas(H, size, size, 3.2), false) };
}
export function flowerTexture(size) {
  const c = canvas2d(size, size), x = c.getContext('2d'), S = size / 64;
  x.clearRect(0, 0, size, size);
  x.strokeStyle = 'rgba(130,160,95,.95)'; x.lineWidth = 2.4 * S;
  x.beginPath(); x.moveTo(32 * S, 62 * S); x.lineTo(32 * S, 30 * S); x.stroke();
  x.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283;
    x.beginPath(); x.ellipse(32 * S + Math.cos(a) * 11 * S, 26 * S + Math.sin(a) * 11 * S, 8 * S, 6 * S, a, 0, 6.283); x.fill(); }
  x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc(32 * S, 26 * S, 5.5 * S, 0, 6.283); x.fill();
  return toTex(c, true, false);
}
export function skinTextures(noise, size) {
  const H = new Float32Array(size * size);
  const c = canvas2d(size, size), x = c.getContext('2d'), im = x.createImageData(size, size), d = im.data;
  const r = mulberry32(777);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const pore = ridged(noise, u * 150, v * 150, 3, 2);
    const mott = fbm(noise, u * 14, v * 14, 9, 3) * .5 + .5;
    const fine = fbm(noise, u * 60, v * 60, 21, 2) * .5 + .5;
    const hh = clamp(pore * .55 + fine * .3 + mott * .15, 0, 1);
    H[j * size + i] = hh;
    let s = .84 + hh * .22;
    s *= .97 + mott * .06;
    const k = (j * size + i) * 4;
    d[k] = clamp(s * (1 + (r() - .5) * .03), 0, 1) * 255;
    d[k + 1] = clamp(s * .985, 0, 1) * 255; d[k + 2] = clamp(s * .965, 0, 1) * 255; d[k + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return { map: toTex(c), normalMap: toTex(normalCanvas(H, size, size, 1.5), false) };
}
export function fabricTextures(noise, size) {
  const H = new Float32Array(size * size);
  const c = canvas2d(size, size), x = c.getContext('2d'), im = x.createImageData(size, size), d = im.data;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const weave = (Math.sin(u * size * .9) * .5 + .5) * (Math.sin(v * size * .9) * .5 + .5);
    const fuzz = fbm(noise, u * 90, v * 90, 44, 2) * .5 + .5;
    const hh = clamp(weave * .6 + fuzz * .4, 0, 1);
    H[j * size + i] = hh;
    const s = .74 + hh * .34, k = (j * size + i) * 4;
    d[k] = s * 255; d[k + 1] = s * 255; d[k + 2] = s * 255; d[k + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return { map: toTex(c), normalMap: toTex(normalCanvas(H, size, size, 2.0), false) };
}
export function hairTextures(noise, size) {
  const H = new Float32Array(size * size);
  const c = canvas2d(size, size), x = c.getContext('2d'), im = x.createImageData(size, size), d = im.data;
  const r = mulberry32(313);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const strand = ridged(noise, u * 120, v * 6, 66, 2);
    const cl = fbm(noise, u * 20, v * 3, 12, 3) * .5 + .5;
    const hh = clamp(strand * .7 + cl * .3, 0, 1);
    H[j * size + i] = hh;
    const s = .40 + hh * .75 + (r() - .5) * .06, k = (j * size + i) * 4;
    d[k] = clamp(s, 0, 1) * 255; d[k + 1] = clamp(s * .97, 0, 1) * 255; d[k + 2] = clamp(s * .93, 0, 1) * 255; d[k + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return { map: toTex(c), normalMap: toTex(normalCanvas(H, size, size, 2.4), false) };
}
export function eyeTexture(size, irisHex) {
  const c = canvas2d(size, size), x = c.getContext('2d'), S = size / 256, R = size / 2;
  x.fillStyle = '#f2ece6'; x.fillRect(0, 0, size, size);
  const vg = x.createRadialGradient(R, R, R * .25, R, R, R);
  vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(196,168,158,.55)');
  x.fillStyle = vg; x.fillRect(0, 0, size, size);
  const rnd = mulberry32(5150);
  x.lineWidth = 1.1 * S;
  for (let i = 0; i < 46; i++) {
    const a = rnd() * 6.283, r0 = R * (.30 + rnd() * .18), r1 = R * (.62 + rnd() * .34);
    x.strokeStyle = 'rgba(196,72,66,' + (.10 + rnd() * .26) + ')';
    x.beginPath(); x.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0);
    let rr = r0, aa = a;
    while (rr < r1) { rr += 6 * S; aa += (rnd() - .5) * .3; x.lineTo(R + Math.cos(aa) * rr, R + Math.sin(aa) * rr); }
    x.stroke();
  }
  const ir = R * .34;
  const ic = new THREE.Color(irisHex);
  const base = `rgb(${Math.round(ic.r * 255)},${Math.round(ic.g * 255)},${Math.round(ic.b * 255)})`;
  const ig = x.createRadialGradient(R, R, ir * .18, R, R, ir);
  ig.addColorStop(0, '#0d0b0a'); ig.addColorStop(.28, base); ig.addColorStop(.82, base); ig.addColorStop(1, '#100e0c');
  x.fillStyle = ig; x.beginPath(); x.arc(R, R, ir, 0, 6.283); x.fill();
  for (let i = 0; i < 220; i++) {
    const a = rnd() * 6.283, r0 = ir * (.24 + rnd() * .1), r1 = ir * (.82 + rnd() * .16);
    x.strokeStyle = rnd() < .5 ? 'rgba(255,240,215,' + (.05 + rnd() * .22) + ')' : 'rgba(20,14,10,' + (.06 + rnd() * .26) + ')';
    x.lineWidth = (.6 + rnd() * 1.5) * S;
    x.beginPath(); x.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0);
    x.lineTo(R + Math.cos(a + (rnd() - .5) * .12) * r1, R + Math.sin(a + (rnd() - .5) * .12) * r1); x.stroke();
  }
  x.strokeStyle = 'rgba(12,10,9,.85)'; x.lineWidth = 3.2 * S;
  x.beginPath(); x.arc(R, R, ir * .97, 0, 6.283); x.stroke();
  x.fillStyle = '#050404'; x.beginPath(); x.arc(R, R, ir * .38, 0, 6.283); x.fill();
  x.fillStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.ellipse(R - ir * .3, R - ir * .34, ir * .17, ir * .12, -.6, 0, 6.283); x.fill();
  return toTex(c, true, false);
}
