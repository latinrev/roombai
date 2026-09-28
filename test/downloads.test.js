const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseDownloads, versionAssetLinks } = require('../scripts/build-downloads');

test('changed styles and scripts get fresh asset URLs while external analytics stays unchanged', () => {
  const html = '<link href="site.css"><script src="community.js"></script><script src="https://example.com/script.js"></script>';
  const first = versionAssetLinks(html, url => url === 'site.css' ? 'old styles' : 'same script');
  const next = versionAssetLinks(html, url => url === 'site.css' ? 'new styles' : 'same script');
  assert.notEqual(first.match(/site.css[^\"]+/)[0], next.match(/site.css[^\"]+/)[0]);
  assert.equal(first.match(/community.js[^\"]+/)[0], next.match(/community.js[^\"]+/)[0]);
  assert.ok(next.includes('src="https://example.com/script.js"'));
  assert.equal(versionAssetLinks(next, () => { throw new Error('already versioned'); }), next);
});

function release() {
  return { tag_name: 'v2.3.4', draft: false, prerelease: false, assets: [
    'Roombai-Setup-2.3.4.exe', 'Roombai-2.3.4-mac.dmg', 'Roombai-2.3.4-linux-x86_64.AppImage',
    'Roombai-Portable-2.3.4.exe', 'Roombai-2.3.4-linux-amd64.deb',
  ].map(name => ({ name, size: 100, browser_download_url: `https://github.com/latinrev/roombai/releases/download/v2.3.4/${name}` })) };
}

test('website downloads follow the published release, without a hardcoded version', () => {
  const result = releaseDownloads(release());
  assert.equal(Object.keys(result).length, 5);
  assert.ok(Object.values(result).every(url => url.includes('/v2.3.4/')));
  assert.ok(result.linux.endsWith('.AppImage'));
  assert.ok(result.deb.endsWith('.deb'));
});

test('incomplete, draft, or prerelease builds cannot replace the live download links', () => {
  for (const invalid of [{ ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), assets: [] }]) {
    assert.throws(() => releaseDownloads(invalid));
  }
});

test('download links must point to this repository and release', () => {
  const invalid = release();
  invalid.assets[0].browser_download_url = 'https://example.com/installer.exe';
  assert.throws(() => releaseDownloads(invalid));
});
