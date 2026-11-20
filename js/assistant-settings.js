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
    list.append(form, capCard(f.id));
  })();
  return list;
}

// The AI's daily cost cap (AI build mode P5, 0287): what the farm's AI may cost in a day (every function, the farm's own
// day), 20 USD when nothing is set. Over it the assistant plans no build and Build it stages nothing. Read by the members;
// set by the farm admin and the farm manager only (never from an AI connection).
function capCard(farmId) {
  const box = el('div', 'ai-card open ai-cap');
  box.append(el('div', 'ai-impact-head', 'AI cost cap per day'));
  (async () => {
    let b;
    try { b = await rpc('ai_build_budget', { p_farm: farmId }, { quiet: true }); }
    catch (e) { box.append(el('div', 'ai-card-state', /ai_build_budget|PGRST202|function/i.test(e.message) ? 'Not set up on this database yet (0287).' : e.message)); return; }
    const usd = x => '$' + Number(x || 0).toFixed(2);
    const state = el('div', 'ai-card-state');
    const show = x => { state.textContent = `Today (${x.day}): ${usd(x.spent_usd)} of ${usd(x.cap_usd)}` + (x.over ? ' — the cap is reached: the AI builds nothing more today.' : ` — ${usd(x.left_usd)} left.`); };
    show(b);
    box.append(state);
    if (b.may_edit) {
      const l = el('label', 'ai-set'); const i = el('input', 'input'); i.type = 'number'; i.min = 0; i.max = 1000; i.step = '0.5'; i.value = b.cap_usd;
      l.append('Daily cap, USD (0: the AI builds nothing): ', i); box.append(l);
      const save = el('button', 'btn btn-sm btn-primary', 'Save the cap');
      save.onclick = async () => {
        save.disabled = true;
        try { const r = await rpc('save_ai_build_cap', { p_farm: farmId, p_cap: i.value === '' ? null : Number(i.value) }); i.value = r.cap_usd; show(r); toast('Saved', 'ok'); }
        catch (e) { toast(e.message, 'bad'); }
        save.disabled = false;
      };
      box.append(save);
    } else box.append(el('div', 'ai-card-state', 'Only the farm admin or the farm manager changes the cap.'));
    box.append(el('div', 'ai-card-state', 'Every AI call of this FarmBox counts (questions, photos, plans). Before a build the assistant says what it will cost and how long it takes.'));
  })();
  return box;
}
