import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {ROOT} from './paths.mjs';

const root = resolve(ROOT, 'public');
const port = Number(process.env.DASHLAB_DEMO_PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DASHLAB_DEMO_PORT must be 1..65535');
const types = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8'};
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, {Allow:'GET, HEAD'}); res.end('Read-only recorded demo'); return;
  }
  let filename;
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    filename = resolve(root, '.' + (pathname === '/' ? '/repair-demo.html' : pathname));
  } catch {res.writeHead(400); res.end('Bad URL'); return;}
  if (!filename.startsWith(root + sep)) {res.writeHead(403); res.end('Forbidden'); return;}
  try {
    const bytes = await readFile(filename);
    res.writeHead(200, {'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Content-Length': bytes.length});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {res.writeHead(404); res.end('Not found');}
});
server.on('error', error => {console.error(error.message); process.exitCode = 1;});
server.listen(port, '127.0.0.1', () => console.log(`DashLab recorded demo: http://127.0.0.1:${port}\nNo model or internet required. Stop with Ctrl+C.`));
