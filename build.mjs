import { mkdir, readFile, writeFile } from 'node:fs/promises';

const folder = new URL('./dist/server/', import.meta.url);
const paths = [
  ['/', 'index.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript'],
];
const assets = Object.fromEntries(await Promise.all(paths.map(async ([route, file, type]) => [
  route, [type, await readFile(new URL('./dist/' + file, import.meta.url), 'utf8')],
])));
await mkdir(folder, { recursive: true });
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
await writeFile(new URL('index.js', folder), 'const assets = ' + JSON.stringify(assets) + ';\n' + worker);
await writeFile(new URL('package.json', folder), '{"type":"module"}\n');
