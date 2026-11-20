// ═════════════════════════════════════════════════════════════════════
// AI permissions on the Team page, below AI access (AI build mode P3, migration 0285, console 0.18.00; owner, 20 Nov
// 2026: "per farm, per family: may propose (plan) and may build (stage and, after validation, apply)").
//
// One row per family of the command registry: Propose (the console's AI may put it in a card or a plan) and Build (it
// may stage it as a draft that the asking person validates). Build needs Propose. The row "Decisions" is always off and
// cannot be ticked: approving, validating, marking done, submitting, paying, giving access and the AI's own settings
// stay a person's. Everything is on until the farm admin or the farm manager turns it off; the others read it.
// The database decides (public.ai_permissions / save_ai_permission); the assistant function reads the same.
// ═════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast, farmWhen } from './ui.js';

const say = e => String(e?.message || e).replace(/^\d+ /, '');
const missing = e => /PGRST202|Could not find the function|does not exist/i.test(say(e));   // 0285 not applied yet

function switchBox(on, label, disabled, onChange) {
  const b = el('button', 'switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(!!on));
  b.setAttribute('aria-label', label);
  b.disabled = !!disabled;
  if (!disabled) b.onclick = () => onChange(!on, b);
  return b;
}

export function aiPermissionsCard(farm) {
  const c = el('div', 'card card-pad team-ai-perms');
  const head = el('div', 'row');
  const text = el('div');
  text.append(el('b', null, 'AI permissions '), el('span', 'hint',
    'What the console’s AI may propose (a card or a plan) and build (stage it, for the person who asked to validate), family by family.'));
  head.append(text);
  const body = el('div', 'team-ai-perms-body');
  body.append(el('div', 'hint', 'Reading…'));
  c.append(head, body);

  const paint = P => {
    body.textContent = '';
    const grid = el('div', 'team-ai-perms-grid');
    grid.setAttribute('role', 'table');
    const hr = el('div', 'team-ai-perms-row is-head'); hr.setAttribute('role', 'row');
    ['Family', 'Propose', 'Build'].forEach(h => { const x = el('span', null, h); x.setAttribute('role', 'columnheader'); hr.append(x); });
    grid.append(hr);
    (P.families || []).forEach(f => {
      const row = el('div', 'team-ai-perms-row' + (f.always_off ? ' is-off' : '')); row.setAttribute('role', 'row');
      const name = el('div', 'team-ai-perms-name'); name.setAttribute('role', 'cell');
      name.append(el('span', null, f.label), el('span', 'hint', f.always_off ? `Never the AI’s: ${f.about}.` : f.about));
      if (f.chosen && f.updated_by) name.append(el('span', 'hint', `Set by ${f.updated_by}, ${farmWhen(f.updated_at)}`));
      const save = async (patch, b) => {
        b.disabled = true;
        try {
          const next = await rpc('save_ai_permission', { p_farm: farm.id, p_family: f.code, p_propose: patch.propose ?? null, p_build: patch.build ?? null });
          paint(next);
          const now = (next.families || []).find(x => x.code === f.code) || {};
          toast(`${f.label}: ${now.build ? 'the AI may propose and build' : now.propose ? 'the AI may propose, not build' : 'the AI neither proposes nor builds'}`, 'ok');
        } catch (e) { b.disabled = false; toast(say(e), 'bad'); }
      };
      const ro = f.always_off || !P.may_edit;
      const p = switchBox(f.propose, `${f.label}: propose`, ro, (v, b) => save({ propose: v }, b));
      const bu = switchBox(f.build, `${f.label}: build`, ro || !f.propose, (v, b) => save({ build: v }, b));
      if (!f.always_off && !f.propose) bu.title = 'Build needs Propose';
      row.append(name);
      [p, bu].forEach(s => { const cell = el('span'); cell.setAttribute('role', 'cell'); cell.append(s); row.append(cell); });
      grid.append(row);
    });
    body.append(grid);
    body.append(el('div', 'hint', P.may_edit
      ? 'On until you turn it off. The AI acts with the asking person’s own rights, never more, and nothing it builds is applied before that person validates it.'
      : 'Only the farm admin and the farm manager change these.'));
  };

  rpc('ai_permissions', { p_farm: farm.id }, { quiet: true })
    .then(paint)
    .catch(e => { if (missing(e)) c.remove(); else { body.textContent = ''; body.append(el('div', 'note bad', say(e))); } });
  return c;
}
