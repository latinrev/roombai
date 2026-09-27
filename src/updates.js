const semver = require('semver');

const RELEASES = 'https://github.com/latinrev/roombai/releases/latest';
const RELEASE_API = 'https://api.github.com/repos/latinrev/roombai/releases/latest';

function createUpdates({ app, dialog, shell, getUpdater, onChange = () => {},
  platform = process.platform, env = process.env, fetchRelease = globalThis.fetch,
  timers = globalThis, disabled = false }) {
  const enabled = app.isPackaged && !disabled;
  const automatic = enabled && ((platform === 'win32' && !env.PORTABLE_EXECUTABLE_DIR)
    || (platform === 'linux' && Boolean(env.APPIMAGE)));
  let state = enabled ? 'idle' : 'disabled';
  let updater;
  let busy = false;
  let prompting = false;
  let disposed = false;
  let version = '';
  let notified = '';
  let startup;
  let interval;
  const setState = (next) => { if (!disposed) { state = next; onChange(); } };
  const message = (options) => dialog.showMessageBox({ title: 'Roombai updates', ...options });

  async function offerRestart() {
    if (prompting || disposed) return;
    prompting = true;
    try {
      const { response } = await message({ type: 'info', message: `Roombai ${version} is ready to install.`,
        detail: 'Restart Roombai to apply the update. Your coding agents will keep running.',
        buttons: ['Restart and install', 'Later'], defaultId: 1, cancelId: 1 });
      if (response === 0 && !disposed) updater.quitAndInstall();
    } finally { prompting = false; }
  }

  async function offerDownload() {
    if (prompting || disposed) return;
    prompting = true;
    try {
      const { response } = await message({ type: 'info', message: `Roombai ${version} is available.`,
        detail: 'This build needs a manual update. Download the latest version and replace your current installation.',
        buttons: ['Open downloads', 'Later'], defaultId: 1, cancelId: 1 });
      if (response === 0 && !disposed) await shell.openExternal(RELEASES);
    } finally { prompting = false; }
  }

  function configureUpdater() {
    if (updater) return;
    updater = getUpdater();
    updater.autoDownload = true;
    // Never restart or install on an ordinary quit without the user's choice.
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('update-available', (info) => { version = info.version; setState('downloading'); });
    updater.on('update-downloaded', (info) => {
      version = info.version;
      setState('ready');
      void offerRestart().catch(() => {});
    });
    // EventEmitter errors must have a listener; check/download promise errors
    // below show a message only when the user explicitly initiated the check.
    updater.on('error', () => setState('error'));
  }

  async function check(manual = false) {
    if (!enabled || disposed || busy) return;
    if (state === 'ready') { if (manual) await offerRestart(); return; }
    busy = true;
    setState('checking');
    try {
      let available = false;
      if (automatic) {
        configureUpdater();
        const result = await updater.checkForUpdates();
        available = Boolean(result && semver.gt(result.updateInfo.version, app.getVersion()));
        if (result?.downloadPromise) await result.downloadPromise;
      } else {
        const response = await fetchRelease(RELEASE_API, {
          headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Release lookup failed');
        const release = await response.json();
        const latest = semver.valid(release.tag_name);
        available = Boolean(latest && !release.draft && !release.prerelease && semver.gt(latest, app.getVersion()));
        if (available) {
          version = latest;
          setState('available');
          if (manual || notified !== version) { notified = version; await offerDownload(); }
        }
      }
      if (!available) {
        setState('idle');
        if (manual) await message({ type: 'info', message: 'Roombai is up to date.', buttons: ['OK'] });
      }
    } catch {
      setState('error');
      if (manual && !disposed) await message({ type: 'warning', message: 'Could not check for or download an update.',
        detail: 'Check your connection and try again later.', buttons: ['OK'] });
    } finally { busy = false; onChange(); }
  }

  function start() {
    if (!enabled || startup || disposed) return;
    startup = timers.setTimeout(() => { void check(); }, 15000);
    interval = timers.setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
    startup.unref?.();
    interval.unref?.();
  }

  return {
    start, check,
    menuItem() {
      const label = state === 'disabled' ? 'Updates available in installed builds'
        : state === 'ready' ? `Restart to install ${version}…`
        : state === 'downloading' ? `Downloading ${version}…`
        : state === 'checking' ? 'Checking for updates…' : 'Check for updates…';
      return { label, enabled: enabled && !busy, click: () => { void check(true).catch(() => {}); } };
    },
    dispose() { disposed = true; timers.clearTimeout(startup); timers.clearInterval(interval); },
  };
}

module.exports = { createUpdates };
