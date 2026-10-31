// ═════════════════════════════════════════════════════════════════════
// AI access on the Team page (migrations 0242–0245 and 0271, console 0.7.264–0.7.265)
//
// Somebody of the team can connect their own Claude or ChatGPT to Naked Heart (the MCP) and have it
// read the farm data that is ticked for them — and, since 0271, change what is ticked write, as them, with their
// own rights. It is set where the rest of a person is set:
//   * a person's Edit window has a section "AI access": the tick, an end date, what it may read and what it may
//     also change (chips, starting from what their job gives), the address to send them and what their AI asked;
//   * a job's Change… window has "Their own AI may read" and "… may also change": the chips everybody of the job
//     starts from;
//   * the page itself keeps one line: who has AI access, What was asked, Stop all.
// What was asked shows the writes in their own colour; each opens to the rows it added, changed or removed
// (Check) and can be undone (Undo), refused when somebody changed a row since.
// Everything is saved with the window's own Save. The database decides who may (mcp_team's may_edit).
// ═════════════════════════════════════════════════════════════════════
import { rpc, URL_BASE } from './api.js';
import { el, toast, confirmDrawer, drawer, busy, farmInstant, farmLocal } from './ui.js';

export const MCP_URL = URL_BASE + '/functions/v1/mcp';
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const say = e => String(e?.message || e).replace(/^\d+ /, '');
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// 0271 live: the database sends the write families (until the migration is applied, the page only reads)
const writesLive = AI => Array.isArray(AI.roles?.[0]?.writes);

// The chips of the data families, on and off; returns the node and the chosen set.
// only: the families that may be shown (the write chips show only what is read).
function familyChips(AI, chosen, onChange, only) {
  const box = el('div', 'resp-cats team-ai-chips');
  const draw = () => {
    box.textContent = '';
    AI.families.filter(f => !only || only.has(f.code)).forEach(f => {
      const b = el('button', 'toggle', f.label);
      b.type = 'button';
      b.title = f.about;
      b.setAttribute('aria-pressed', String(chosen.has(f.code)));
      b.onclick = () => { chosen.has(f.code) ? chosen.delete(f.code) : chosen.add(f.code); draw(); onChange?.(); };
      box.append(b);
    });
    if (only && !only.size) box.append(el('span', 'hint', 'Tick what it may read first.'));
  };
  draw();
  return { node: box, redraw: draw };
}

// Read chips, and under them the write chips of the families read: a family no longer read is no longer written.
function readWriteChips(AI, read, write, canWrite, onChange) {
  const wrap = el('div', 'team-ai-more');
  const writes = familyChips(AI, write, onChange, read);
  writes.node.classList.add('team-ai-write');
  const reads = familyChips(AI, read, () => {
    [...write].forEach(c => { if (!read.has(c)) write.delete(c); });
    writes.redraw(); onChange?.();
  });
  const writeHead = el('div', 'hint team-ai-say', 'What it may also change, as them — with their own rights, logged, and undone here if need be:');
  const noWrite = el('div', 'hint team-ai-say');
  wrap.append(el('div', 'hint team-ai-say', 'What it may read:'), reads.node, writeHead, writes.node, noWrite);
  const show = () => {
    const why = canWrite();
    writeHead.hidden = writes.node.hidden = !!why;
    noWrite.hidden = !why;
    noWrite.textContent = why || '';
  };
  show();
  return { node: wrap, redraw: () => { reads.redraw(); writes.redraw(); show(); } };
}

const jobOf = (AI, role) => AI.roles.find(r => r.role === role) || { families: [], writes: [] };
const jobFamilies = (AI, role) => jobOf(AI, role).families;
const jobWrites = (AI, role) => jobOf(AI, role).writes || [];

