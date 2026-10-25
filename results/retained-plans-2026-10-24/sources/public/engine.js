// Integer, fixed-step proxy physics. This is not the Geometry Dash game engine.
export const PHYSICS = Object.freeze({
  id: 'cube-proxy-v1', hz: 120, tile: 240000, dx: 20772,
  jump: 44720, gravity: 1916, width: 192000, height: 216000,
});
export const DEFAULT_REQUIREMENTS = Object.freeze({
  length: 80, minSpikes: 6, minBlocks: 3, minDoubleSpikes: 2,
  minJumps: 7, safeStart: 7, safeFinish: 7,
  minTripleSpikes: 0, minTallBlocks: 0, minTightGaps: 0,
});
export const LEVEL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['version', 'name', 'length', 'objects'],
  properties: {
    version: { type: 'integer', const: 1 },
    name: { type: 'string', minLength: 1, maxLength: 40 },
    length: { type: 'integer', minimum: 24, maximum: 180 },
    objects: { type: 'array', maxItems: 100, items: {
      type: 'object', additionalProperties: false,
      required: ['type', 'x', 'w', 'h'], properties: {
        type: { type: 'string', enum: ['spike', 'block'] },
        x: { type: 'integer', minimum: 1, maximum: 179 },
        w: { type: 'integer', minimum: 1, maximum: 6 },
        h: { type: 'integer', minimum: 1, maximum: 6 },
      },
    } },
  },
};
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const issue = (code, message, extra = {}) => ({ code, message, ...extra });

export function checkRequirements(r) {
  if (!obj(r)) throw new Error('Требования должны быть объектом.');
  for (const k of Object.keys(r)) if (!(k in DEFAULT_REQUIREMENTS)) throw new Error(`Неизвестное требование: ${k}`);
  const result = { ...DEFAULT_REQUIREMENTS, ...r };
  for (const [k, v] of Object.entries(result)) {
    const bounds = k === 'length' ? [24, 180] : [0, 100];
    if (!integer(v, ...bounds)) throw new Error(`Требование ${k}: ожидается целое ${bounds.join('…')}.`);
  }
  if (result.safeStart + result.safeFinish >= result.length) throw new Error('Безопасные участки занимают всю длину.');
  return result;
}

export function schemaErrors(level) {
  if (!obj(level)) return [issue('SCHEMA', 'Ожидается JSON-объект уровня.')];
  const errors = [];
  const allowed = ['version', 'name', 'length', 'objects'];
  for (const k of Object.keys(level)) if (!allowed.includes(k)) errors.push(issue('SCHEMA', `Неизвестное поле ${k}.`));
  if (level.version !== 1) errors.push(issue('SCHEMA', 'version должен быть равен 1.'));
  if (typeof level.name !== 'string' || level.name.length < 1 || level.name.length > 40) errors.push(issue('SCHEMA', 'name: от 1 до 40 символов.'));
  if (!integer(level.length, 24, 180)) errors.push(issue('SCHEMA', 'length: целое от 24 до 180.'));
  if (!Array.isArray(level.objects) || level.objects.length > 100) return [...errors, issue('SCHEMA', 'objects: массив до 100 объектов.')];
  level.objects.forEach((o, i) => {
    if (!obj(o) || !['spike', 'block'].includes(o.type) ||
      !integer(o.x, 1, 179) || !integer(o.w, 1, 6) || !integer(o.h, 1, 6) ||
      Object.keys(o).some(k => !['type', 'x', 'w', 'h'].includes(k))) {
      errors.push(issue('SCHEMA', `objects[${i}]: нужны type (spike|block), x, w, h — целые в пределах схемы.`, { object: i }));
      return;
    }
    if (o.type === 'spike' && o.h !== 1) errors.push(issue('SCHEMA', `objects[${i}]: высота шипа h=1.`, { object: i }));
    if (o.x + o.w > level.length) errors.push(issue('BOUNDS', `objects[${i}]: выходит за length.`, { object: i, x: o.x }));
  });
  // Ground-based groups must not overlap; stacked blocks are represented by h.
  if (errors.length === 0) {
    const sorted = level.objects.map((o, i) => ({ ...o, i })).sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const end = sorted[i - 1].x + sorted[i - 1].w;
      if (sorted[i].x < end) errors.push(issue('OVERLAP', `Объекты ${sorted[i - 1].i} и ${sorted[i].i} перекрываются.`, { x: sorted[i].x }));
      if (sorted[i].x === end) errors.push(issue('ADJACENT_GROUPS', `Группы ${sorted[i - 1].i} и ${sorted[i].i} соприкасаются. Объедините одинаковые препятствия или оставьте минимум одну пустую клетку.`, { x: sorted[i].x }));
    }
  }
  return errors;
}

export function initialState() { return { tick: 0, x: 0, y: 0, vy: 0, grounded: true, dead: false, jumps: 0 }; }

