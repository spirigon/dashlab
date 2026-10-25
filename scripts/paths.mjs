import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const STUDY = resolve(ROOT, 'results/retained-plans-2026-10-24');

