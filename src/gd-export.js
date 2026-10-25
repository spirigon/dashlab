import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { schemaErrors } from '../public/geometry.js';

export const EXPORT_PROFILE = 'gd-cube-static-v2';
export const ELEVATED_EXPORT_PROFILE = 'gd-cube-static-v3-elevated';
export const COIN_EXPORT_PROFILE = 'gd-cube-static-v4-coins';
// Taken from Testing.gdlvl exported by the user's Geometry Dash 2.209.
// dataLoaded uses this version to interpret the compressed k4 level string.
export const GD_BINARY_VERSION = 51;
export const levelHash = level => createHash('sha256').update(JSON.stringify(level.version>=2?{
  version:level.version,length:level.length,objects:[...level.objects].sort((a,b)=>a.x-b.x||a.y-b.y||a.type.localeCompare(b.type)).map(o=>({type:o.type,x:o.x,y:o.y,w:o.w,h:o.h})),
}:{version:level.version,length:level.length,
  objects:[...level.objects].sort((a,b)=>a.x-b.x).map(o=>({type:o.type,x:o.x,w:o.w,h:o.h})),
})).digest('hex');

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
const encoded = s => gzipSync(Buffer.from(s, 'utf8'), { mtime: 0 }).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

export function toLevelString(level) {
  const errors = schemaErrors(level);
  if (errors.length) throw new Error(errors.map(e => e.message).join(' '));
  // One editor tile is 30 game units. Only unscaled vanilla blocks and spikes.
  // Normal cube, no mini/dual/platformer, normal speed. Built-in ground remains.
  const header = 'kA2,0,kA3,0,kA4,0,kA6,1,kA7,1,kA8,0,kA10,0,kA11,0,kA22,0';
  const objects = [];
  const coins=level.objects.filter(o=>o.type==='coin').sort((a,b)=>a.x-b.x||a.y-b.y);
  for (const o of level.objects) {
    if(o.type==='coin'){
      objects.push(`1,1329,2,${o.x*30+15},3,${o.y*30+15},12,${coins.indexOf(o)+1}`);
      continue;
    }
    for (let x = 0; x < o.w; x++) for (let y = 0; y < (o.type === 'block' ? o.h : 1); y++) {
      objects.push(`1,${o.type === 'block' ? 1 : 8},2,${(o.x + x) * 30 + 15},3,${((o.y??0)+y) * 30 + 15}${o.type==='spike_down'?',6,180':''}`);
    }
  }
  // A below-ground block establishes a nominal end position, without a new
  // collision on the route. The game adds its own end animation/tail.
  objects.push(`1,1,2,${level.length * 30},3,-75`);
  return { data: `${header};${objects.join(';')};`, objectCount: objects.length };
}

function levelFields(level) {
  const { data, objectCount } = toLevelString(level);
  const fields = [
    ['kCEK', 'i', 4], ['k2', 's', level.name],
    ['k3', 's', Buffer.from(`DashLab ${levelHash(level).slice(0, 12)}. Proxy checked; verify in game.`).toString('base64')],
    ['k4', 's', encoded(data)], ['k5', 's', 'DashLab'], ['k8', 'i', 0],
    ['k13', 't', null], ['k14', 'f', null], ['k15', 'f', null],
    ['k16', 'i', 1], ['k17', 'i', 22], ['k21', 'i', 2], ['k47', 't', null],
    ['k50', 'i', GD_BINARY_VERSION],
    ['k48', 'i', objectCount],
    ...(level.version===3?[['k64','i',level.objects.filter(o=>o.type==='coin').length],['k65','f',null],['k61','f',null],['k62','f',null],['k63','f',null]]:[]),
  ];
  return fields.map(([key, tag, v]) => `<k>${key}</k>${v === null ? `<${tag}/>` : `<${tag}>${xmlEscape(v)}</${tag}>`}`).join('');
}

const plist = body => `<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict>${body}</dict></plist>`;

export function exportGmd(level) { return plist(`<k>root</k><d>${levelFields(level)}</d>`); }

// Native 2.209 uses the level dictionary directly. The GDShare-only root/d
// wrapper makes the game report "No levels were imported". Confirmed against
// the user's successfully reimported Testing.gdlvl export from the game.
export function exportGdlvl(level) { return encoded(plist(levelFields(level))); }

export function inspectExport(text, format = 'gdlvl') {
  const xml = format === 'gmd' ? text : gunzipSync(Buffer.from(text.trim(), 'base64url'), { maxOutputLength: 2e6 }).toString('utf8');
  if (format === 'gdlvl' && !/<dict>\s*<k>kCEK<\/k><i>4<\/i>/.test(xml)) {
    throw new Error('Нативный .gdlvl должен содержать словарь уровня напрямую, без обёртки root для GDShare.');
  }
  const compressed = xml.match(/<k>k4<\/k><s>([^<]+)<\/s>/)?.[1];
  if (!compressed) throw new Error('Нет поля k4.');
  const binaryVersion = Number(xml.match(/<k>k50<\/k><i>(\d+)<\/i>/)?.[1]);
  if (!Number.isInteger(binaryVersion) || binaryVersion <= 0) {
    throw new Error('Нет версии бинарного формата k50 для сжатых данных k4; игра может открыть пустую карту.');
  }
  const data = gunzipSync(Buffer.from(compressed, 'base64url'), { maxOutputLength: 2e6 }).toString('utf8');
  const [header, ...items] = data.split(';').filter(Boolean);
  const properties = entry => {
    const parts = entry.split(',');
    if (parts.length % 2) throw new Error('Нечётное число полей.');
    return Object.fromEntries(Array.from({ length: parts.length / 2 }, (_, i) => [parts[i * 2], parts[i * 2 + 1]]));
  };
  return { xml, data, binaryVersion, header: properties(header), objects: items.map(properties) };
}