export function step(level, state, press = false) {
  if (state.dead) return { ...state };
  const p = PHYSICS, T = p.tile;
  const didJump = press && state.grounded;
  let vy = (didJump ? p.jump : state.vy) - p.gravity;
  let y = state.y + vy;
  const x = (state.tick + 1) * p.dx;
  let grounded = false, dead = false;
  // Resolve highest landing surface first, then test side/head collisions.
  let landing = y <= 0 && state.y >= 0 && vy <= 0 ? 0 : null;
  for (const o of level.objects) if (o.type === 'block' && x + p.width > o.x * T && x < (o.x + o.w) * T) {
    const top = o.h * T;
    if (vy <= 0 && state.y >= top && y <= top) landing = Math.max(landing ?? 0, top);
  }
  if (landing !== null) { y = landing; vy = 0; grounded = true; }
  for (const o of level.objects) {
    if (x + p.width <= o.x * T || x >= (o.x + o.w) * T) continue;
    if (o.type === 'block') {
      if (y < o.h * T && y + p.height > 0) dead = true;
    } else {
      // Triangle/axis-aligned-rectangle intersection for each unit spike.
      for (let j = 0; j < o.w; j++) {
        const left = (o.x + j) * T, right = left + T;
        const lo = Math.max(x, left), hi = Math.min(x + p.width, right);
        if (hi <= lo) continue;
        const centre = left + T / 2;
        const nearest = Math.max(lo, Math.min(hi, centre));
        const spikeHeight = T - Math.abs(nearest - centre) * 2;
        if (y < spikeHeight && y + p.height > 0) dead = true;
      }
    }
  }
  return { tick: state.tick + 1, x, y, vy, grounded, dead, jumps: state.jumps + Number(didJump) };
}

export function replay(level, jumpTicks) {
  const inputs = new Set(jumpTicks), states = [initialState()];
  const total = Math.ceil(level.length * PHYSICS.tile / PHYSICS.dx);
  for (let tick = 0; tick < total; tick++) {
    const next = step(level, states.at(-1), inputs.has(tick)); states.push(next);
    if (next.dead) break;
  }
  return { passed: !states.at(-1).dead && states.at(-1).x >= level.length * PHYSICS.tile, states };
}

export function solve(level, { maxStates = 600000 } = {}) {
  const errors = schemaErrors(level);
  if (errors.length) return { status: 'invalid', passed: false, errors, visited: 0, jumpTicks: [], maxX: 0 };
  let frontier = [Object.assign(initialState(), { parent: null, input: false })];
  const total = Math.ceil(level.length * PHYSICS.tile / PHYSICS.dx);
  let visited = 1, maxX = 0;
  for (let tick = 0; tick < total; tick++) {
    const next = new Map();
    for (const state of frontier) for (const press of state.grounded ? [false, true] : [false]) {
      const s = step(level, state, press); visited++;
      if (visited > maxStates) return { status: 'inconclusive', passed: false, visited, maxX, jumpTicks: [], errors: [issue('SEARCH_BUDGET', 'Лимит поиска исчерпан; проходимость неизвестна.')] };
      if (s.dead) continue;
      maxX = Math.max(maxX, s.x / PHYSICS.tile);
      const key = `${s.y}:${s.vy}:${Number(s.grounded)}`;
      const existing = next.get(key);
      // x and time are common to a frontier. A lower jump count dominates.
      if (!existing || s.jumps < existing.jumps) next.set(key, { ...s, parent: state, input: press });
    }
    frontier = [...next.values()];
    if (!frontier.length) {
      return { status: 'unreachable', passed: false, visited, maxX, jumpTicks: [], errors: [issue('NO_PATH', `Все траектории погибают около x=${maxX.toFixed(2)}.`, { x: +maxX.toFixed(2) })] };
    }
  }
  let best = frontier.reduce((a, b) => a.jumps <= b.jumps ? a : b);
  const minJumps = best.jumps, jumpTicks = [];
  while (best.parent) { if (best.input) jumpTicks.push(best.tick - 1); best = best.parent; }
  jumpTicks.reverse();
  if (!replay(level, jumpTicks).passed) throw new Error('Solver/replay mismatch');
  return { status: 'reachable', passed: true, visited, maxX, minJumps, jumpTicks, errors: [] };
}

