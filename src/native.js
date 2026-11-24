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
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function saveArtifact({ filename, text, base64, mime, title }) {
  if (NATIVE) {
    try {
      const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'), import('@capacitor/share')
      ]);
      const opts = { path: filename, directory: Directory.Cache, recursive: true };
      if (base64) { opts.data = base64; opts.encoding = Encoding.Base64; }
      else { opts.data = text; opts.encoding = Encoding.UTF8; }
      const res = await Filesystem.writeFile(opts);
      await Share.share({ title, files: [res.uri], dialogTitle: title });
      return 'файл ' + filename + ' отправлен';
    } catch (e) {
      if (String(e && e.message).toLowerCase().includes('cancel')) return null;
    }
  }
  const blob = base64
    ? await (await fetch('data:' + mime + ';base64,' + base64)).blob()
    : new Blob([text], { type: mime });
  browserDownload(blob, filename);
  return 'сохранено: ' + filename;
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