// ── a person's Edit window ──────────────────────────────────────────────────
// p: the person (null for a new one); role: the job select of the form; email: its e-mail field.
// Returns { node, check(), save(workerId) } — save runs after the person is saved.
export function personAiSection(AI, p, role, email) {
  const me = p ? AI.people.find(x => x.worker_id === p.worker_id) : null;
  const live = writesLive(AI);
  const start = new Set(me ? me.families : jobFamilies(AI, role.value));
  const startW = new Set(live ? (me ? me.writes || [] : []) : []);
  const chosen = new Set(start), chosenW = new Set(startW);
  let touched = false;
  // why their AI cannot write, or null: an AI-only person and a team row without a sign-in have no rights to use
  const whyNot = () => !live ? 'It only reads.'
    : role.value === 'ai_only' ? 'Their AI only reads: an AI-only person has no rights of their own to write with.'
    : !(me?.has_login ?? p?.has_login) ? 'Their AI only reads until they have a Naked Heart sign-in of their own: it writes with their rights.'
    : null;

  const wrap = el('div');
  wrap.append(el('div', 'sec-title', 'AI access'));
  const lab = el('label', 'team-off team-ai-tick');
  const tick = el('input'); tick.type = 'checkbox'; tick.checked = !!me?.ai_access;
  lab.append(tick, 'Their own Claude or ChatGPT may use this farm’s data');
  wrap.append(lab);

  const more = el('div', 'team-ai-more');
  const until = el('input', 'input team-ai-until');
  until.type = 'date';
  until.value = me?.ai_until ? farmLocal(me.ai_until).slice(0, 10) : '';
  until.min = farmLocal(new Date().toISOString()).slice(0, 10);
  const untilRow = el('div', 'team-ai-access');
  untilRow.append(el('span', null, 'Until'), until, el('span', 'hint', 'empty: until you untick'));
  const count = el('div', 'hint team-ai-count');
  const sayCount = () => {
    count.textContent = `Reads ${plural(chosen.size, 'family', 'families')}` + (whyNot() ? '' : `, writes ${chosenW.size}`);
  };
  const chips = readWriteChips(AI, chosen, chosenW, whyNot, () => { touched = true; sayCount(); });
  sayCount();
  const url = el('div', 'row team-more');
  const code = el('code', 'team-ai-url', MCP_URL);
  const copy = el('button', 'btn btn-sm', 'Copy');
  copy.type = 'button';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(MCP_URL); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }
    catch { toast('Select the address and copy it', 'bad'); }
  };
  url.append(code, copy);
  more.append(untilRow, count, chips.node,
    el('div', 'hint team-ai-say', 'Send them this address. They add it in Claude (Settings › Connectors › Add custom connector) or ChatGPT, sign in with their e-mail here and press Allow.'),
    url);
  if (me?.last_used) {
    const used = el('div', 'hint team-ai-say');
    used.append(`Asked ${me.calls_30d} time${me.calls_30d === 1 ? '' : 's'} in 30 days`
      + (me.writes_30d ? ` (${plural(me.writes_30d, 'change', 'changes')})` : '')
      + `, last ${when(me.last_used)}`
      + ((me.ai_names || []).length ? ' · ' + me.ai_names.join(', ') : '') + ' · ');
    const see = el('button', 'btn btn-sm btn-ghost', 'What was asked');
    see.type = 'button';
    see.onclick = () => openAsked(AI, me);
    used.append(see);
    more.append(used);
  }
  wrap.append(more);
  const show = () => { more.hidden = !tick.checked; };
  tick.onchange = show;
  show();
  // a new job brings that job's chips, unless they were clicked already
  role.addEventListener('change', () => {
    if (!touched) {
      chosen.clear(); jobFamilies(AI, role.value).forEach(c => chosen.add(c));
      chosenW.clear(); if (me) jobWrites(AI, role.value).forEach(c => chosenW.add(c));
    }
    if (whyNot()) chosenW.clear();
    chips.redraw(); sayCount();
  });

  const firstUntil = until.value;
  const untilIso = () => (tick.checked && until.value ? farmInstant(until.value + 'T23:59') : null);
  const changed = () => !!me?.ai_access !== tick.checked
    || (tick.checked && (until.value !== firstUntil || !sameSet(chosen, start) || !sameSet(chosenW, startW)));

  return {
    node: wrap,
    // what to say before saving, or null
    check() {
      if (!tick.checked) return null;
      if (!chosen.size) return 'Choose at least one thing their AI may read, or untick AI access';
      if (!email.value.trim() && !p?.has_login) return 'AI access needs an e-mail: their AI signs in with it';
      if (until.value && until.value < until.min) return 'The AI access end date is already past';
      return null;
    },
    async save(workerId) {
      if (!workerId || !changed()) return false;
      if (tick.checked) {
        // the person's chips as they are now (a new job may have changed them), then each difference
        const T = await rpc('mcp_team', { p_farm: AI.farm_id });
        const now = new Set((T.people.find(x => x.worker_id === workerId) || { families: [] }).families);
        for (const f of AI.families) {
          if (chosen.has(f.code) !== now.has(f.code)) {
            await rpc('mcp_person_family', { p_worker: workerId, p_family: f.code, p_on: chosen.has(f.code) });
          }
        }
        // then the write ticks, against what reading left (a read taken away takes its write with it)
        if (writesLive(T) && !whyNot()) {
          const T2 = await rpc('mcp_team', { p_farm: AI.farm_id });
          const nowW = new Set((T2.people.find(x => x.worker_id === workerId) || { writes: [] }).writes || []);
          for (const f of AI.families) {
            const want = chosenW.has(f.code) && chosen.has(f.code);
            if (want !== nowW.has(f.code)) {
              await rpc('mcp_person_write', { p_worker: workerId, p_family: f.code, p_on: want });
            }
          }
        }
      }
      await rpc('mcp_set_access', { p_worker: workerId, p_on: tick.checked, p_until: untilIso() });
      return true;
    },
  };
}

