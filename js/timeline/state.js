// the timeline's shared state, constants and day arithmetic
import { pref } from '../ui.js';

export const SPANS = [['35', '5 weeks'], ['91', '3 months'], ['182', '6 months'], ['365', 'Year']];
export const SPAN_KEY = 'fbc_tl_span';
export const LABEL_W = 176;                       // the sticky column of zone and position names
export const DAY = 864e5;

// dates as day numbers, in UTC so a date never slips a day with the time zone
export const dn = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
export const ds = n => new Date(n * DAY).toISOString().slice(0, 10);
export const nice = s => s ? new Date(dn(s) * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
// the page's shared state: one object, so every part reads and writes the same values
export const S = {
  // shell (0.7.120): the planner's top bar from crops.js — this view fills its left part and its ⓘ text
  farm: null,
  mount: null,
  data: null,
  offset: 0,
  selected: new Set(),
  shell: null,
  lastWin: null,
  // choosing the zones of a steady harvest (0.7.135): the mode, the zones ticked, the banner's live parts
  // since 0.7.140 a FarmBox keeps several groups: steadyEdit is the group being changed (null = a new one)
  steadyMode: false,
  steadyPick: new Set(),
  steadyBanner: null,
  steadyEdit: null,
};

export const span = () => Number(pref.get(SPAN_KEY)) || 91;
