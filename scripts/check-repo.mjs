import {readdir, readFile, stat} from 'node:fs/promises';
import {resolve, relative, extname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ROOT} from './paths.mjs';
import {verifyData} from './verify-data.mjs';

const ignored = new Set(['.git', 'node_modules', 'artifacts', '.venv', '__pycache__', 'models']);
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    if (ignored.has(entry.name) || entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example') || entry.name.endsWith('.gguf')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const all = await files(ROOT);
const tracked = spawnSync('git', ['ls-files', '-z'], {cwd:ROOT, encoding:'utf8', windowsHide:true});
if (tracked.status === 0) {
  for (const name of tracked.stdout.split('\0').filter(Boolean)) {
    assert.ok(!/(^|\/)\.env(?:$|\.)/.test(name) || name === '.env.example', 'Tracked local environment: ' + name);
    assert.ok(!name.endsWith('.gguf'), 'Tracked model weights: ' + name);
  }
}
let js = 0, markdown = 0;
for (const file of all) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  assert.ok(!(rel.startsWith('.env') && rel !== '.env.example'), 'Local environment must not be committed');
  assert.ok((await stat(file)).size < 50 * 1024 * 1024, 'Unexpected large file: ' + rel);
  if (['.js', '.mjs'].includes(extname(file))) {
    const check = spawnSync(process.execPath, ['--check', file], {encoding:'utf8', windowsHide:true});
    assert.equal(check.status, 0, 'Syntax check failed: ' + rel + '\n' + check.stderr);
    js++;
  }
  if (extname(file) === '.json') JSON.parse(await readFile(file, 'utf8'));
  if (extname(file) === '.md' && !rel.includes('/sources/')) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const target = resolve(file, '..', decodeURIComponent(href.split('#')[0]));
      await stat(target).catch(() => {throw new Error('Broken local link in ' + rel + ': ' + href);});
    }
    markdown++;
  }
  if (['.js', '.mjs', '.json', '.jsonl', '.md', '.yml', '.example'].includes(extname(file))) {
    const text = await readFile(file, 'utf8');
    assert.ok(!/(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{30,})/.test(text), 'Possible credential in ' + rel);
    assert.ok(!text.includes('\uFFFD'), 'Invalid Unicode replacement character in ' + rel);
  }
}
const evidence = await verifyData();
console.log(JSON.stringify({status:'PASS', syntaxChecked:js, markdownFiles:markdown, ...evidence}, null, 2));
