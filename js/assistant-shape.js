// ═══════════════════════════════════════════════════════════════════════════
// The assistant's answer shapes (AI build mode P1, docs/ai-build-mode.md, owner 20 Nov 2026) — the pure part, no imports,
// so that it can be checked in Node. The function puts <<shape:answer|brief|plan>> on the first line of a reply; the band
// strips it and draws the answer by it: answer = one compact box of 1–4 bullets, brief = the coloured blocks of 0.11.04,
// plan = one coloured line per step ([+] new, [~] changed, [-] removed or not done, [=] checked) and the line of the cards.
// A reply without a tag (an old answer, or the model forgot it) is drawn as before (brief). The same parsing as the
// function's own (supabase/functions/assistant/talk.ts).
// ═══════════════════════════════════════════════════════════════════════════

// the chips of the question box: none ticked = auto. Build (P5, creation mode) asks for a plan of commands with Build it
export const SHAPE_CHIPS = [
  { shape: 'answer', label: 'Answer', title: 'A short answer: a few lines' },
  { shape: 'brief', label: 'Brief', title: 'An overview in coloured blocks, with the figures' },
  { shape: 'plan', label: 'Plan', title: 'A plan, step by step: what is new, changed, removed or checked' },
  { shape: 'build', label: 'Build', title: 'Build it: a plan of commands, staged for you to validate' },
];

const TAG_RE = /<<\s*shape\s*:\s*(answer|brief|plan|build)\s*>>[ \t]*(?:\r?\n)?/gi;

// { shape: 'answer'|'brief'|'plan'|null, text } — the first tag wins, every copy is removed
export function splitShape(text) {
  let shape = null;
  const rest = String(text ?? '').replace(TAG_RE, (_m, s) => {
    const k = s.toLowerCase();
    if (!shape) shape = k === 'build' ? 'plan' : k;
    return '';
  });
  return { shape, text: rest.replace(/^\s+/, '') };
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;
// an answer: each line a bullet (the markers the model may put first are kept as a colour); never more cut than shown
export function answerLines(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const ask = /^❓️?\s*/.test(l);
    return { text: l.replace(BULLET, '').replace(/^❓️?\s*/, ''), ask };
  }).filter(l => l.text);
}

// a plan: [+] [~] [-] [=] steps (after an optional "- " or "1. "), a lead line, plain lines and a ❓ line
const STEP = /^\s*(?:(?:[-•*]|\d+[.)])\s+)?\[([+~=\-])\]\s*(.*)$/;
export const STEP_KIND = { '+': 'new', '~': 'changed', '-': 'removed', '=': 'same' };
export function planLines(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(raw => {
    const l = raw.trim();
    if (!l) return;
    const m = STEP.exec(l);
    if (m) { out.push({ kind: 'step', mark: STEP_KIND[m[1]], text: m[2] }); return; }
    if (/^❓/.test(l)) { out.push({ kind: 'ask', text: l.replace(/^❓️?\s*/, '') }); return; }
    const isLead = !out.length;
    out.push({ kind: isLead ? 'lead' : 'text', text: l.replace(BULLET, '') });
  });
  return out;
}

// the page each card's change is made on (a stopgap until the command registry of P3 names the page of every command)
export const PAGE_OF_RPC = {
  plan_position: 'Crop planner', plan_succession: 'Crop planner', steady_apply: 'Crop planner', move_batch: 'Crop planner',
  resize_batch: 'Crop planner', change_batch_crop: 'Crop planner', cancel_crop_plan: 'Crop planner', set_batch_nursery: 'Crop planner',
  split_zone: 'Crop planner', clear_zone: 'Crop planner', apply_batch_adjustment: 'Crop planner',
  save_order: 'Orders', plan_order_line: 'Orders', save_procedure: 'Procedures', save_crop: 'Crop library', fork_crop: 'Crop library',
  record_market_price: 'Market', raise_issue: 'Issues', save_asset: 'Equipment', save_maintenance_rule: 'Equipment',
  save_farm_holiday: 'Farm setup',
};

// the cards that came with the answer at view[i]: the action items right after it
export function cardsAfter(view, i) {
  const out = [];
  for (let k = i + 1; k < (view || []).length && view[k]?.role === 'action'; k++) out.push(view[k]);
  return out;
}

