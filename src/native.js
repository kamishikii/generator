import { Capacitor } from '@capacitor/core';
export const NATIVE = Capacitor.isNativePlatform();

let haptics = null;
export async function buzz(style = 'LIGHT') {
  if (!NATIVE) return;
  try {
    if (!haptics) haptics = await import('@capacitor/haptics');
    await haptics.Haptics.impact({ style: haptics.ImpactStyle[style] || haptics.ImpactStyle.Light });
  } catch (e) {}
}
function browserDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 8000);
}
const CHUNK = 2 * 1024 * 1024;

export async function saveArtifact({ filename, text, base64, blob, mime, title, onProgress }) {
  const data = base64 || text;
  if (NATIVE && data) {
    let FS;
    try { FS = await import('@capacitor/filesystem'); }
    catch (e) { FS = null; }
    if (FS) {
      const { Filesystem, Directory, Encoding } = FS;
      const enc = base64 ? Encoding.Base64 : Encoding.UTF8;
      const path = 'drevo-' + Date.now() + '-' + filename;
      try {
        await Filesystem.writeFile({ path, data: data.slice(0, CHUNK), directory: Directory.Cache, encoding: enc, recursive: true });
        for (let i = CHUNK; i < data.length; i += CHUNK) {
          await Filesystem.appendFile({ path, data: data.slice(i, i + CHUNK), directory: Directory.Cache, encoding: enc });
          if (onProgress) onProgress(Math.min(1, (i + CHUNK) / data.length), 'запись файла');
        }
        const res = await Filesystem.getUri({ path, directory: Directory.Cache });
        try {
          const { Share } = await import('@capacitor/share');
          await Share.share({ title, files: [res.uri], url: res.uri, dialogTitle: title });
          return 'Отправлено: ' + filename;
        } catch (e) {
          const dir = 'DREVO/' + filename;
          await Filesystem.writeFile({ path: dir, data: data.slice(0, CHUNK), directory: Directory.Documents, encoding: enc, recursive: true });
          for (let i = CHUNK; i < data.length; i += CHUNK)
            await Filesystem.appendFile({ path: dir, data: data.slice(i, i + CHUNK), directory: Directory.Documents, encoding: enc });
          return 'Сохранено в Documents/DREVO/' + filename;
        }
      } catch (e) {
        try {
          const dir = 'DREVO/' + filename;
          await Filesystem.writeFile({ path: dir, data: data.slice(0, CHUNK), directory: Directory.Documents, encoding: enc, recursive: true });
          for (let i = CHUNK; i < data.length; i += CHUNK)
            await Filesystem.appendFile({ path: dir, data: data.slice(i, i + CHUNK), directory: Directory.Documents, encoding: enc });
          return 'Сохранено в Documents/DREVO/' + filename;
        } catch (e2) { throw new Error('файловая система: ' + (e2.message || e2)); }
      }
    }
  }
  const b = blob || (base64
    ? await (await fetch('data:' + mime + ';base64,' + base64)).blob()
    : new Blob([text], { type: mime }));
  browserDownload(b, filename);
  return 'Скачано: ' + filename;
}
export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) s += String.fromCharCode.apply(null, buf.subarray(i, i + step));
  return btoa(s);
}
export function initNative({ onBack, onActive, onInactive }) {
  if (!NATIVE) return;
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setBackgroundColor({ color: '#0a1411' }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }).catch(() => {});
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { isActive ? onActive() : onInactive(); });
    App.addListener('backButton', () => onBack(() => App.exitApp()));
  }).catch(() => {});
}
