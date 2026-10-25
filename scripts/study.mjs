import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {ROOT, STUDY} from './paths.mjs';

// Use the captured runner and prompt/compiler versions for new study runs.
const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log('New inference (requires Ollama and both Qwen profiles):\n' +
    '  npm run study -- --out artifacts/new-study --prepare true\n' +
    '  npm run study -- --resume artifacts/new-study\n' +
    'The runner uses frozen sources, model digest binding, and the original 288 assignments.\n' +
    'Existing output directories are never overwritten. Use npm run reproduce for offline replay.');
  process.exit(0);
}
const allowed = new Set(['--out', '--resume', '--prepare']);
if (args.length % 2) throw new Error('Each option requires a value; use --help.');
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i])) throw new Error('Unknown option: ' + args[i]);
}
const outputIndex = args.findIndex(x => x === '--out' || x === '--resume');
if (outputIndex < 0) throw new Error('Choose --out NEW_DIRECTORY or --resume DIRECTORY.');
const output = resolve(args[outputIndex + 1]);
if (!output.startsWith(resolve(ROOT, 'artifacts') + (process.platform === 'win32' ? '\\' : '/'))) {
  throw new Error('New studies must be stored inside artifacts/ to protect the recorded dataset.');
}
await mkdir(resolve(ROOT, 'artifacts'), {recursive: true});
const child = spawn(process.execPath, [join(STUDY, 'sources/scripts/retained-plans-study.js'), ...args], {
  cwd: ROOT, stdio: 'inherit', windowsHide: true,
  env: {...process.env, LLM_CONTEXT_LENGTH: '8192', LLM_TIMEOUT_MS: '360000'}
});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
