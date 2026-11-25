import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import './build.mjs';

const { default: worker } = await import('./dist/server/index.js');
function read(file) {
  if (!existsSync(file)) return null;
  const body = readFileSync(file, 'utf8');
  return { body, etag: createHash('sha256').update(body).digest('hex'), json: async () => JSON.parse(body) };
}

const BUCKET = {
  get: async key => read(new URL('./dist/' + key, import.meta.url)),
  async put(key, body, { onlyIf }) {
    const file = new URL('./dist/' + key, import.meta.url);
    const temp = new URL('./dist/.' + key + '.tmp', import.meta.url);
    const current = read(file);
    if (onlyIf instanceof Headers ? current !== null : current?.etag !== onlyIf.etagMatches) return null;
    writeFileSync(temp, body);
    renameSync(temp, file);
    return { key };
  },
};
const port = Number(process.env.JOBS_PORT || '3210');
createServer(async (req, res) => {
  try {
    const endpoint = new URL('http://127.0.0.1:' + port);
    if (req.headers.host !== endpoint.host || (req.headers.origin && req.headers.origin !== endpoint.origin)) {
      res.writeHead(403).end();
      return;
    }
    const init = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') Object.assign(init, { body: req, duplex: 'half' });
    const response = await worker.fetch(new Request(endpoint.origin + req.url, init), { BUCKET });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500).end('Nabídky se nepodařilo zpracovat.');
  }
}).listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
