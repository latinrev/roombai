// Resolve downloads at deployment time, after GitHub has published every asset.
const fs = require('node:fs');
const path = require('node:path');
const API = 'https://api.github.com/repos/latinrev/roombai/releases/latest';

function releaseDownloads(release) {
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('Expected a published stable release');
  }
  const version = release.tag_name.slice(1);
  const filenames = {
    windows: `Roombai-Setup-${version}.exe`,
    mac: `Roombai-${version}-mac.dmg`,
    linux: `Roombai-${version}-linux-x86_64.AppImage`,
    portable: `Roombai-Portable-${version}.exe`,
    deb: `Roombai-${version}-linux-amd64.deb`,
  };
  return Object.fromEntries(Object.entries(filenames).map(([key, name]) => {
    const asset = release.assets?.find(a => a.name === name);
    const expected = `https://github.com/latinrev/roombai/releases/download/${release.tag_name}/${name}`;
    if (!asset || asset.size <= 0 || asset.browser_download_url !== expected) {
      throw new Error(`Published release is missing a valid ${key} download`);
    }
    return [key, expected];
  }));
}

async function build() {
  const response = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub release lookup failed: ${response.status}`);
  const release = await response.json();
  const downloads = releaseDownloads(release);
  const source = path.join(__dirname, '../site');
  const output = path.join(source, '.output');
  const filename = path.join(source, 'index.html');
  const seen = new Set();
  const html = fs.readFileSync(filename, 'utf8').replace(/<a\b([^>]*\bdata-download-asset="([^"]+)"[^>]*)>/g, (_, attrs, key) => {
    if (!downloads[key]) throw new Error(`Unknown download: ${key}`);
    seen.add(key);
    return `<a${attrs.replace(/href="[^"]*"/, `href="${downloads[key]}"`)}>`;
  });
  if (seen.size !== Object.keys(downloads).length) throw new Error('Website is missing a download link');
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (name !== '.output' && name !== 'downloads') fs.cpSync(path.join(source, name), path.join(output, name), { recursive: true });
  }
  fs.writeFileSync(path.join(output, 'index.html'), html);
  console.log(`Website downloads resolved from published release ${release.tag_name}`);
}

if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { releaseDownloads };
