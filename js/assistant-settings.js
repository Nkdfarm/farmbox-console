// ═══════════════════════════════════════════════════════════════════════════
// What the assistant's cards do on a FarmBox (migrations 0276 and 0278) — the form that was the gear of the assistant's
// band, moved to Settings › Assistant on 19 Nov 2026 (owner). The fields and their rules are unchanged; the card logic
// itself is to be reviewed together with the owner (docs/decided-log.md, 19 Nov 2026).
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast } from './ui.js';

export function cardSettings(farmId) {
  const list = el('div', 'ai-settings');
  if (!farmId) { list.append(el('div', 'ai-card-state', 'No FarmBox open.')); return list; }
  (async () => {
    let s;
    try { s = await rpc('ai_settings', { p_farm: farmId }, { quiet: true }); } catch (e) { list.append(el('div', 'ai-msg error', e.message)); return; }
    const f = { id: farmId };
    const form = el('div', 'ai-card open');
    const box = (label, on) => { const l = el('label', 'ai-set'); const i = el('input'); i.type = 'checkbox'; i.checked = !!on; i.disabled = !s.may_edit; l.append(i, ' ' + label); form.append(l); return i; };
    const num = (label, v) => { const l = el('label', 'ai-set'); const i = el('input', 'input'); i.type = 'number'; i.min = 0; i.placeholder = 'no limit'; i.value = v == null ? '' : v; i.disabled = !s.may_edit; l.append(label + ' ', i); form.append(l); return i; };
    const imp = box('Show what a change would do on each card', s.impact);
    const grow = box('A grower may apply a change to one running batch (class B)', s.class_b_growers);
    const days = num('Most days a reported harvest may differ from the forecast:', s.tolerance_days);
    const pct = num('Most % a reported yield may differ:', s.tolerance_yield_pct);
    form.append(el('div', 'ai-card-state', 'Empty means no limit. Above a limit the change waits for a manager or the agronomist.'));
    // learning from finished batches (0278): off until a manager turns it on, because the planner then uses what was learned
    form.append(el('div', 'ai-impact-head', 'Learning from finished batches'));
    const learn = box('Learn how long each phase really lasts from the dates observed on finished batches (once enough batches agree, the planner uses it for new batches)', s.learning);
    const ltol = num('Propose a change to a crop\'s phase days when they differ by more than (days):', s.learned_tolerance_days);
    form.append(el('div', 'ai-card-state', 'Empty means no proposals. A proposal waits in To decide for a manager or the agronomist; nothing changes until they accept it. Turning learning off goes back to each crop\'s own days.'));
    if (s.may_edit) {
      const save = el('button', 'btn btn-sm btn-primary', 'Save');
      save.onclick = async () => {
        save.disabled = true;
        try {
          await rpc('save_ai_settings', { p_farm: f.id, p: { impact: imp.checked, class_b_growers: grow.checked,
            tolerance_days: days.value === '' ? null : Number(days.value), tolerance_yield_pct: pct.value === '' ? null : Number(pct.value),
            learning: learn.checked, learned_tolerance_days: ltol.value === '' ? null : Number(ltol.value) } });
          toast('Saved', 'ok');
        } catch (e) { toast(e.message, 'bad'); }
        save.disabled = false;
      };
      form.append(save);
    } else form.append(el('div', 'ai-card-state', 'Only a manager of this FarmBox changes these.'));
    list.append(form);
  })();
  return list;
}
