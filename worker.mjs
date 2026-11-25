const key = 'jobs.json';
const stateKey = 'job-status.json';
const europe = new Set('AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GE GR HR HU IE IS IT XK KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA VA'.split(' '));

function normalize(job, index) {
  const fail = field => { throw new Error(`Nabídka ${index + 1}, neplatné pole ${field}`); };
  if (!job || typeof job !== 'object' || Array.isArray(job)) fail('nabídka');
  for (const field of ['title', 'description', 'url']) {
    if (typeof job[field] !== 'string' || !job[field].trim()) fail(field);
  }
  if (!europe.has(job.country)) fail('country');
  for (const field of ['city', 'salary']) {
    if (job[field] != null && typeof job[field] !== 'string') fail(field);
  }
  if (!['yes', 'no', 'na'].includes(job.remote)) fail('remote');
  let source;
  try { source = new URL(job.url); } catch { fail('url'); }
  if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) fail('url');
  source.hash = '';
  return {
    title: job.title.trim(), city: job.city?.trim() || null, country: job.country,
    salary: job.salary?.trim() || null, remote: job.remote, description: job.description,
    url: source.href,
  };
}

const json = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' },
});

function saveIfCurrent(bucket, file, stored, data) {
  const onlyIf = stored ? { etagMatches: stored.etag } : new Headers({ 'If-None-Match': '*' });
  return bucket.put(file, JSON.stringify(data, null, 2) + '\n', { onlyIf });
}

async function append(request, bucket) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    return json({ error: 'Použij Content-Type: application/json' }, 415);
  }
  let incoming;
  try {
    const body = await request.text();
    if (body.length > 2_000_000) return json({ error: 'Dávka je příliš velká' }, 413);
    const entries = JSON.parse(body);
    if (!Array.isArray(entries)) throw new Error('Očekávám pole nabídek');
    const savedAt = new Date().toISOString();
    incoming = entries.map((job, index) => ({ ...normalize(job, index), savedAt }));
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = await bucket.get(key);
    const all = stored ? await stored.json() : [];
    const urls = new Set(all.map(job => job.url));
    let added = 0;
    for (const job of incoming) {
      if (urls.has(job.url)) continue;
      urls.add(job.url);
      all.push(job);
      added++;
    }
    if (!added) return json({ added, total: all.length });
    const saved = await saveIfCurrent(bucket, key, stored, all);
    if (saved) return json({ added, total: all.length }, 201);
  }
  return json({ error: 'Probíhá souběžný zápis. Zkus dávku poslat znovu.' }, 409);
}

async function maintainJobs(request, bucket) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    return json({ error: 'Použij Content-Type: application/json' }, 415);
  }
  let removedUrls;
  try {
    const entries = await request.json();
    if (!Array.isArray(entries) || entries.some(url => typeof url !== 'string'
      || !['https:', 'http:'].includes(new URL(url).protocol))) throw new Error();
    removedUrls = new Set(entries);
  } catch {
    return json({ error: 'Očekávám pole odkazů na potvrzeně ukončené nabídky.' }, 400);
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = await bucket.get(key);
    const all = stored ? await stored.json() : [];
    const active = all.filter(job => !removedUrls.has(job.url));
    const removed = all.length - active.length;
    if (removed && !await archiveMarkedJobs(bucket, all.filter(job => removedUrls.has(job.url)))) continue;
    if (!removed || await saveIfCurrent(bucket, key, stored, active)) {
      return json({ removed, total: active.length });
    }
  }
  return json({ error: 'Probíhá souběžný zápis. Zkus dávku poslat znovu.' }, 409);
}

async function archiveMarkedJobs(bucket, jobs) {
  const stored = await bucket.get(stateKey);
  if (!stored) return true;
  const statuses = await stored.json();
  let changed = false;
  for (const job of jobs) {
    const state = statuses[job.url];
    if (typeof state !== 'string') continue;
    statuses[job.url] = { status: state, favorite: false, job };
    changed = true;
  }
  return !changed || Boolean(await saveIfCurrent(bucket, stateKey, stored, statuses));
}

async function updateStatus(request, bucket) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    return json({ error: 'Použij Content-Type: application/json' }, 415);
  }
  let url, status, favorite;
  try {
    ({ url, status, favorite } = await request.json());
    if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol)
      || (favorite !== undefined && typeof favorite !== 'boolean')
      || (status !== undefined && !['applied', 'dismissed', null].includes(status))
      || (status === undefined && favorite === undefined)) throw new Error();
  } catch {
    return json({ error: 'Neplatná nabídka nebo stav' }, 400);
  }
  const jobsFile = await bucket.get(key);
  const snapshot = jobsFile ? (await jobsFile.json()).find(job => job.url === url) : undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = await bucket.get(stateKey);
    const statuses = stored ? await stored.json() : {};
    const existing = statuses[url];
    const previous = typeof existing === 'string' ? { status: existing } : existing ?? {};
    const next = {
      status: status === undefined ? previous.status ?? null : status,
      favorite: favorite ?? previous.favorite ?? false,
      job: snapshot ?? previous.job,
    };
    if (next.status || next.favorite) statuses[url] = next;
    else delete statuses[url];
    if (await saveIfCurrent(bucket, stateKey, stored, statuses)) return json(next);
  }
  return json({ error: 'Probíhá souběžný zápis. Zkus to znovu.' }, 409);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/jobs' && request.method === 'POST') return append(request, env.BUCKET);
    if (pathname === '/api/jobs' && request.method === 'PATCH') return maintainJobs(request, env.BUCKET);
    if (pathname === '/api/job-status' && request.method === 'POST') return updateStatus(request, env.BUCKET);
    if (pathname === '/api/job-status' && request.method === 'GET') {
      const stored = await env.BUCKET.get(stateKey);
      return json(stored ? await stored.json() : {});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Nepodporovaná metoda' }, 405);
    if (pathname === '/jobs.json') {
      const stored = await env.BUCKET.get(key);
      return new Response(request.method === 'HEAD' ? null : stored?.body ?? '[]', {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (!Object.hasOwn(assets, pathname)) return new Response('Stránka nenalezena', { status: 404 });
    const [type, body] = assets[pathname];
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': type + '; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'",
      },
    });
  },
};
