import * as THREE from 'three';
import { clamp, lerp, fbm, ridged, mulberry32 } from './noise.js';

export function canvas2d(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function toTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; t.needsUpdate = true; return t;
}
function normalCanvas(H, w, h, strength) {
  const c = canvas2d(w, h), x = c.getContext('2d'), out = x.createImageData(w, h), o = out.data;
  const at = (i, j) => H[((j + h) % h) * w + ((i + w) % w)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * strength, dy = (at(i, j + 1) - at(i, j - 1)) * strength;
    let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz);
    const k = (j * w + i) * 4;
    o[k] = (nx / l * .5 + .5) * 255; o[k + 1] = (ny / l * .5 + .5) * 255; o[k + 2] = (nz / l * .5 + .5) * 255; o[k + 3] = 255;
  }
  x.putImageData(out, 0, 0); return c;
}
export function* barkJob(noise, w) {
  const h = w * 2, H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const wx = u * 9 + fbm(noise, u * 3.1, v * 1.4, 3.3, 2) * .6;
      const plates = ridged(noise, wx * 3.0, v * 2.2, 0, 4, 2.1, .55);
      const fine = fbm(noise, u * 46, v * 12, 7.7, 3) * .5 + .5;
      const crack = ridged(noise, wx * 6.2 + 13, v * 3.1, 5, 2);
      let hh = Math.pow(plates, 1.7) * .82 + fine * .18;
      hh -= Math.pow(Math.max(0, crack - .70) / .30, 1.4) * .62;
      const brk = fbm(noise, u * 7, v * 30, 21, 2);
      if (brk > .40) hh -= (brk - .40) * 1.1;
      H[y * w + x] = clamp(hh, 0, 1);
    }
    if (y % 48 === 0) yield { p: .6 * (y / h), label: 'карта коры' };
  }
  const albedo = canvas2d(w, h), ax = albedo.getContext('2d'), im = ax.createImageData(w, h), d = im.data;
  const rough = canvas2d(w, h), rx = rough.getContext('2d'), rim = rx.createImageData(w, h), rd = rim.data;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w, i = y * w + x, k = i * 4, hh = H[i];
      const shade = .20 + .80 * Math.pow(hh, .85), tint = fbm(noise, u * 5.5, v * 3.2, 40, 2);
      let r = shade * (1 + tint * .07), g = shade * (.97 + tint * .03), b = shade * (.92 - tint * .05);
      const lich = fbm(noise, u * 15, v * 8, 60, 3);
      if (lich > .34) { const t = clamp((lich - .34) / .4, 0, 1) * .65; r = lerp(r, .60, t); g = lerp(g, .68, t); b = lerp(b, .54, t); }
      d[k] = clamp(r, 0, 1) * 255; d[k + 1] = clamp(g, 0, 1) * 255; d[k + 2] = clamp(b, 0, 1) * 255; d[k + 3] = 255;
      const ro = clamp(.96 - hh * .28, .45, 1) * 255;
      rd[k] = ro; rd[k + 1] = ro; rd[k + 2] = ro; rd[k + 3] = 255;
    }
    if (y % 96 === 0) yield { p: .6 + .3 * (y / h), label: 'альбедо коры' };
  }
  ax.putImageData(im, 0, 0); rx.putImageData(rim, 0, 0);
  yield { p: .95, label: 'нормали коры' };
  return { map: toTex(albedo), normalMap: toTex(normalCanvas(H, w, h, 5.5), false), roughnessMap: toTex(rough, false) };
}
export function barkTextures(noise, w) { const g = barkJob(noise, w); let r = g.next(); while (!r.done) r = g.next(); return r.value; }

function leafPath(x, kind, cx, cy, s, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
  const narrow = kind === 'needle';
  x.beginPath(); x.moveTo(0, 60);
  x.bezierCurveTo(narrow ? -18 : -56, 24, narrow ? -14 : -48, -36, 0, -60);
  x.bezierCurveTo(narrow ? 14 : 48, -36, narrow ? 18 : 56, 24, 0, 60);
  x.closePath(); x.fill();
  x.strokeStyle = 'rgba(105,125,95,.5)'; x.lineWidth = narrow ? 1.6 : 2.2;
  x.beginPath(); x.moveTo(0, 56); x.lineTo(0, -56); x.stroke();
  if (!narrow) { x.lineWidth = 1.1;
    for (let i = -3; i <= 3; i++) { const y = i * 14, sp = (1 - Math.abs(y) / 66) * 34;
      x.beginPath(); x.moveTo(0, y); x.lineTo(-sp, y - 10); x.stroke();
      x.beginPath(); x.moveTo(0, y); x.lineTo(sp, y - 10); x.stroke(); } }
  x.restore();
}
export function leafTexture(kind, size) {
  const c = canvas2d(size, size), x = c.getContext('2d');
  const g = x.createLinearGradient(0, size, 0, 0);
  g.addColorStop(0, '#b6c7ab'); g.addColorStop(.45, '#eef5e6'); g.addColorStop(1, '#ffffff');
  x.fillStyle = g; const S = size / 128;
  if (kind === 'bloom') {
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2;
      x.beginPath(); x.ellipse(64 * S + Math.cos(a) * 26 * S, 64 * S + Math.sin(a) * 26 * S, 25 * S, 20 * S, a, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = 'rgba(255,240,200,.95)'; x.beginPath(); x.arc(64 * S, 64 * S, 11 * S, 0, Math.PI * 2); x.fill();
  } else if (kind === 'cluster') {
    const rng = mulberry32(99);
    for (const [px, py, s, r] of [[.5, .22, .40, -.1], [.26, .42, .36, -.7], [.74, .42, .36, .7], [.34, .70, .34, -.4], [.68, .72, .34, .5], [.5, .52, .38, .15]])
      leafPath(x, 'broad', px * size, py * size, s * S * (.9 + rng() * .2), r);
  } else leafPath(x, kind, 64 * S, 64 * S, S, 0);
  return toTex(c, true, false);
}
export function groundTextures(noise, size) {
  const H = new Float32Array(size * size);
  const c = canvas2d(size, size), x = c.getContext('2d'), im = x.createImageData(size, size), d = im.data;
  const rng = mulberry32(4242);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const grain = fbm(noise, u * 60, v * 60, 2, 4) * .5 + .5;
    const blades = ridged(noise, u * 150, v * 40, 9, 2);
    const clumps = fbm(noise, u * 9, v * 9, 17, 3) * .5 + .5;
    const hh = clamp(grain * .5 + blades * .35 + clumps * .15, 0, 1);
    H[j * size + i] = hh;
    const s = .60 + hh * .58, k = (j * size + i) * 4;
    d[k] = clamp(s * (1 + (rng() - .5) * .08), 0, 1) * 255;
    d[k + 1] = clamp(s * 1.03, 0, 1) * 255; d[k + 2] = clamp(s * .93, 0, 1) * 255; d[k + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return { map: toTex(c), normalMap: toTex(normalCanvas(H, size, size, 2.4), false) };
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
  x.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2;
    x.beginPath(); x.ellipse(32 * S + Math.cos(a) * 11 * S, 26 * S + Math.sin(a) * 11 * S, 8 * S, 6 * S, a, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc(32 * S, 26 * S, 5.5 * S, 0, Math.PI * 2); x.fill();
  return toTex(c, true, false);
}
