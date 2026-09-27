// Read-only GitHub lookups for the whiteboard's ISSUES and PRS faces.
// Uses the GitHub CLI (`gh`) so it rides on whatever account you're already logged into.
const { execFile } = require('child_process');

const TTL = 3 * 60e3;
const repoCache = new Map(); // cwd -> { slug, at }
const dataCache = new Map(); // slug -> { at, issues, prs, error }
let ghState = null; // 'ok' | 'missing' | 'logged-out'

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 8e6, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || ''), code: err && err.code });
    });
  });
}

async function checkGh() {
  if (ghState) return ghState;
  const r = await run('gh', ['auth', 'status']);
  if (r.code === 'ENOENT') ghState = 'missing';
  else ghState = r.ok ? 'ok' : 'logged-out';
  return ghState;
}

async function repoFor(cwd) {
  const hit = repoCache.get(cwd);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.slug;
  const r = await run('git', ['-C', cwd, 'remote', 'get-url', 'origin']);
  const m = r.ok && r.out.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  const slug = m ? `${m[1]}/${m[2]}` : null;
  repoCache.set(cwd, { slug, at: Date.now() });
  return slug;
}

function ciState(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    const v = String(c.conclusion || c.state || '').toUpperCase();
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) return 'fail';
    if (!v || ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'WAITING'].includes(v)) pending = true;
  }
  return pending ? 'pending' : 'pass';
}

async function fetchRepo(slug, force) {
  const hit = dataCache.get(slug);
  if (hit && !force && Date.now() - hit.at < TTL) return hit;
  const [iss, prs] = await Promise.all([
    run('gh', ['issue', 'list', '-R', slug, '--state', 'open', '--limit', '30', '--json', 'number,title,labels,author,updatedAt,url,comments']),
    run('gh', ['pr', 'list', '-R', slug, '--state', 'open', '--limit', '30', '--json', 'number,title,isDraft,reviewDecision,statusCheckRollup,author,updatedAt,url,headRefName']),
  ]);
  const parse = (r) => { try { return JSON.parse(r.out); } catch { return []; } };
  const data = {
    at: Date.now(),
    error: !iss.ok && !prs.ok ? (iss.err || prs.err).trim().split('\n').pop() : null,
    issues: parse(iss).map((i) => ({
      number: i.number, title: i.title, url: i.url, updatedAt: i.updatedAt,
      author: i.author && i.author.login, comments: Array.isArray(i.comments) ? i.comments.length : 0,
      labels: (i.labels || []).map((l) => ({ name: l.name, color: '#' + (l.color || '999999') })),
    })),
    prs: parse(prs).map((p) => ({
      number: p.number, title: p.title, url: p.url, updatedAt: p.updatedAt, draft: p.isDraft,
      author: p.author && p.author.login, branch: p.headRefName,
      review: p.reviewDecision || '', ci: ciState(p.statusCheckRollup),
    })),
  };
  dataCache.set(slug, data);
  return data;
}

// cwds: the project folders shown in a room (one for a project room, many for the Garage)
async function lookup(cwds, force = false) {
  const gh = await checkGh();
  if (gh !== 'ok') return { state: gh, repos: [] };
  const slugs = [...new Set((await Promise.all(cwds.map(repoFor))).filter(Boolean))];
  if (!slugs.length) return { state: 'no-repo', repos: [] };
  const repos = await Promise.all(slugs.map(async (slug) => ({ slug, ...(await fetchRepo(slug, force)) })));
  return { state: 'ok', repos };
}

module.exports = { lookup };