export function validate(level, requirements = DEFAULT_REQUIREMENTS, options) {
  const r = checkRequirements(requirements), errors = schemaErrors(level);
  if (errors.length) return { schemaValid: false, passed: false, playable: false, rules: [], errors, solver: { status: 'invalid', jumpTicks: [] }, physics: PHYSICS.id };
  const solver = solve(level, options);
  const spikes = level.objects.filter(o => o.type === 'spike');
  const sorted = [...level.objects].sort((a, b) => a.x - b.x);
  const stats = { spikes: spikes.reduce((n, o) => n + o.w, 0), blocks: level.objects.filter(o => o.type === 'block').length,
    doubleSpikes: spikes.filter(o => o.w >= 2).length,
    tripleSpikes: spikes.filter(o => o.w >= 3).length,
    tallBlocks: level.objects.filter(o => o.type === 'block' && o.h >= 2).length,
    tightGaps: sorted.slice(1).filter((o, i) => { const gap = o.x - sorted[i].x - sorted[i].w; return gap >= 1 && gap <= 2; }).length,
  };
  const first = Math.min(level.length, ...level.objects.map(o => o.x));
  const last = Math.max(0, ...level.objects.map(o => o.x + o.w));
  const rules = [
    ['LENGTH', level.length === r.length, `Длина: ${level.length} / ${r.length}`],
    ['SPIKES', stats.spikes >= r.minSpikes, `Шипы: ${stats.spikes} / ≥${r.minSpikes}`],
    ['BLOCKS', stats.blocks >= r.minBlocks, `Группы блоков: ${stats.blocks} / ≥${r.minBlocks}`],
    ['DOUBLE_SPIKES', stats.doubleSpikes >= r.minDoubleSpikes, `Группы из ≥2 шипов: ${stats.doubleSpikes} / ≥${r.minDoubleSpikes}`],
    ['SAFE_START', first >= r.safeStart, `Безопасный старт: ${first} / ≥${r.safeStart}`],
    ['SAFE_FINISH', level.length - last >= r.safeFinish, `Безопасный финиш: ${level.length - last} / ≥${r.safeFinish}`],
    ['MIN_JUMPS', solver.passed ? solver.minJumps >= r.minJumps : null, `Обязательные прыжки: ${solver.minJumps ?? '?'} / ≥${r.minJumps}`],
  ].map(([code, passed, message]) => ({ code, passed, message }));
  for (const [key, stat, code, label] of [
    ['minTripleSpikes', 'tripleSpikes', 'TRIPLE_SPIKES', 'Группы из ≥3 шипов'],
    ['minTallBlocks', 'tallBlocks', 'TALL_BLOCKS', 'Блоки высотой ≥2 клетки'],
    ['minTightGaps', 'tightGaps', 'TIGHT_GAPS', 'Промежутки 1–2 клетки'],
  ]) if (r[key] > 0) rules.push({ code, passed: stats[stat] >= r[key], message: `${label}: ${stats[stat]} / ≥${r[key]}` });
  return {
    schemaValid: true, passed: solver.passed && rules.every(rule => rule.passed === true),
    playable: solver.passed, rules, stats, solver, physics: PHYSICS.id,
    errors: [...solver.errors, ...rules.filter(rule => rule.passed === false).map(rule => issue(rule.code, rule.message))],
  };
}

export function parseLevel(raw) {
  if (typeof raw !== 'string') return raw;
  // A single fenced JSON object is accepted; no silent content repair.
  return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}

export function evaluateRaw(raw, requirements) {
  let level;
  try { level = parseLevel(raw); }
  catch (e) { return { level: null, report: { schemaValid: false, passed: false, playable: false, physics: PHYSICS.id, rules: [], solver: { status: 'invalid', jumpTicks: [] }, errors: [issue('JSON_PARSE', e.message)] } }; }
  return { level, report: validate(level, requirements) };
}

export function makeDemo(seed = 42, requirements = DEFAULT_REQUIREMENTS, broken = false) {
  const r = checkRequirements(requirements);
  let s = Number(seed) >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const objects = [];
  let spikes = 0, doubles = 0, blocks = 0, index = 0;
  for (let x = Math.max(7, r.safeStart); x + 2 <= r.length - r.safeFinish; x += 6 + Math.floor(rand() * 2)) {
    let type = index % 3 === 2 ? 'block' : 'spike';
    if (blocks < r.minBlocks && spikes >= r.minSpikes && doubles >= r.minDoubleSpikes) type = 'block';
    let w = type === 'spike' && doubles < r.minDoubleSpikes ? 2 : 1;
    if (type === 'block') blocks++; else { spikes += w; if (w === 2) doubles++; }
    objects.push({ type, x, w, h: 1 }); index++;
  }
  if (broken) { const wall = objects.find(o => o.type === 'block'); if (wall) wall.h = 6; }
  return { version: 1, name: `DashLab ${seed}`, length: r.length, objects };
}

export function diversity(levels) {
  if (levels.length < 2) return null;
  // Jaccard distance between relative-position/type/height occupancy tokens.
  const sets = levels.map(l => new Set(l.objects.flatMap(o => Array.from({ length: o.w }, (_, i) => `${o.type}:${Math.floor((o.x + i) / l.length * 64)}:${o.h}`))));
  let sum = 0, pairs = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const union = new Set([...sets[i], ...sets[j]]).size;
    const intersection = [...sets[i]].filter(v => sets[j].has(v)).length;
    sum += union ? 1 - intersection / union : 0; pairs++;
  }
  return sum / pairs;
}