// ── a job's Change… window ──────────────────────────────────────────────────
export function jobAiSection(AI, roleName) {
  const r = AI.roles.find(x => x.role === roleName);
  if (!r) return null;
  const live = writesLive(AI);
  const start = new Set(r.families), chosen = new Set(start);
  const startW = new Set(r.writes || []), chosenW = new Set(startW);
  const whyNot = () => !live ? 'It only reads.'
    : roleName === 'ai_only' ? 'An AI-only person’s AI only reads: they have no rights of their own to write with.' : null;
  const wrap = el('div', 'team-ai-job');
  const head = el('div', 'row team-sec');
  head.append(el('div', 'sec-title', 'Their own AI may read'), el('div', 'spacer'));
  if (r.own) {
    const back = el('button', 'btn btn-sm btn-ghost', 'Back to standard');
    back.type = 'button';
    back.onclick = async () => {
      busy(back, true, 'Saving…');
      try {
        const T = await rpc('mcp_reset_role', { p_farm: AI.farm_id, p_role: roleName });
        chosen.clear(); jobFamilies(T, roleName).forEach(c => chosen.add(c)); start.clear(); chosen.forEach(c => start.add(c));
        chosenW.clear(); jobWrites(T, roleName).forEach(c => chosenW.add(c)); startW.clear(); chosenW.forEach(c => startW.add(c));
        chips.redraw(); back.remove(); toast('Back to the standard list', 'ok');
      } catch (e) { busy(back, false); toast(say(e), 'bad'); }
    };
    head.append(back);
  }
  wrap.append(head, el('div', 'hint', 'For those of this job whose AI access is ticked (in their Edit window). A change here reaches all of them; what was changed for one person stays.'));
  const chips = readWriteChips(AI, chosen, chosenW, whyNot);
  wrap.append(chips.node);
  return {
    node: wrap,
    async save() {
      const wantW = new Set([...chosenW].filter(c => chosen.has(c)));
      const readChanged = !sameSet(chosen, start);
      // after a read change the database keeps the write ticks of the families still read
      const keptW = new Set([...startW].filter(c => chosen.has(c)));
      if (!readChanged && sameSet(wantW, startW)) return false;
      if (readChanged) await rpc('mcp_set_role', { p_farm: AI.farm_id, p_role: roleName, p_families: [...chosen] });
      if (live && !whyNot() && !sameSet(wantW, keptW)) {
        await rpc('mcp_set_role_write', { p_farm: AI.farm_id, p_role: roleName, p_write: [...wantW] });
      }
      return true;
    },
  };
}

// ── the Team page's line ────────────────────────────────────────────────────
export function aiLine(AI, done) {
  const on = AI.people.filter(p => p.in_force);
  const writers = on.filter(p => (p.writes || []).length);
  const c = el('div', 'card card-pad team-ai-line');
  const row = el('div', 'row');
  const text = el('div');
  text.append(el('b', null, 'AI access '), el('span', 'hint', on.length
    ? `${on.map(p => p.name).join(', ')} can connect their own Claude or ChatGPT`
      + (writers.length ? `; ${writers.map(p => p.name).join(', ')}’s may also change data, as them.` : ', read-only.')
    : 'Nobody connects their own AI yet. Tick it in a person’s Edit window.'));
  row.append(text, el('div', 'spacer'));
  const asked = el('button', 'btn btn-sm', 'What was asked');
  asked.onclick = () => openAsked(AI, null);
  row.append(asked);
  if (AI.people.some(p => p.ai_access)) {
    const stop = el('button', 'btn btn-sm btn-ghost team-danger', 'Stop all');
    stop.onclick = async () => {
      if (!await confirmDrawer('Stop all AI access?',
        'Everybody of this farm and its sister units is unticked now, and their AIs are signed out. You can tick them again later.',
        'Stop all', true)) return;
      busy(stop, true, 'Stopping…');
      try { const n = await rpc('mcp_stop_all', { p_farm: AI.farm_id }); toast(`AI access stopped for ${n} ${n === 1 ? 'person' : 'people'}`, 'ok'); await done(); }
      catch (e) { busy(stop, false); toast(say(e), 'bad'); }
    };
    row.append(stop);
  }
  c.append(row);
  return c;
}

