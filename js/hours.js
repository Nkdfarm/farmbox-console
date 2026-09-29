// ═══════════════════════════════════════════════════════════════════════════
// Tasks › Hours (migration 0134, console 0.7.146)
//
// Per person: hours clocked on the phone, hours of the tasks planned for them,
// hours of the tasks they finished (actual minutes, else the checklist's own
// time, else the estimate — shared between the task's people), and what the
// clocked hours cost. A row opens its days. The Admin and the Farm manager may
// correct the clock record and set what an hour of each person costs (the money
// dashboard reads it).
// ═══════════════════════════════════════════════════════════════════════════
import { openFast, rpc } from './api.js';
import { loading, el, pageHead, drawer, field, selectBox, toast, busy, avatar, confirmDrawer, pref } from './ui.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const h = m => { m = Math.round(Number(m || 0)); return m ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : '—'; };
const nice = s => s ? new Date(s).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const dayShort = s => new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const localInput = s => { if (!s) return ''; const d = new Date(s); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function hoursRange(which = pref.get('fbc_hours_period') || 'week') {
  const t = new Date(); const monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
  if (which === 'last') { const m = new Date(monday); m.setDate(m.getDate() - 7); const s = new Date(m); s.setDate(s.getDate() + 6); return { p_from: ymd(m), p_to: ymd(s) }; }
  if (which === 'month') return { p_from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), p_to: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
  const s = new Date(monday); s.setDate(s.getDate() + 6);
  return { p_from: ymd(monday), p_to: ymd(s) };
}

let farm = null, mount = null, data = null, open = new Set();
export async function renderHours(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}
async function load(fresh = false) {
  const here = mount;
  await openFast([['labour_hours', { p_farm: farm.id, ...hoursRange() }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the hours…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}

function paint() {
  mount.textContent = '';
  const cur = pref.get('fbc_hours_period') || 'week';
  const seg = el('div', 'seg');
  [['week', 'This week'], ['last', 'Last week'], ['month', 'This month']].forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label); b.setAttribute('aria-pressed', String(v === cur));
    b.onclick = () => { pref.set('fbc_hours_period', v); load(); };
    seg.append(b);
  });
  const add = data.may_edit ? el('button', 'btn btn-sm', 'Add hours') : null;
  if (add) add.onclick = () => editEntry(null);
  mount.append(pageHead(null, 'Hours worked — the task timers on the phone — against the hours of the tasks planned for each person and the tasks they finished. ' +
    'The Admin and the Farm manager correct the record and set what an hour costs.', add, seg));

  const ppl = data.people || [];
  const tot = k => ppl.reduce((a, p) => a + Number(p[k] || 0), 0);
  const tiles = el('div', 'tiles hr-tiles');
  const tile = (v, l, s) => { const x = el('div', 'tile'); const b = el('div', 'tile-body'); b.append(el('div', 'tile-value', v), el('div', 'tile-label', l)); if (s) b.append(el('div', 'tile-sub', s)); x.append(b); return x; };
  tiles.append(tile(h(tot('clocked')), 'Worked'), tile(h(tot('planned')), 'Tasks planned'), tile(h(tot('done')), 'Tasks done', `${tot('tasks_done')} of ${tot('tasks')} tasks`),
               tile(tot('cost') ? `${data.currency} ${Math.round(tot('cost')).toLocaleString()}` : '—', 'Cost of the hours worked'));
  mount.append(tiles);

  const card = el('div', 'card');
  const t = el('table', 'table hr-table');
  t.innerHTML = '<thead><tr><th>Person</th><th class="num">Worked</th><th class="num">Planned</th><th class="num">Done</th><th>Done ÷ worked</th><th class="num">Tasks</th><th class="num">Per hour</th><th class="num">Cost</th></tr></thead>';
  const tb = el('tbody');
  ppl.forEach(p => {
    const tr = el('tr', 'hr-row');
    const who = el('td', 'hr-who'); who.append(avatar({ ...p, id: p.worker_id }, 'sm'));
    const nm = el('div'); nm.append(el('b', null, p.name));
    if (p.open) nm.append(el('div', 'hint hr-on', `clocked in since ${new Date(p.open).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`));
    else if (p.employment === 'casual') nm.append(el('div', 'hint', 'on demand'));
    who.append(nm);
    const ratio = Number(p.clocked) ? Math.round(100 * Number(p.done) / Number(p.clocked)) : null;
    const rt = el('td'); const bar = el('div', 'yd-bar'); const f = el('i'); f.style.width = Math.min(100, ratio || 0) + '%'; bar.append(f);
    rt.append(bar, el('span', 'hint', ratio == null ? '—' : `${ratio}%`));
    const rate = el('td', 'num');
    if (data.may_edit) {
      const b = el('button', 'btn btn-sm btn-ghost', p.hourly_cost != null ? `${data.currency} ${Number(p.hourly_cost)}` : 'set');
      b.onclick = e => { e.stopPropagation(); setCost(p); };
      rate.append(b);
    } else rate.textContent = p.hourly_cost != null ? `${data.currency} ${Number(p.hourly_cost)}` : '—';
    tr.append(who, el('td', 'num', h(p.clocked)), el('td', 'num', h(p.planned)), el('td', 'num', h(p.done)), rt,
              el('td', 'num', `${p.tasks_done}/${p.tasks}`), rate, el('td', 'num', Number(p.cost) ? `${data.currency} ${Math.round(p.cost).toLocaleString()}` : '—'));
    tr.onclick = () => { open.has(p.worker_id) ? open.delete(p.worker_id) : open.add(p.worker_id); paint(); };
    tb.append(tr);
    if (open.has(p.worker_id)) {
      const dr = el('tr', 'hr-days'); const td = el('td'); td.colSpan = 8;
      const g = el('div', 'hr-grid');
      (p.days || []).forEach(d => {
        const c = el('div', 'hr-day');
        c.append(el('b', null, dayShort(d.d)), el('span', null, `worked ${h(d.clocked)}`), el('span', 'hint', `planned ${h(d.planned)}`), el('span', 'hint', `done ${h(d.done)}`));
        g.append(c);
      });
      td.append(g); dr.append(td); tb.append(dr);
    }
  });
  t.append(tb); card.append(t); mount.append(card);

  // the record itself
  const ent = data.entries || [];
  const rec = el('div', 'card card-pad');
  rec.append(el('div', 'sec-title', `Clock record · ${ent.length}`));
  if (!ent.length) rec.append(el('div', 'hint', 'Nobody has clocked in during this period. People clock in and out on Naked Brain (the phone).'));
  else {
    const t2 = el('table', 'table');
    t2.innerHTML = '<thead><tr><th>Person</th><th>In</th><th>Out</th><th class="num">Time</th><th>From</th><th></th></tr></thead>';
    const b2 = el('tbody');
    ent.forEach(e => {
      const tr = el('tr');
      const act = el('td');
      if (data.may_edit) { const b = el('button', 'btn btn-sm btn-ghost', 'Edit'); b.onclick = () => editEntry(e); act.append(b); }
      tr.append(el('td', null, e.name), el('td', null, nice(e.clock_in)), el('td', null, e.clock_out ? nice(e.clock_out) : 'still in'),
                el('td', 'num', h(e.minutes)), el('td', 'hint', e.source + (e.note ? ` · ${e.note}` : '')), act);
      b2.append(tr);
    });
    t2.append(b2); rec.append(t2);
  }
  mount.append(rec);
}

function setCost(p) {
  const d = drawer(`What an hour of ${p.name} costs`, 'Wage and what comes with it, per hour — the money dashboard uses it');
  const v = el('input', 'input'); v.type = 'number'; v.min = '0'; v.step = '0.5'; v.value = p.hourly_cost ?? '';
  d.body.append(field(`Per hour (${data.currency})`, v));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try { await rpc('set_worker_cost', { p_worker: p.worker_id, p_cost: v.value === '' ? null : Number(v.value) }); d.close(); load(true); }
    catch (e) { busy(go, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}

function editEntry(e) {
  const d = drawer(e ? `Hours of ${e.name}` : 'Add hours', 'For a day somebody forgot to clock, or clocked wrong');
  const who = selectBox((data.people || []).map(p => [p.worker_id, p.name]), e?.worker_id);
  who.disabled = !!e;
  const cin = el('input', 'input'); cin.type = 'datetime-local'; cin.value = localInput(e?.clock_in || new Date(new Date().setHours(8, 0, 0, 0)));
  const cout = el('input', 'input'); cout.type = 'datetime-local'; cout.value = localInput(e ? e.clock_out : new Date(new Date().setHours(16, 0, 0, 0)));
  const note = el('input', 'input'); note.value = e?.note || ''; note.placeholder = 'why it was corrected';
  d.body.append(field('Person', who), field('In', cin), field('Out', cout, 'empty = still in'), field('Note', note));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  if (e) {
    const rm = el('button', 'btn btn-ghost tl-clear', 'Remove');
    rm.onclick = async () => {
      if (!await confirmDrawer('Remove these hours?', `${e.name}, ${nice(e.clock_in)}.`, 'Remove')) return;
      try { await rpc('remove_time_entry', { p_id: e.id }); d.close(); load(true); } catch (x) { toast(x.message, 'bad'); }
    };
    d.footer.append(rm);
  }
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      await rpc('save_time_entry', { p_farm: farm.id, p: { id: e?.id || null, worker_id: who.value, clock_in: new Date(cin.value).toISOString(),
        clock_out: cout.value ? new Date(cout.value).toISOString() : null, note: note.value } });
      d.close(); load(true);
    } catch (x) { busy(go, false, 'Save'); toast(x.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}
