import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, relative, isAbsolute, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {ROOT, STUDY} from './paths.mjs';

export async function verifyData() {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'results/MANIFEST.json'), 'utf8'));
  for (const entry of manifest.files) {
    const path = resolve(ROOT, entry.path);
    const rel = relative(ROOT, path);
    assert.ok(rel && !rel.startsWith('..' + sep) && !isAbsolute(rel), 'Invalid manifest path');
    const bytes = await readFile(path);
    assert.equal(bytes.length, entry.bytes, 'Size differs: ' + entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, 'Hash differs: ' + entry.path);
  }
  const analysis = JSON.parse(await readFile(resolve(STUDY, 'analysis.json'), 'utf8'));
  assert.equal(analysis.completed, 288);
  assert.equal(analysis.audit.verifiedRows, 288);
  assert.equal(analysis.audit.completedResponses, 527);
  assert.equal(analysis.audit.apiErrors, 0);
  return {verifiedFiles: manifest.files.length, chains: 288, recordedResponses: 527};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyData(), null, 2));
}
