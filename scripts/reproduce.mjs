import {cp, mkdir, mkdtemp, readFile, writeFile, open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve, join} from 'node:path';
import assert from 'node:assert/strict';
import {ROOT, STUDY} from './paths.mjs';
import {verifyData} from './verify-data.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  throw new Error('Usage: npm run reproduce -- [--out NEW_DIRECTORY]');
}
await verifyData();
let out;
if (args.length) {
  out = resolve(args[1]);
  await mkdir(out, {recursive: false});
} else {
  await mkdir(resolve(ROOT, 'artifacts'), {recursive: true});
  out = await mkdtemp(resolve(ROOT, 'artifacts/replay-'));
}
await cp(STUDY, out, {recursive: true});
const logPath = join(out, 'audit.log');
const log = await open(logPath, 'wx');
console.log('Replaying all 288 chains from frozen sources. No Ollama or network calls.');
console.log('Working copy: ' + out);
try {
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(out, 'sources/scripts/analyze-retained-plans.js'), out], {
      cwd: ROOT, stdio: ['ignore', log.fd, log.fd], windowsHide: true
    });
    child.on('error', fail);
    child.on('exit', code => code === 0 ? done() : fail(new Error(`Replay failed (${code}); see ${logPath}`)));
  });
} finally {
  await log.close();
}
const original = JSON.parse(await readFile(join(STUDY, 'analysis.json'), 'utf8'));
const replayed = JSON.parse(await readFile(join(out, 'analysis.json'), 'utf8'));
assert.deepEqual(replayed, original, 'Recomputed analysis differs from the recorded result');
assert.equal(await readFile(join(out, 'metrics.csv'), 'utf8'), await readFile(join(STUDY, 'metrics.csv'), 'utf8'));
const report = {
  status: 'PASS', verifiedChains: replayed.audit.verifiedRows,
  analysisMatchesRecorded: true, metricsMatchRecorded: true,
  modelRequests: 0, originalDataModified: false,
  cells: replayed.summary.map(({model, arm, successes, completed}) => ({model, arm, successes, completed}))
};
await writeFile(join(out, 'reproduction.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log('Reproduction report: ' + join(out, 'reproduction.json'));