// ── what their AIs asked: everybody, or one person ──────────────────────────
const actionWords = name => String(name || '').replace(/_/g, ' ');
const short = (v, n = 80) => {
  const s = v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

async function openAsked(AI, person) {
  const d = drawer('What was asked', person ? `By ${person.name}’s AI` : 'By the AIs of this farm’s people, newest first');
  const close = el('button', 'btn', 'Close'); close.onclick = d.close; d.footer.append(close);
  let calls;
  try { calls = await rpc('mcp_call_log', { p_farm: AI.farm_id, p_limit: 200 }); }
  catch (e) { d.body.append(el('div', 'note bad', say(e))); return; }
  if (person) {
    const mail = (person.email || '').trim().toLowerCase();
    calls = calls.filter(c => (c.email || '').toLowerCase() === mail);
  }
  if (!calls.length) { d.body.append(el('div', 'hint', 'Nothing yet.')); return; }
  const isWrite = c => c.tool === 'act' || c.tool === 'revert';
  let only = false;
  const list = el('div');
  if (calls.some(isWrite)) {
    const f = el('div', 'resp-cats team-ai-filter');
    const all = el('button', 'toggle all', 'Everything'), wr = el('button', 'toggle', 'Changes only');
    const set = v => { only = v; all.setAttribute('aria-pressed', String(!v)); wr.setAttribute('aria-pressed', String(v)); draw(); };
    all.onclick = () => set(false); wr.onclick = () => set(true);
    all.setAttribute('aria-pressed', 'true'); wr.setAttribute('aria-pressed', 'false');
    f.append(all, wr);
    d.body.append(f);
  }
  d.body.append(list);
  function draw() {
    list.textContent = '';
    calls.filter(c => !only || isWrite(c)).forEach(c => list.append(callRow(c, person, reload)));
  }
  async function reload() {
    try {
      calls = await rpc('mcp_call_log', { p_farm: AI.farm_id, p_limit: 200 });
      if (person) calls = calls.filter(c => (c.email || '').toLowerCase() === (person.email || '').trim().toLowerCase());
    } catch (e) { toast(say(e), 'bad'); }
    draw();
  }
  draw();
}

function callRow(c, person, reload) {
  const write = c.tool === 'act' || c.tool === 'revert';
  const b = el('div', 'team-ai-call' + (write ? ' team-ai-call-write' : ''));
  const what = c.tool === 'query' ? c.args?.sql
    : c.tool === 'photo' ? `photo ${c.args?.kind} ${c.args?.id}`
    : c.tool === 'describe' ? 'what can I see?'
    : c.tool === 'act' ? `${actionWords(c.args?.action)}  ${short(c.args?.args, 160)}`
    : c.tool === 'revert' ? `undid: ${actionWords(c.args?.action)}`
    : c.tool;
  const meta = [when(c.at), person ? null : c.email, c.client_name,
                c.tool === 'act' && c.ok ? plural(c.rows ?? 0, 'row changed', 'rows changed') : c.rows != null ? `${c.rows} rows` : null]
    .filter(Boolean).join(' · ');
  b.append(el('div', 'hint', meta), el('div', 'team-ai-sql', what || ''));
  if (!c.ok) b.append(el('div', 'team-over', c.error || 'refused'));
  if (c.tool === 'act' && c.ok && c.act_id) {
    const bar = el('div', 'row team-ai-actbar');
    if (c.reverted_at) bar.append(el('span', 'team-ai-undone', `Undone ${when(c.reverted_at)}`));
    const check = el('button', 'btn btn-sm btn-ghost', 'Check');
    check.type = 'button';
    const box = el('div', 'team-ai-detail');
    box.hidden = true;
    check.onclick = async () => {
      if (!box.hidden) { box.hidden = true; check.textContent = 'Check'; return; }
      busy(check, true, 'Reading…');
      try { showDetail(box, await rpc('mcp_act_detail', { p_act: c.act_id }), reload); box.hidden = false; busy(check, false); check.textContent = 'Hide'; }
      catch (e) { busy(check, false); toast(say(e), 'bad'); }
    };
    bar.append(check);
    b.append(bar, box);
  }
  return b;
}

// The rows one AI write added, changed (field by field) and removed, and Undo.
const TABLE_WORDS = {
  task: 'task', task_worker: 'who does a task', task_series: 'repeated task', sticky_trap: 'sticky trap',
  trap_reading: 'trap reading', scout_observation: 'plant photo', photo_note: 'photo comment', scout_note: 'scouting note',
  issue: 'issue or pest case', case_point: 'pest case point', ipm_program: 'treatment', ipm_application: 'treatment application',
  crop_plan: 'batch', crop: 'crop', growing_system: 'zone', growing_position: 'position', harvest: 'harvest',
  sales_order: 'sales order', sales_order_line: 'order line', order_delivery: 'delivery', customer: 'customer',
  purchase_request: 'purchase request', purchase_order: 'purchase order', item: 'stock item', stock_movement: 'stock movement',
  cost_entry: 'cost', asset: 'asset', maintenance_rule: 'maintenance rule', worker_responsibility: 'responsibility',
  farm_holiday: 'closed day', deleted_row: 'note for the phones that a row went', market_price: 'market price',
};
const tableWords = t => TABLE_WORDS[t] || String(t).replace(/_/g, ' ');
const QUIET = new Set(['id', 'farm_id', 'created_at', 'updated_at', 'updated_by', 'created_by']);

function showDetail(box, D, reload) {
  box.textContent = '';
  const a = D.act || {};
  const head = el('div', 'hint');
  head.append(`${actionWords(a.action)} · ${plural(a.changes ?? 0, 'row', 'rows')}` + (a.email ? ` · as ${a.email}` : ''));
  box.append(head);
  if (a.dropped) box.append(el('div', 'hint', 'Its rows were kept 90 days and are gone: it can no longer be checked or undone.'));
  (D.rows || []).forEach(r => {
    const line = el('div', 'team-ai-change team-ai-' + String(r.op).toLowerCase());
    const verb = r.op === 'INSERT' ? 'Added' : r.op === 'DELETE' ? 'Removed' : 'Changed';
    const row = r.after || r.before || {};
    const name = row.name || row.title || row.code || row.label || '';
    line.append(el('div', 'team-ai-change-head', `${verb} ${tableWords(r.table)}${name ? ' “' + short(name, 60) + '”' : ''}`));
    const fields = el('div', 'team-ai-fields');
    if (r.op === 'UPDATE') {
      (r.fields || []).filter(f => !QUIET.has(f)).forEach(f =>
        fields.append(el('div', null, `${f}: ${short(r.before?.[f])} → ${short(r.after?.[f])}`)));
    } else {
      Object.entries(row).filter(([k, v]) => v != null && v !== '' && !QUIET.has(k)).slice(0, 12)
        .forEach(([k, v]) => fields.append(el('div', null, `${k}: ${short(v)}`)));
    }
    line.append(fields);
    box.append(line);
  });
  if (a.reverted_at) {
    box.append(el('div', 'team-ai-undone', `Undone ${when(a.reverted_at)}${a.reverted_by ? ' by ' + a.reverted_by : ''}.`));
    return;
  }
  if ((D.conflicts || []).length) {
    const n = el('div', 'note bad');
    n.append(`Cannot be undone: ${plural(D.conflicts.length, 'row was', 'rows were')} changed since — `
      + D.conflicts.map(x => `${tableWords(x.table)} (${x.why})`).join('; '));
    box.append(n);
  }
  if (D.may_revert) {
    const undo = el('button', 'btn btn-sm btn-ghost team-danger', 'Undo');
    undo.type = 'button';
    undo.onclick = async () => {
      if (!await confirmDrawer('Undo this AI change?',
        'Every row it added is removed, and every row it changed or removed is put back as it was. It is refused if somebody changed one of them since. Things outside Naked Heart — a message sent, a file — are not undone.',
        'Undo', true)) return;
      busy(undo, true, 'Undoing…');
      try {
        const r = await rpc('mcp_revert', { p_act: a.id });
        toast(`Undone: ${plural(r.undone ?? 0, 'row', 'rows')} put back`, 'ok');
        await reload();
      } catch (e) { busy(undo, false); toast(say(e), 'bad'); }
    };
    box.append(undo);
  }
}
