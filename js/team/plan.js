// Team page: the plan card (this team tried first, applied on a click)
import { rpc } from '../api.js';
import { el, toast, confirmDrawer, busy, farmToday, parseYmd } from '../ui.js';
import { paint, reload } from './index.js';
import { S, teamWeek } from './state.js';

// ── the plan with this team: tried first, applied on a click ────────────────
function planRange() {
  const r = teamWeek();
  const today = farmToday();
  return { p_from: r.p_from < today ? today : r.p_from, p_to: r.p_to };
}
const niceDay = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export function planCard() {
  const c = el('div', 'card card-pad team-plan');
  const r = planRange();
  const span = `${niceDay(r.p_from)} – ${niceDay(r.p_to)}`;
  c.append(el('div', 'sec-title', `The plan with this team · ${span}`));
  if (r.p_to < r.p_from) { c.append(el('div', 'hint', 'This week is over.')); return c; }
  c.append(el('div', 'hint', 'See what “Assign automatically” would give each person with the numbers above. Nothing changes until you apply it; ' +
    'the Friday plan uses the same numbers by itself.'));
  const row = el('div', 'row team-more');
  const tryb = el('button', 'btn', S.preview ? 'Preview again' : 'Preview the plan');
  tryb.onclick = async () => {
    busy(tryb, true, 'Trying…');
    try { S.preview = await rpc('team_preview', { p_farm: S.farm.id, ...r }, { quiet: true }); paint(); }
    catch (e) { busy(tryb, false); toast(e.message, 'bad'); }
  };
  row.append(tryb);
  if (S.preview) {
    const res = S.preview.result || {};
    const un = res.unassigned || [], ci = res.call_ins || [];
    const say = el('div', 'note' + (un.length ? ' warn' : ''));
    say.textContent = `${res.assigned ?? 0} of ${res.tasks ?? 0} open tasks would get a name — each person’s hours are in the table above (“with this team”).`
      + (un.length ? ` ${un.length} would stay without: ${un[0].reason}.` : '')
      + (ci.length ? ` ${ci.length} call-in${ci.length > 1 ? 's' : ''} (${[...new Set(ci.map(x => x.worker))].join(', ')}).` : '')
      + (res.left_alone ? ` ${res.left_alone} already started stay as they are.` : '');
    c.append(say);
    const apply = el('button', 'btn btn-primary', 'Apply to the open tasks');
    apply.onclick = async () => {
      if (!await confirmDrawer('Apply this plan?',
        `The names on the open tasks of ${span} are replaced by this plan — also the ones somebody chose by hand. Tasks already started keep their people.`,
        'Apply')) return;
      busy(apply, true, 'Assigning…');
      try {
        const done = await rpc('auto_assign', { p_farm: S.farm.id, p_from: r.p_from, p_to: r.p_to });
        toast(`${done.assigned} of ${done.tasks} tasks assigned`, (done.unassigned || []).length ? 'bad' : 'ok');
        await reload();
      } catch (e) { busy(apply, false, 'Apply to the open tasks'); toast(e.message, 'bad'); }
    };
    row.append(apply);
  }
  c.append(row);
  return c;
}
