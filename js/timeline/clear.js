// cancelling validated batches and clearing a zone
import { drawer, selectBox, el, field, loading, busy, toast, emptyState } from '../ui.js';
import { rpc } from '../api.js';
import { steadyGroups, groupName } from './steady.js';
import { reload } from './index.js';
import { S } from './state.js';

// ── clearing a zone, after saying what goes ──────────────────────────────────
// ── cancel the validated batches in bulk (0157): the whole unit or one steady group, then plan the groups again ──
// Kept: batches whose seedlings are ordered, and those growing. One request a zone, so each stays inside the API's time.
export function openCancelValidated() {
  const groups = steadyGroups();
  const d = drawer('Cancel validated batches', 'What is cancelled is counted first; nothing changes until you confirm');
  const scopes = [['all', 'The whole unit'], ...groups.map(g => [g.id, groupName(g)])];
  const scope = selectBox(scopes, 'all');
  const replan = el('input'); replan.type = 'checkbox'; replan.checked = true;
  const rl = el('label', 'row'); rl.append(replan, el('span', null, 'Plan the steady groups again straight after — same crops, same positions, their own settings'));
  const info = el('div');
  d.body.append(field('Which batches', scope), info, rl,
    el('div', 'note warn', 'Cancelled batches lose their open tasks and seedling orders. The new plan comes back as proposals: validate it to order the seedlings again.'));
  const cancel = el('button', 'btn', 'Keep everything'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-danger', 'Cancel the batches');
  d.footer.append(cancel, el('div', 'spacer'), go);

  let dry = null, countSeq = 0;
  const sysOf = v => v === 'all' ? null : (S.data.systems || []).filter(x => x.steady_group_id === v).map(x => x.id);
  const groupsOf = v => v === 'all' ? groups : groups.filter(g => g.id === v);
  const count = async () => {
    // only the answer for what is chosen now counts: the whole unit's count is the slow one, and when it came back
    // after a group had been picked the button cancelled the whole unit (review 13 Oct 2026)
    const my = ++countSeq;
    dry = null;
    info.replaceChildren(loading('Counting…'));
    go.disabled = true;
    try {
      const r = await rpc('cancel_validated', { p_farm: S.farm.id, p_systems: sysOf(scope.value), p_dry: true }, { quiet: true });
      if (my !== countSeq) return;
      dry = r;
      const lines = el('ul', 'tl-clear-list');
      lines.append(el('li', null, `${dry.to_cancel} validated batch${dry.to_cancel === 1 ? '' : 'es'} — cancelled`));
      if (dry.kept_ordered) lines.append(el('li', null, `${dry.kept_ordered} with seedlings already ordered — kept`));
      if (dry.growing) lines.append(el('li', null, `${dry.growing} growing — kept`));
      const z = (dry.zones || []).filter(x => x.cancel > 0);
      info.replaceChildren(lines);
      if (z.length) info.append(el('div', 'hint', `${z.length} zone${z.length === 1 ? '' : 's'}: ` + z.map(x => `${x.zone} ${x.cancel}`).join(', ')));
      const gs = groupsOf(scope.value);
      rl.style.display = gs.length ? '' : 'none';
      go.disabled = !dry.to_cancel && !(replan.checked && gs.length);
      go.textContent = dry.to_cancel ? `Cancel ${dry.to_cancel} batch${dry.to_cancel === 1 ? '' : 'es'}` : 'Plan the groups again';
    } catch (e) { if (my === countSeq) info.replaceChildren(el('div', 'note bad', e.message)); }
  };
  scope.onchange = count;
  replan.onchange = count;
  count();

  go.onclick = async () => {
    if (!dry) return;
    const zones = (dry.zones || []).filter(x => x.cancel > 0);
    const gs = replan.checked ? groupsOf(scope.value) : [];
    const steps = zones.length + gs.length;
    let n = 0, cancelled = 0, planned = 0;
    const done = () => busy(go, true, `${Math.round(100 * n / Math.max(steps, 1))} %…`);
    done();
    cancel.disabled = true; scope.disabled = true; replan.disabled = true;
    try {
      for (const z of zones) {
        const r = await rpc('cancel_validated', { p_farm: S.farm.id, p_systems: [z.system_id], p_dry: false });
        cancelled += Number(r.cancelled || 0); n++; done();
      }
      const failed = [];
      for (const g of gs) {           // one group failing does not stop the others
        const zs = (S.data.systems || []).filter(x => x.steady_group_id === g.id && x.steady_crop_id);
        if (zs.length) {
          try {
            const r = await rpc('steady_apply', { p_farm: S.farm.id, p_group: g.id, p_objective: g.objective || 'per_crop',
              p_horizon: Number(g.horizon) || 182,
              p_zones: zs.map(x => ({ system_id: x.id, crop_id: x.steady_crop_id, n: (x.positions || []).length })) });
            planned += Number(r.batches || 0);
          } catch (e) { failed.push(`${groupName(g)}: ${e.message}`); }
        }
        n++; done();
      }
      d.close();
      toast(`${cancelled} batch${cancelled === 1 ? '' : 'es'} cancelled` + (gs.length ? ` · ${planned} proposed again in ${gs.length - failed.length} steady group${gs.length - failed.length === 1 ? '' : 's'} — validate them to order the seedlings` : '') +
            (failed.length ? ` · not planned: ${failed.join('; ')} — try its Options… → Plan it` : ''), failed.length ? 'bad' : 'ok');
    } catch (e) {
      d.close();
      toast(`Stopped after ${cancelled} cancelled${planned ? `, ${planned} proposed` : ''}: ${e.message}`, 'bad');
    }
    await reload();
  };
}

export function clearButton(sys) {
  const b = el('button', 'btn btn-sm btn-ghost tl-clear', 'Clear zone');
  b.title = `Remove the crops planned in ${sys.name} (and, if you choose, the ones growing)`;
  b.onclick = () => openClear(sys);
  return b;
}
function openClear(sys) {
  const ids = new Set((sys.positions || []).map(p => p.id));
  const mine = (S.data.batches || []).filter(b => ids.has(b.position_id));
  const n = st => mine.filter(b => b.status === st).length;
  const prop = n('proposed'), val = n('validated'), act = n('active');
  const d = drawer(`Clear ${sys.name}?`, 'What is removed, before anything is');
  // the counts are the batches in the window on screen; clear_zone takes every one in the zone,
  // later ones too — so say so, and never refuse a zone whose batches are all further out (review 3 Oct 2026)
  if (!prop && !val && !act) d.body.append(emptyState('Nothing planned or growing in the window on screen.'));
  const lines = el('ul', 'tl-clear-list');
  if (prop) lines.append(el('li', null, `${prop} proposal${prop === 1 ? '' : 's'} — removed`));
  if (val) lines.append(el('li', null, `${val} validated batch${val === 1 ? '' : 'es'} — cancelled, their open tasks removed`));
  if (act) lines.append(el('li', null, `${act} batch${act === 1 ? '' : 'es'} growing — kept unless you tick below`));
  d.body.append(lines, el('div', 'hint', 'Counted in the window on screen. Batches planned later in this zone are removed too.'));
  const growing = el('input'); growing.type = 'checkbox';
  const gl = el('label', 'row'); gl.append(growing, el('span', null, `Also remove the crops growing${act ? ` (${act} on screen)` : ''}: they are marked cancelled and their tasks removed; harvests already recorded stay.`));
  d.body.append(gl);
  d.body.append(el('div', 'note warn', 'This cannot be undone from here: a cancelled batch has to be planned again.'));
  const cancel = el('button', 'btn', 'Keep everything'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-danger', 'Clear the zone');
  go.onclick = async () => {
    busy(go, true, 'Clearing…');
    try {
      const r = await rpc('clear_zone', { p_system: sys.id, p_growing: growing.checked });
      d.close();
      toast(`${r.zone} cleared: ${r.proposed} proposed, ${r.validated} validated` + (r.growing ? `, ${r.growing} growing` : '') +
            (r.growing_kept ? ` · ${r.growing_kept} growing kept` : ''), 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Clear the zone'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}
