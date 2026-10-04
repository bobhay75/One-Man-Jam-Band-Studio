// Serve only the shipped page/assets on loopback; never expose the repo or .env.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!['GET', 'HEAD'].includes(req.method) ||
      !/^(index\.html|styles\.css|src\/(?:[\w-]+\/)*[\w-]+\.js)$/.test(file)) {
    res.writeHead(404).end(); return;
  }
  try {
    const body = await readFile(new URL(file, root));
    res.writeHead(200, {
      'Content-Type': types[file.split('.').at(-1)],
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(4173, '127.0.0.1');
