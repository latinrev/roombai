const semver = require('semver');

const RELEASES = 'https://github.com/latinrev/roombai/releases/latest';
const RELEASE_API = 'https://api.github.com/repos/latinrev/roombai/releases/latest';

function createUpdates({ app, shell, getUpdater, onChange = () => {},
  platform = process.platform, env = process.env, fetchRelease = globalThis.fetch,
  timers = globalThis, disabled = false }) {
  const enabled = app.isPackaged && !disabled;
  const automatic = enabled && ((platform === 'win32' && !env.PORTABLE_EXECUTABLE_DIR)
    || (platform === 'linux' && Boolean(env.APPIMAGE)));
  let state = enabled ? 'idle' : 'disabled';
  let updater;
  let busy = false;
  let disposed = false;
  let version = '';
  let startup;
  let interval;
  const setState = (next) => { if (!disposed) { state = next; onChange(); } };

  function configureUpdater() {
    if (updater) return;
    updater = getUpdater();
    // Only check in the background. Nothing downloads until the person clicks Update.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('update-available', (info) => { version = info.version; setState('available'); });
    // Handle EventEmitter errors; rejected check/download promises set UI state below.
    updater.on('error', () => {});
  }

  async function check(manual = false) {
    if (!enabled || disposed || busy || state === 'ready') return;
    busy = true;
    setState('checking');
    try {
      let available = false;
      if (automatic) {
        configureUpdater();
        const result = await updater.checkForUpdates();
        available = Boolean(result && semver.gt(result.updateInfo.version, app.getVersion()));
        if (available) { version = result.updateInfo.version; setState('available'); }
      } else {
        const response = await fetchRelease(RELEASE_API, {
          headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Release lookup failed');
        const release = await response.json();
        const latest = semver.valid(release.tag_name);
        available = Boolean(latest && !release.draft && !release.prerelease && semver.gt(latest, app.getVersion()));
        if (available) { version = latest; setState('available'); }
      }
      if (!available) setState(manual ? 'current' : 'idle');
    } catch {
      setState(manual || version ? 'error' : 'idle');
    } finally { busy = false; if (!disposed) onChange(); }
  }

  async function install() {
    if (!enabled || disposed || busy) return;
    if (state === 'error') { await check(true); return; }
    try {
      if (state === 'available' && automatic) {
        // One click: download, then install silently in place and reopen Roombai.
        busy = true;
        setState('downloading');
        await updater.downloadUpdate();
        setState('ready');
        updater.quitAndInstall(true, true);
      } else if (state === 'ready') {
        busy = true;
        onChange();
        updater.quitAndInstall(true, true);
      } else if (state === 'available' && !automatic) {
        await shell.openExternal(RELEASES);
      }
    } catch { busy = false; setState('error'); }
  }

  function start() {
    if (!enabled || startup || disposed) return;
    startup = timers.setTimeout(() => { void check(); }, 15000);
    interval = timers.setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
    startup.unref?.();
    interval.unref?.();
  }

  return {
    start, check, install,
    status: () => ({ state, version, automatic, busy }),
    dispose() { disposed = true; timers.clearTimeout(startup); timers.clearInterval(interval); },
  };
}

module.exports = { createUpdates };
