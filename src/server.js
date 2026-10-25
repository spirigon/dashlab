import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { generate, ollamaStatus } from './llm.js';
import { generateProtected } from './protected-generator.js';
import { generateIncremental } from './incremental-generator.js';
import { generateSectioned } from './sectioned-generator.js';
import { generateSectionPlans } from './section-plan-generator.js';
import { generateFinalSections } from './section-plan-final.js';
import { generateElevated } from './elevated-llm.js';
import { generateCoins } from './coin-llm.js';
import { exportGmd, exportGdlvl, levelHash } from './gd-export.js';
import { schemaErrors,solve,replay } from '../public/geometry.js';
import {analyzeTiming,timingRule,checkTimingOptions} from '../public/timing.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const results = fileURLToPath(new URL('../results/', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const port = Number(process.env.PORT || 4173);

async function bodyOf(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 150000) throw new Error('Слишком большой запрос.');
  }
  return JSON.parse(text || '{}');
}

export const server = createServer(async (req, res) => {
  const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/status') return reply(200, await ollamaStatus());
    if(req.method==='GET'&&url.pathname==='/api/sectioned-demo'){
      const id=url.searchParams.get('id')||'P01';
      if(!/^P0[1-3]$/.test(id))return reply(400,{error:'Неизвестный пример сборки.'});
      try{return reply(200,JSON.parse(await readFile(fileURLToPath(new URL(`../examples/sectioned-demo/${id}-replay.json`,import.meta.url)),'utf8')));}
      catch(e){if(e.code==='ENOENT')return reply(404,{error:'Сохранённый пример сборки пока не подготовлен.'});throw e;}
    }
    if (req.method === 'POST') {
      // Only the local interface may issue mutation/inference requests.
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return reply(403, { error: 'Origin запрещён.' });
      if (!req.headers['content-type']?.includes('application/json')) return reply(415, { error: 'Нужен application/json.' });
      const b = await bodyOf(req);
      if (url.pathname === '/api/generate') {
        if (typeof b.prompt !== 'string' || b.prompt.length > 4000 || !Number.isInteger(b.seed) || b.seed < 0 || b.seed > 2147483647) throw new Error('Некорректные prompt/seed.');
        if (b.previous !== undefined && (typeof b.previous !== 'string' || b.previous.length > 50000)) throw new Error('Некорректный предыдущий уровень.');
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        if(b.geometry!==undefined&&!['ground','elevated','coins'].includes(b.geometry))throw new Error('Неизвестный профиль геометрии.');
        if (['safe','incremental','sectioned'].includes(b.mode) && b.geometry && b.geometry !== 'ground') throw new Error('Этот способ исправления доступен для профиля с препятствиями на полу.');
        if(b.mode==='sectioned'&&b.sectionRepresentation!==undefined&&!['coordinates','plans-strict','plans'].includes(b.sectionRepresentation))throw new Error('Неизвестное представление участков.');
        const result = await (b.mode==='sectioned'?(b.sectionRepresentation==='coordinates'?generateSectioned:b.sectionRepresentation==='plans-strict'?generateSectionPlans:generateFinalSections):b.mode==='incremental'?generateIncremental:b.mode==='safe'?generateProtected:b.geometry==='coins'?generateCoins:b.geometry==='elevated'?generateElevated:generate)({ ...b, signal: controller.signal });
        return reply(200, result);
      }
      if (url.pathname === '/api/export') {
        const data = b.format === 'gmd' ? exportGmd(b.level) : exportGdlvl(b.level);
        return reply(200, { data, format: b.format === 'gmd' ? 'gmd' : 'gdlvl', hash: levelHash(b.level) });
      }
      if(url.pathname==='/api/timing'){
        if(schemaErrors(b.level).length)throw new Error('Для оценки точности нужен корректный уровень.');
        const {profile,goal}=checkTimingOptions(b.profile??'any',b.goal??'finish');
        if(goal==='all-coins'&&b.level.version!==3)throw new Error('Цель со всеми монетами доступна для version=3.');
        const path=solve(b.level,{goal});
        const analysis=path.passed?analyzeTiming(b.level,path.jumpTicks,{replay,goal}):{status:path.status,goal,message:path.errors?.[0]?.message};
        return reply(200,{analysis,rule:timingRule(analysis,profile),levelHash:levelHash(b.level),profile,goal});
      }
      if (url.pathname === '/api/playtest') {
        if (schemaErrors(b.level).length || !['passed', 'failed', 'import-failed'].includes(b.status) ||
          !Number.isInteger(b.deaths) || b.deaths < 0 || b.deaths > 100000 || typeof b.gameVersion !== 'string' || !b.gameVersion.trim() || b.gameVersion.length > 40 ||
          typeof b.notes !== 'string' || b.notes.length > 2000 || (b.deathX !== null && (!Number.isFinite(b.deathX) || b.deathX < 0 || b.deathX > b.level.length))) throw new Error('Некорректный результат прохождения.');
        const entry = { at: new Date().toISOString(), source: 'human-self-report',
          levelHash: levelHash(b.level), level: b.level, gameVersion: b.gameVersion,
          status: b.status, deaths: b.deaths, deathX: b.deathX, notes: b.notes };
        await mkdir(results, { recursive: true });
        await appendFile(resolve(results, 'playtests.jsonl'), JSON.stringify(entry) + '\n');
        return reply(200, entry);
      }
      return reply(404, { error: 'Неизвестный маршрут.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, { error: 'Метод не поддерживается.' });
    const filename = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root.endsWith(sep) ? root : root + sep)) return reply(403, { error: 'Запрещено.' });
    let bytes;
    try { bytes = await readFile(filename); } catch { return reply(404, { error: 'Файл не найден.' }); }
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) { if (!res.headersSent && !res.destroyed) reply(400, { error: e.message }); }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => console.log(`DashLab: http://127.0.0.1:${port}`));
}
