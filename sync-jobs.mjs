import { once } from 'node:events';
import { readFile, rename, writeFile } from 'node:fs/promises';

const site = new URL(process.env.JOBS_SITE_URL || 'http://127.0.0.1:3210');
const local = site.hostname === '127.0.0.1' && site.protocol === 'http:';
if (!local && site.protocol !== 'https:') throw new Error('Vzdálený web musí používat HTTPS.');
if (site.pathname !== '/' || site.search || site.hash || site.username || site.password) {
  throw new Error('Použij samotný původ webu bez cesty a přihlašovacích údajů.');
}
const regionFiles = ['CZ.json', 'SWISS.json', 'DE_AU.json', 'EU.json'];
const base = new URL('./', import.meta.url);

function filename(country) {
  return { CZ: 'CZ.json', CH: 'SWISS.json', AT: 'DE_AU.json', DE: 'DE_AU.json' }[country] ?? 'EU.json';
}

function normalized(url) {
  const source = new URL(url);
  source.hash = '';
  return source.href;
}

async function readJson(path) {
  try {
    const entries = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('Očekávám pole nabídek.');
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function tokenFromStdin() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    console.log('Připraveno přijmout autorizační token na stdin.');
    try {
      let input = '';
      while (!/[\r\n]/.test(input)) {
        const [chunk] = await once(process.stdin, 'data');
        if (chunk.includes(3)) throw new Error('Přerušeno.');
        input += chunk.toString('utf8');
      }
      return input.trim();
    } finally {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk.toString('utf8');
  return input.trim();
}

const batchPath = process.argv[2];
if (!batchPath) throw new Error('Zadej cestu k JSON souboru s výsledky skenu.');
const incoming = await readJson(batchPath);
if (!incoming) throw new Error('Soubor s výsledky skenu neexistuje.');
const removalsPath = process.argv[3];
const removals = removalsPath ? await readJson(removalsPath) : [];
if (!removals || removals.some(url => typeof url !== 'string')) throw new Error('Očekávám pole URL ukončených nabídek.');
const removedUrls = new Set(removals.map(normalized));
const archives = new Map(await Promise.all(regionFiles.map(async name => [
  name, await readJson(new URL(name, base)),
])));
const token = local ? null : await tokenFromStdin();
if (!local && !token) throw new Error('Chybí služební token Sites.');

async function request(path, entries, method = 'POST') {
  const headers = token ? { 'OAI-Sites-Authorization': 'Bearer ' + token } : {};
  const init = entries === undefined ? { headers } : {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(new URL(path, site), {
      ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.json();
    if (response.status !== 409 && response.status < 500) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Sites ${response.status}: ${error.error ?? 'požadavek zamítnut'}`);
    }
  }
  throw new Error('Sites po opakovaných pokusech neodpověděl úspěšně.');
}

const before = await request('/jobs.json');
const known = new Set(before.map(job => job.url));
const pending = incoming.filter(job => {
  const url = normalized(job.url);
  if (known.has(url) || removedUrls.has(url)) return false;
  known.add(url);
  return true;
});
for (let index = 0; index < pending.length; index += 50) {
  await request('/api/jobs', pending.slice(index, index + 50));
}
const maintenance = await request('/api/jobs', [...removedUrls], 'PATCH');
const stored = await request('/jobs.json');
const hosted = new Map(stored.map(job => [job.url, job]));
if (pending.some(job => !hosted.has(normalized(job.url))) || [...removedUrls].some(url => hosted.has(url))) {
  throw new Error('Čtení po zápisu nepotvrdilo výsledek importu a kontroly.');
}

const summary = {};
for (const [name, previous] of archives) {
  const existing = new Set((previous ?? []).map(job => normalized(job.url)));
  const appended = stored.filter(job => filename(job.country) === name && !existing.has(job.url));
  const retained = (previous ?? []).map(job => hosted.get(normalized(job.url))).filter(Boolean);
  const merged = [...retained, ...appended];
  if (JSON.stringify(previous) !== JSON.stringify(merged)) {
    const temp = new URL('.' + name + '.tmp', base);
    await writeFile(temp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    await rename(temp, new URL(name, base));
  }
  summary[name] = { added: appended.length, removed: (previous?.length ?? 0) - retained.length, total: merged.length };
}
console.log(JSON.stringify({ files: summary, removed: maintenance.removed, hostedTotal: stored.length }, null, 2));
