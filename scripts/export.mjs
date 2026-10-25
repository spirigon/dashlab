import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {exportGdlvl, exportGmd, inspectExport} from '../src/gd-export.js';

const args = process.argv.slice(2);
if (args.length !== 5 || args[1] !== '--format' || args[3] !== '--out' || !['gdlvl', 'gmd'].includes(args[2])) {
  throw new Error('Usage: npm run export -- LEVEL.json --format gdlvl|gmd --out NEW_FILE');
}
const level = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
const bytes = args[2] === 'gdlvl' ? exportGdlvl(level) : exportGmd(level);
const inspected = inspectExport(bytes, args[2]);
const output = resolve(args[4]);
await mkdir(dirname(output), {recursive:true});
await writeFile(output, bytes, {flag:'wx'});
console.log(JSON.stringify({output, nativeObjects:inspected.objects.length}));
