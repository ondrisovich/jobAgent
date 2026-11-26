import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importReport, localDate } from './import-report.mjs';
const date = '2026-11-25';
const job = { title: 'PLC Engineer', city: 'Brno', country: 'CZ', salary: '90000 CZK gross/month', remote: 'no', description: 'Industrial PLC commissioning', url: 'https://example.com/jobs/1', category: 'local', verifiedAt: date + 'T07:00:00+01:00', compensation: { minimum: 90000, currency: 'CZK', period: 'month', gross: true, kind: 'employment', evidence: 'Advertised minimum', sourceUrl: 'https://example.com/jobs/1' } };
const report = jobs => ({ schemaVersion: 1, date, timezone: 'Europe/Paris', generatedAt: date + 'T07:05:00+01:00', status: 'complete', coverage: ['CZ', 'CH', 'DE', 'AT', 'EUROPE'].map(region => ({ region, queries: ['PLC jobs'], sourceUrls: ['https://example.com/jobs'], notes: 'Test only' })), jobs });
async function setup(t, jobs) {
  const root = await mkdtemp(join(tmpdir(), 'jobagent-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'reports'));
  if (jobs) await writeFile(join(root, 'reports', date + '.json'), JSON.stringify(report(jobs)));
  return root;
}
test('missing report writes nothing', async t => {
  assert.equal((await importReport(await setup(t), date)).status, 'missing');
});
test('preserves data and deduplicates URL variants and repeat imports', async t => {
  const root = await setup(t, [job, { ...job, url: job.url + '?utm_source=test#details' }]);
  const old = { ...job, url: 'https://example.com/old', savedAt: '2020-01-01', custom: 'preserved' };
  await writeFile(join(root, 'CZ.json'), JSON.stringify([old]));
  await importReport(root, date);
  const data = JSON.parse(await readFile(join(root, 'CZ.json')));
  assert.deepEqual(data[0], old); assert.equal(data.length, 2);
  const before = await readFile(join(root, 'CZ.json'), 'utf8');
  assert.equal((await importReport(root, date)).status, 'already-imported');
  assert.equal(await readFile(join(root, 'CZ.json'), 'utf8'), before);
  await writeFile(join(root, 'reports', date + '.json'), JSON.stringify(report([])));
  await assert.rejects(importReport(root, date), /modified/);
});
test('bad salary and incomplete coverage reject before writes', async t => {
  const root = await setup(t, [{ ...job, compensation: { ...job.compensation, minimum: 80000 } }]);
  await assert.rejects(importReport(root, date), /CZ requires/);
  await assert.rejects(readFile(join(root, 'CZ.json')), { code: 'ENOENT' });
  const incomplete = report([]); incomplete.coverage.pop();
  await writeFile(join(root, 'reports', date + '.json'), JSON.stringify(incomplete));
  await assert.rejects(importReport(root, date), /coverage/);
});
test('remote and FIFO salary boundaries', async t => {
  const root = await setup(t, []);
  for (const [category, minimum, period, valid] of [['remote', 100000, 'year', false], ['remote', 100001, 'year', true], ['remote', 84, 'hour', false], ['remote', 85, 'hour', true], ['fifo', 99, 'hour', false], ['fifo', 100, 'hour', true]]) {
    const entry = { ...job, country: 'DE', category, remote: 'yes', compensation: { ...job.compensation, currency: 'EUR', minimum, period, kind: period === 'hour' ? 'b2b' : 'employment' } };
    await writeFile(join(root, 'reports', date + '.json'), JSON.stringify(report([entry])));
    await rm(join(root, '.imports', date + '.json'), { force: true });
    if (valid) assert.equal((await importReport(root, date)).status, 'imported');
    else await assert.rejects(importReport(root, date), /threshold|FIFO/);
  }
});
test('zero results imported once; date respects Paris DST', async t => {
  const root = await setup(t, []);
  assert.deepEqual((await importReport(root, date)).changed, ['.imports/' + date + '.json']);
  assert.equal((await importReport(root, date)).status, 'already-imported');
  assert.equal(localDate(new Date('2026-06-01T22:30:00Z')), '2026-06-02');
  assert.equal(localDate(new Date('2026-11-25T23:30:00Z')), '2026-11-26');
});
test('routes all regions and deduplicates against existing other region', async t => {
  const entries = ['CZ', 'CH', 'DE', 'AT', 'FR'].map((country, i) => ({ ...job, country, url: 'https://example.com/' + i, salaryNotes: 'Advertised pay in salary field', compensation: country === 'CZ' ? job.compensation : null }));
  const root = await setup(t, entries);
  const existing = { ...job, country: 'FR', url: entries[0].url, savedAt: '2020-01-01' };
  await writeFile(join(root, 'EU.json'), JSON.stringify([existing]));
  await importReport(root, date);
  await assert.rejects(readFile(join(root, 'CZ.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(root, 'SWISS.json'))).length, 1);
  assert.equal(JSON.parse(await readFile(join(root, 'DE_AU.json'))).length, 2);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'EU.json')))[0], existing);
  assert.equal(JSON.parse(await readFile(join(root, 'EU.json'))).length, 2);
});

test('partial report imports verified jobs and records status, but requires notes', async t => {
  const root = await setup(t, []);
  const partial = report([job]); partial.status = 'partial';
  partial.coverage[1] = { region: 'CH', queries: [], sourceUrls: [], notes: 'Search unavailable' };
  const path = join(root, 'reports', date + '.json');
  await writeFile(path, JSON.stringify({...partial, coverage: partial.coverage.map(c => ({...c, notes: ''}))}));
  await assert.rejects(importReport(root, date), /Missing search evidence/);
  await writeFile(path, JSON.stringify(partial));
  assert.equal((await importReport(root, date)).status, 'imported');
  assert.equal(JSON.parse(await readFile(join(root, '.imports', date + '.json'))).status, 'partial');
  assert.equal(JSON.parse(await readFile(join(root, 'CZ.json'))).length, 1);
  assert.equal((await importReport(root, date)).status, 'already-imported');
});
