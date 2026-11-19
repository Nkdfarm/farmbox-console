// The scouting page's reads, with each zone named by its number only (owner, 19 Nov 2026: "Zone 1 to 8 without
// additional text, to be more compact"). FarmBox1's zones carry their system and crop in their name since migration
// 0280 ("Zone 5 · Grow bags · peppers"); Farm setup and the rest of the console keep the full name, the scouting
// report and its traps show "Zone 5". Only the fields that name a zone are cut, and only a name of that shape.
import * as api from '../api.js';

const LONG = /^(Zone \d+[A-Z]?(?:-\d+)?) · .+$/;
const KEYS = new Set(['name', 'zone', 'zone_name']);
export const shortZone = s => (typeof s === 'string' ? s.replace(LONG, '$1') : s);
const deep = (v, key) => Array.isArray(v) ? v.map(x => deep(x, key))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, k)]))
  : KEYS.has(key) ? shortZone(v) : v;

export const rpc = (...a) => api.rpc(...a).then(r => deep(r));
export const cachedRpc = (...a) => api.cachedRpc(...a).then(r => deep(r));
export const openFast = (reads, o) => api.openFast(reads, { ...o, show: (v, f) => o.show(deep(v), f) });
export const fn = api.fn;
