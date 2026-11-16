// Team page: shared state object S, small helpers and the week range
import { roleLabel as knownRole } from '../people.js';
import { pref, farmDate, ymd, addDays, mondayOf, hours as hoursOf } from '../ui.js';

// the page's shared state (was module-level `let`s of team.js): one object so every part can assign to it
// AI: mcp_team (0242): who has AI access and what it reads; null when not on this database or not a manager
export const S = { farm: null, mount: null, T: null, people: [], tree: [], hours: null, preview: null, showOff: false, hoursOpen: false, AI: null };

export const fmtHours = m => hoursOf(m, '0 h');   // a person with no hours reads "0 h of 40 h 00", not a dash
export const DAY = ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];
// a job the profile form does not offer (an installer comes from Notion) still has a name here
export const roleLabel = r => { const l = knownRole(r); return l === r ? String(r || 'No job').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : l; };
export const keyLabel = r => r.category || 'All ' + r.family;
export const sameKey = (a, b) => a.family === b.family && (a.category || null) === (b.category || null);
export const first = name => String(name || '');        // worker.name is the first name already ("Worker 3" must stay whole)

export const which = () => pref.get('fbc_team_week') === 'next' ? 'next' : 'this';
export function teamWeek(w = which()) {
  const mon = mondayOf(farmDate());
  const m = w === 'next' ? addDays(mon, 7) : mon;
  return { p_from: ymd(m), p_to: ymd(addDays(m, 6)) };
}
