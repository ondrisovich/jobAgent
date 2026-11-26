import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const regions = ['CZ.json', 'SWISS.json', 'DE_AU.json', 'EU.json'];
const europe = new Set('AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GE GR HR HU IE IS IT XK KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA VA'.split(' '));
const fields = ['title', 'city', 'country', 'salary', 'remote', 'description', 'url'];
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function canonical(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid public listing URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['gclid', 'fbclid'].includes(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
const regionFor = country => ({ CZ: 'CZ.json', CH: 'SWISS.json', DE: 'DE_AU.json', AT: 'DE_AU.json' }[country] ?? 'EU.json');
export function validateReport(report, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw Error('Invalid date');
  if (report.schemaVersion !== 1 || report.date !== date || report.timezone !== 'Europe/Paris' || !['complete', 'partial'].includes(report.status)) throw Error('Wrong date, version, timezone or report status');
  if (!Number.isFinite(Date.parse(report.generatedAt)) || localDate(new Date(report.generatedAt)) !== date) throw Error('Invalid generation timestamp');
  if (!Array.isArray(report.coverage) || report.coverage.length !== 5 || new Set(report.coverage.map(c => c.region)).size !== 5) throw Error('Incomplete coverage');
  for (const name of ['CZ', 'CH', 'DE', 'AT', 'EUROPE']) {
    const item = report.coverage.find(c => c.region === name);
    if (!item || !Array.isArray(item.queries) || (report.status === 'complete' && !item.queries.length) || item.queries.some(q => typeof q !== 'string' || !q.trim()) || !Array.isArray(item.sourceUrls) || (report.status === 'complete' && !item.sourceUrls.length) || typeof item.notes !== 'string' || (report.status === 'partial' && !item.notes.trim())) throw Error('Missing search evidence: ' + name);
    item.sourceUrls.forEach(canonical);
  }
  if (!Array.isArray(report.jobs)) throw Error('jobs must be an array');
  return report.jobs.map(job => {
    if (!job || typeof job !== 'object') throw Error('Invalid job');
    for (const field of ['title', 'description', 'url']) if (typeof job[field] !== 'string' || !job[field].trim()) throw Error('Invalid ' + field);
    for (const field of ['city', 'salary']) if (job[field] !== null && typeof job[field] !== 'string') throw Error('Invalid ' + field);
    if (!europe.has(job.country) || !['yes', 'no', 'na'].includes(job.remote) || !['local', 'remote', 'fifo'].includes(job.category)) throw Error('Invalid country, remote policy or category');
    if (!Number.isFinite(Date.parse(job.verifiedAt)) || localDate(new Date(job.verifiedAt)) !== date) throw Error('Listing must be verified on report date');
    const pay = job.compensation;
    if (pay !== null) {
      if (!pay || !Number.isFinite(pay.minimum) || pay.minimum < 0 || !['CZK', 'CHF', 'EUR'].includes(pay.currency) || !['month', 'year', 'hour'].includes(pay.period) || typeof pay.gross !== 'boolean' || !['employment', 'b2b'].includes(pay.kind) || typeof pay.evidence !== 'string' || !pay.evidence.trim() || !job.salary?.trim()) throw Error('Invalid compensation evidence');
      canonical(pay.sourceUrl);
    }
    const meets = (currency, period, amount, strict = false) => pay?.currency === currency && pay.period === period && (strict ? pay.minimum > amount : pay.minimum >= amount);
    if (job.country === 'CZ' && !(meets('CZK', 'month', 80000, true) && pay.gross && pay.kind === 'employment')) throw Error('CZ requires confirmed gross monthly salary >80000 CZK');
    if (job.category === 'remote' && !(job.remote === 'yes' && ((meets('EUR', 'year', 100000, true) && pay.gross && pay.kind === 'employment') || (meets('EUR', 'hour', 85) && pay.kind === 'b2b')))) throw Error('Remote salary below threshold or unverified');
    if (job.category === 'fifo' && !(meets('EUR', 'hour', 100) && pay.kind === 'b2b')) throw Error('FIFO requires confirmed >=100 EUR/hour');
    if (job.country === 'CH' && typeof job.salaryNotes !== 'string') throw Error('Swiss salary information or explicit absence required');
    const result = Object.fromEntries(fields.map(field => [field, job[field]]));
    result.url = canonical(job.url);
    result.savedAt = report.generatedAt;
    return result;
  });
}

export async function importReport(root, date = localDate()) {
  const reportPath = resolve(root, 'reports', date + '.json');
  let raw;
  try { raw = await readFile(reportPath, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', date, changed: [] };
    throw error;
  }
  const report = JSON.parse(raw);
  const incoming = validateReport(report, date);
  const digest = createHash('sha256').update(raw).digest('hex');
  const marker = resolve(root, '.imports', date + '.json');
  let prior;
  try { prior = JSON.parse(await readFile(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior) {
    if (prior.sha256 !== digest) throw Error('Previously imported report was modified; manual reconciliation required');
    return { status: 'already-imported', date, changed: [] };
  }
  const archives = new Map();
  const known = new Set();
  for (const name of regions) {
    let entries = [];
    try { entries = JSON.parse(await readFile(resolve(root, name), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(entries)) throw Error('Invalid regional archive: ' + name);
    for (const entry of entries) known.add(canonical(entry.url));
    archives.set(name, { entries, added: 0 });
  }
  for (const job of incoming) {
    if (known.has(job.url)) continue;
    known.add(job.url);
    const archive = archives.get(regionFor(job.country));
    archive.entries.push(job);
    archive.added++;
  }
  const writes = [];
  for (const [name, archive] of archives) if (archive.added) writes.push([name, JSON.stringify(archive.entries, null, 2) + '\n']);
  writes.push(['.imports/' + date + '.json', JSON.stringify({ date, status: report.status, sha256: digest, added: Object.fromEntries([...archives].map(([name, archive]) => [name, archive.added])) }, null, 2) + '\n']);
  // Validate every input before writing; the publisher commits all outputs atomically.
  for (const [name, content] of writes) {
    const target = resolve(root, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target + '.tmp', content, { flag: 'w' });
    await rename(target + '.tmp', target);
  }
  return { status: 'imported', date, changed: writes.map(([name]) => name) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await importReport(process.cwd(), process.argv[2]);
  console.log(JSON.stringify(result));
  if (result.status === 'missing') process.exitCode = 3;
}