// "3 cards on 2 pages: Crop planner ×2, Orders ×1" — or that the plan comes with none
export function cardsLine(cards) {
  const n = (cards || []).length;
  if (!n) return 'No cards: nothing changes until you ask for it.';
  const by = new Map();
  cards.forEach(c => { const p = PAGE_OF_RPC[c.rpc] || 'Other'; by.set(p, (by.get(p) || 0) + 1); });
  const pages = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return `${n} card${n === 1 ? '' : 's'} on ${pages.length} page${pages.length === 1 ? '' : 's'}: ` + pages.map(([p, k]) => `${p} ×${k}`).join(', ');
}

// ── a build's plan (P5): the pages of the registry by name, its cards by page, its cost and time ─────────────────────
export const PAGE_TITLE = {
  '#/farmnet/irrigation': 'FarmNet › Irrigation', '#/farmnet/overview': 'FarmNet', '#/farmnet/mixing': 'FarmNet › Mixing',
  '#/farmnet/climate': 'FarmNet › Climate', '#/grow/planner': 'Crop planner', '#/grow/library': 'Crop library',
  '#/grow/forecast': 'Forecast review', '#/grow/procedures': 'Procedures', '#/ipm/programs': 'IPM programs',
  '#/office/management': 'Farm management', '#/maintenance/preventive': 'Preventive maintenance', '#/dashboard/issues': 'Issues',
  '#/farm/zones': 'Farm setup', '#/office/orders': 'Orders', '#/office/market': 'Market', '#/maintenance/equipment': 'Equipment',
};
export const pageTitle = route => PAGE_TITLE[route] || String(route || '').replace(/^#\//, '').replace(/\//g, ' › ') || 'Other';

// "3 cards on 2 pages: FarmNet › Irrigation ×2, Crop planner ×1" from the plan's pages ([{ page, n }])
export function planPagesLine(pages) {
  const list = (pages || []).filter(p => p && p.n > 0);
  const n = list.reduce((t, p) => t + p.n, 0);
  if (!n) return 'No cards.';
  return `${n} card${n === 1 ? '' : 's'} on ${list.length} page${list.length === 1 ? '' : 's'}: ` + list.map(p => `${pageTitle(p.page)} ×${p.n}`).join(', ');
}
const secs = s => (s = Math.max(1, Math.round(Number(s) || 0))) < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? (s % 60) + ' s' : ''}`.trim();
// A build's effort, by colour, instead of its cost (owner, 21 Nov 2026: "remove the cost of the ai actions, just put a
// color budget to anticipate low effort, medium effort and long effort"). From the estimate the function sends: what
// the AI's work costs (its calls and the fixes it may need) and how long building takes on screen; the larger of the two
// decides. No amount is shown anywhere in the panel.
export const EFFORT = [
  { level: 'low', label: 'Low effort', usd: 0.30, s: 60 },
  { level: 'medium', label: 'Medium effort', usd: 1.00, s: 180 },
  { level: 'long', label: 'Long effort', usd: Infinity, s: Infinity },
];
export function effortOf(e) {
  if (!e) return null;
  const usd = Number(e.cost_usd) || 0, s = Number(e.seconds) || 0;
  const byUsd = EFFORT.findIndex(x => usd < x.usd), byS = EFFORT.findIndex(x => s < x.s);
  return EFFORT[Math.max(byUsd < 0 ? 2 : byUsd, byS < 0 ? 2 : byS)];
}
// "● Medium effort · about 2 min to build" — the dot carries the colour (styles.css .ai-effort-*)
export function effortLine(e) {
  const x = effortOf(e);
  return x ? x.label + (Number(e.seconds) > 0 ? ` · about ${secs(e.seconds)} to build` : '') : '';
}
export function effortBadge(e, el) {
  const x = effortOf(e);
  if (!x) return el('span', 'ai-effort');
  const b = el('span', `ai-effort ai-effort-${x.level}`);
  b.append(el('span', 'ai-effort-dot'), el('span', null, effortLine(e)));
  b.title = 'How much work this build is for the AI: green low, amber medium, red long';
  return b;
}
export const STEP_MARK = { '+': 'new', '~': 'changed', '-': 'removed' };
