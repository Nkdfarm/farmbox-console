// ═══════════════════════════════════════════════════════════════════════════
// The assistant's answer shapes (AI build mode P1, docs/ai-build-mode.md, owner 20 Nov 2026) — the pure part, no imports,
// so that it can be checked in Node. The function puts <<shape:answer|brief|plan>> on the first line of a reply; the band
// strips it and draws the answer by it: answer = one compact box of 1–4 bullets, brief = the coloured blocks of 0.11.04,
// plan = one coloured line per step ([+] new, [~] changed, [-] removed or not done, [=] checked) and the line of the cards.
// A reply without a tag (an old answer, or the model forgot it) is drawn as before (brief). The same parsing as the
// function's own (supabase/functions/assistant/talk.ts).
// ═══════════════════════════════════════════════════════════════════════════

// the chips of the question box: none ticked = auto. Build is added in P5 (creation mode): until then it stays hidden
export const SHAPE_CHIPS = [
  { shape: 'answer', label: 'Answer', title: 'A short answer: a few lines' },
  { shape: 'brief', label: 'Brief', title: 'An overview in coloured blocks, with the figures' },
  { shape: 'plan', label: 'Plan', title: 'A plan, step by step: what is new, changed, removed or checked' },
  { shape: 'build', label: 'Build', title: 'Build it: a plan of commands, staged for you to validate', hidden: true },
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
