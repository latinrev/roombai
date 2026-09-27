// Copies the real app renderer into site/app/ so the landing page can run the actual room
// in the browser, fed by pretend agents from site/app/demo-bridge.js. Run: npm run site
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'src', 'renderer');
const to = path.join(root, 'site', 'app');
fs.mkdirSync(to, { recursive: true });

for (const f of ['pixelfont.js', 'sfx.js', 'furniture.js', 'rooms.js', 'game.js', 'style.css']) {
  fs.copyFileSync(path.join(from, f), path.join(to, f));
}

let html = fs.readFileSync(path.join(from, 'index.html'), 'utf8');
html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '')
  .replace('<title>Roombai</title>', '<title>Roombai demo</title>\n<link rel="stylesheet" href="demo.css" />')
  .replace('  <script src="pixelfont.js"></script>', '  <script src="demo-bridge.js"></script>\n  <script src="pixelfont.js"></script>');
fs.writeFileSync(path.join(to, 'index.html'), html);
console.log('site/app updated from src/renderer');
