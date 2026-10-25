import test from 'node:test';
import assert from 'node:assert/strict';
import { exportGmd, exportGdlvl, inspectExport, toLevelString, levelHash, GD_BINARY_VERSION } from '../src/gd-export.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
const level = { version: 1, name: 'A & B <test>', length: 40, objects: [
  { type: 'block', x: 8, w: 2, h: 2 }, { type: 'spike', x: 17, w: 2, h: 1 },
] };

test('native gdlvl stores level fields directly, GDShare gmd wraps them in root/d', () => {
  const native = exportGdlvl(level), gmd = exportGmd(level);
  const xml = gunzipSync(Buffer.from(native, 'base64url')).toString();
  assert.match(xml, /<plist[^>]*><dict><k>kCEK<\/k><i>4<\/i>/);
  assert.doesNotMatch(xml, /<k>root<\/k>/);
  assert.match(gmd, /<dict><k>root<\/k><d><k>kCEK<\/k>/);
  const result = inspectExport(native);
  assert.equal(result.data, toLevelString(level).data);
  assert.match(result.xml, /A &amp; B &lt;test&gt;/);
  assert.match(result.xml, /<k>k14<\/k><f\/>/); // Never falsely mark verified.
  assert.equal(result.header.kA2, '0'); assert.equal(result.header.kA4, '0'); assert.equal(result.header.kA22, '0');
  assert.equal(result.data, inspectExport(gmd, 'gmd').data);
});
test('reads a real game export and rejects the formerly generated GDShare wrapper in gdlvl', () => {
  const fixture = readFileSync(new URL('./fixtures/native-testing.gdlvl', import.meta.url), 'utf8');
  const native = inspectExport(fixture);
  assert.match(native.xml, /<dict><k>kCEK<\/k><i>4<\/i><k>k2<\/k><s>Testing<\/s>/);
  assert.equal(native.objects.length, 9);
  assert.equal(native.binaryVersion, GD_BINARY_VERSION);
  const oldEnvelope = gzipSync(Buffer.from(exportGmd(level))).toString('base64url');
  assert.throws(() => inspectExport(oldEnvelope), /без обёртки root/);
});
test('compressed level data declares the binary version from the real game export', () => {
  const fixture = readFileSync(new URL('./fixtures/native-testing.gdlvl', import.meta.url), 'utf8');
  const expected = inspectExport(fixture).binaryVersion;
  for (const format of ['gdlvl', 'gmd']) {
    const exported = format === 'gdlvl' ? exportGdlvl(level) : exportGmd(level);
    const parsed = inspectExport(exported, format);
    assert.equal(parsed.binaryVersion, expected);
    const oldXml = parsed.xml.replace(/<k>k50<\/k><i>\d+<\/i>/, '');
    const oldFile = format === 'gmd' ? oldXml : gzipSync(Buffer.from(oldXml)).toString('base64url');
    assert.throws(() => inspectExport(oldFile, format), /Нет версии бинарного формата k50/);
  }
});
test('tile expansion produces vanilla objects at exact centres, plus below-ground end marker', () => {
  const objects = inspectExport(exportGmd(level), 'gmd').objects;
  assert.equal(objects.length, 7);
  assert.deepEqual(objects[0], { '1': '1', '2': '255', '3': '15' });
  assert.deepEqual(objects[3], { '1': '1', '2': '285', '3': '45' });
  assert.deepEqual(objects[4], { '1': '8', '2': '525', '3': '15' });
  assert.deepEqual(objects.at(-1), { '1': '1', '2': '1200', '3': '-75' });
  assert.throws(() => exportGmd({ ...level, length: 2 }));
});
test('content identity ignores title and property/object ordering but tracks geometry', () => {
  assert.equal(levelHash(level), levelHash({ ...level, name: 'renamed', objects: [...level.objects].reverse().map(o => ({ h: o.h, w: o.w, x: o.x, type: o.type })) }));
  assert.notEqual(levelHash(level), levelHash({ ...level, length: 41 }));
});
