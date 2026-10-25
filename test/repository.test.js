import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {ROOT, STUDY} from '../scripts/paths.mjs';
import {verifyData} from '../scripts/verify-data.mjs';
import {server} from '../src/server.js';

test('recorded evidence hashes match and all study cases remain in the denominator', async () => {
  const check = await verifyData();
  assert.equal(check.chains, 288);
  const analysis = JSON.parse(await readFile(resolve(STUDY, 'analysis.json'), 'utf8'));
  assert.deepEqual(analysis.summary.map(s => s.successes), [6,5,2,7,8,9,3,10,6,14,8,11]);
  assert.ok(analysis.summary.every(s => s.completed === 24));
});

test('recorded demo and native downloads agree with the chain geometry', async () => {
  const data = JSON.parse(await readFile(resolve(ROOT, 'public/repair-demo-data.json'), 'utf8'));
  assert.equal(data.completed, 288);
  assert.equal(data.examples.length, 4);
  for (const example of data.examples) {
    assert.ok(example.snapshots.at(-1).report.passed);
    const native = await readFile(resolve(ROOT, 'public' + example.download));
    const exported = await readFile(resolve(ROOT, 'examples/recorded-repairs/' + example.id + '.gdlvl'));
    assert.deepEqual(native, exported);
  }
  const human = JSON.parse(await readFile(resolve(ROOT, 'results/native-playtest.json'), 'utf8'));
  const m03 = human.relatedExports.find(x => x.id === 'M03');
  const bytes = await readFile(resolve(ROOT, 'examples/recorded-repairs/M03.gdlvl'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), m03.nativeExportSha256);
});

test('application serves recorded demo and valid export without contacting a model', async () => {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/', '/repair-demo.html', '/repair-demo.js', '/repair-demo-data.json', '/repair-demo-assets/M03.gdlvl']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    const level = JSON.parse(await readFile(resolve(ROOT, 'examples/recorded-repairs/M03.json'), 'utf8'));
    const response = await fetch(base + '/api/export', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({level, format:'gdlvl'})});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).format, 'gdlvl');
  } finally {await new Promise(done => server.close(done));}
});

test('new inference requires an explicit artifacts directory and help never needs Ollama', () => {
  const help = spawnSync(process.execPath, ['scripts/study.mjs', '--help'], {cwd:ROOT, encoding:'utf8', windowsHide:true});
  assert.equal(help.status, 0);
  assert.match(help.stdout, /requires Ollama/);
  const blocked = spawnSync(process.execPath, ['scripts/study.mjs', '--resume', 'results/retained-plans-2026-10-24'], {cwd:ROOT, encoding:'utf8', windowsHide:true});
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /inside artifacts/);
});
