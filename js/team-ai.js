// ═════════════════════════════════════════════════════════════════════
// Tasks › Team › AI access (migrations 0242–0244, console 0.7.264)
//
// Somebody of the team can connect their own Claude or ChatGPT to Naked Heart (the MCP) and have it
// READ the farm data their job allows. The same pattern as the task responsibilities above it:
//   * a fixed list of AI data families, as chips;
//   * per job the families its people get — a click gives a chip to, or takes it from, the whole job;
//     "Back to standard" puts the standard list back;
//   * per person the MCP tick, an end date, and their own chips: + = added beyond the job, struck
//     through = a job family taken away from them; a click changes that person only;
//   * Stop all, the address to send, and every question their AIs asked.
// Shown to whoever manages the people (the database decides: mcp_team's may_edit). Nothing changes
// on the farm through it: the AI reads, through views of its own, never the tables.
// ═════════════════════════════════════════════════════════════════════
import { rpc, URL_BASE } from './api.js';
import { el, toast, confirmDrawer, busy, loading, farmInstant, farmLocal, shortDate } from './ui.js';
import { roleLabel } from './people.js';

export const MCP_URL = URL_BASE + '/functions/v1/mcp';
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const say = e => String(e?.message || e).replace(/^\d+ /, '');

let open = false;          // the fold stays as it was while the page repaints

// The fold for the Team page; it reads only when opened.
export function aiCard(farm) {
  const fold = el('details', 'card card-pad team-ai');
  fold.open = open;
  fold.append(el('summary', 'sec-title', 'AI access — their own Claude or ChatGPT, read-only'));
  const inner = el('div', 'team-ai-in');
  fold.append(inner);
  const fill = () => { if (!inner.dataset.on) { inner.dataset.on = '1'; draw(inner, farm); } };
  fold.addEventListener('toggle', () => { open = fold.open; if (fold.open) fill(); });
  if (open) fill();
  return fold;
}

async function draw(mount, farm) {
  mount.textContent = '';
  mount.append(loading('Reading who has AI access…'));
  let T, calls = [];
  try {
    T = await rpc('mcp_team', { p_farm: farm.id });
    if (T.may_edit) calls = await rpc('mcp_call_log', { p_farm: farm.id, p_limit: 100 }).catch(() => []);
  } catch (e) {
    mount.textContent = '';
    mount.append(el('div', 'note bad', /mcp_team|schema cache/.test(say(e))
      ? 'AI access is not on this database yet.' : say(e)));
    return;
  }
  const again = () => draw(mount, farm);
  mount.textContent = '';
  mount.append(el('p', 'hint team-hint',
    'Tick MCP for somebody, choose what their AI may read, and send them the address below. Their AI reads only — '
    + 'it never changes anything — and only until the end date or until you untick them. An AI-only person is in the team '
    + 'only for this: never on the task pages, no hours, no login here.'));
  mount.append(jobs(T, farm, again), people(T, farm, again), connect(), asked(calls));
}

// ── what each job's AI may read ─────────────────────────────────────────────
function jobs(T, farm, again) {
  const box = el('div', 'team-ai-block');
  box.append(el('div', 'sec-title team-sec', 'What each job’s AI may read'));
  T.roles.forEach(r => {
    const row = el('div', 'team-ai-row');
    const who = el('div', 'team-ai-who');
    who.append(el('b', null, roleLabel(r.role)), el('small', null, r.own ? 'chosen for this farm' : 'standard'));
    if (r.own && T.may_edit) {
      const back = el('button', 'btn btn-sm btn-ghost', 'Back to standard');
      back.onclick = async () => {
        busy(back, true, 'Saving…');
        try { await rpc('mcp_reset_role', { p_farm: farm.id, p_role: r.role }); toast(`${roleLabel(r.role)}: the standard list again`, 'ok'); again(); }
        catch (e) { busy(back, false); toast(say(e), 'bad'); }
      };
      who.append(back);
    }
    const chips = el('div', 'resp-cats team-ai-chips');
    T.families.forEach(f => {
      const on = r.families.includes(f.code);
      const b = el('button', 'toggle', f.label);
      b.type = 'button';
      b.title = f.about;
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !T.may_edit;
      b.onclick = async () => {
        const next = on ? r.families.filter(c => c !== f.code) : [...r.families, f.code];
        b.disabled = true;
        try {
          await rpc('mcp_set_role', { p_farm: farm.id, p_role: r.role, p_families: next });
          toast(`${roleLabel(r.role)}: ${on ? f.label + ' taken off the job' : f.label + ' given to the job'}`, 'ok');
          again();
        } catch (e) { b.disabled = false; toast(say(e), 'bad'); }
      };
      chips.append(b);
    });
    row.append(who, chips);
    box.append(row);
  });
  return box;
}

// ── the people: the tick, the end date, their own chips ─────────────────────
function people(T, farm, again) {
  const box = el('div', 'team-ai-block');
  const head = el('div', 'row team-sec');
  head.append(el('div', 'sec-title', 'People'), el('div', 'spacer'));
  if (T.may_edit && T.people.some(p => p.ai_access)) {
    const stop = el('button', 'btn btn-sm btn-ghost team-danger', 'Stop all AI access');
    stop.onclick = async () => {
      if (!await confirmDrawer('Stop all AI access?',
        'Everybody of this farm and its sister units is unticked now, and their AIs are signed out. You can tick them again later.',
        'Stop all', true)) return;
      busy(stop, true, 'Stopping…');
      try { const n = await rpc('mcp_stop_all', { p_farm: farm.id }); toast(`AI access stopped for ${n} ${n === 1 ? 'person' : 'people'}`, 'ok'); again(); }
      catch (e) { busy(stop, false); toast(say(e), 'bad'); }
    };
    head.append(stop);
  }
  box.append(head);

  const active = T.people.filter(p => p.active);
  if (!active.length) box.append(el('div', 'hint', 'Nobody on the team yet.'));
  active.forEach(p => {
    const jobFams = (T.roles.find(r => r.role === p.role) || { families: [] }).families;
    const row = el('div', 'team-ai-row');
    const who = el('div', 'team-ai-who');
    who.append(el('b', null, [p.name, p.surname].filter(Boolean).join(' ')),
               el('small', null, roleLabel(p.role) + (p.email ? ' · ' + p.email : '')));
    if (p.in_force) who.append(el('span', 'team-ai-on', 'AI access on'));
    if (p.last_used) who.append(el('small', null, `asked ${when(p.last_used)} · ${p.calls_30d} in 30 days`
      + ((p.ai_names || []).length ? ' · ' + p.ai_names.join(', ') : '')));

    const right = el('div');
    const access = el('div', 'team-ai-access');
    const canTick = T.may_edit && (p.has_login || p.email);
    const lab = el('label', 'team-off');
    const tick = el('input'); tick.type = 'checkbox'; tick.checked = !!p.ai_access; tick.disabled = !canTick;
    lab.append(tick, 'MCP');
    lab.title = 'Ticked: their own Claude or ChatGPT may read what the chips say, until the end date.';
    const until = el('input', 'input team-ai-until');
    until.type = 'date';
    until.value = p.ai_until ? farmLocal(p.ai_until).slice(0, 10) : '';
    until.disabled = !T.may_edit || !p.ai_access;
    until.setAttribute('aria-label', `End of ${p.name}’s AI access`);
    const save = async () => {
      tick.disabled = true; until.disabled = true;
      try {
        await rpc('mcp_set_access', { p_worker: p.worker_id, p_on: tick.checked,
                                      p_until: tick.checked && until.value ? farmInstant(until.value + 'T23:59') : null });
        toast(tick.checked ? `${p.name}: AI access on` + (until.value ? ` until ${shortDate(until.value)}` : '') : `${p.name}: AI access off — signed out`, 'ok');
        again();
      } catch (e) { tick.checked = !!p.ai_access; tick.disabled = !canTick; until.disabled = !p.ai_access; toast(say(e), 'bad'); }
    };
    tick.onchange = async () => {
      if (!tick.checked && !await confirmDrawer(`Stop ${p.name}’s AI access?`, 'Their AI is signed out now and cannot ask again until you tick them.', 'Stop', true)) {
        tick.checked = true; return;
      }
      save();
    };
    until.onchange = save;
    access.append(lab, el('span', 'hint', 'until'), until, el('span', 'hint', p.ai_access && !until.value ? 'no end date: until unticked' : ''));
    if (T.may_edit && !canTick) access.append(el('span', 'hint', 'Give them an e-mail first (Edit): their AI signs in with it.'));
    right.append(access);

    const chips = el('div', 'resp-cats team-ai-chips' + (p.ai_access ? '' : ' team-ai-dim'));
    T.families.forEach(f => {
      const has = p.families.includes(f.code), fromJob = jobFams.includes(f.code);
      const b = el('button', 'toggle' + (has && !fromJob ? ' team-ai-added' : '') + (!has && fromJob ? ' team-ai-away' : ''), f.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(has));
      b.title = f.about + (has && !fromJob ? ' · added for this person' : !has && fromJob ? ' · the job gives it, taken away from this person' : fromJob ? ' · from the job' : '');
      b.disabled = !T.may_edit;
      b.onclick = async () => {
        if (!has && f.code === 'team' && !await confirmDrawer('Give the team’s personal data?',
          `${p.name}’s AI would read names, hours, clock-ins and the hourly cost of each person.`, 'Give it')) return;
        b.disabled = true;
        try {
          await rpc('mcp_person_family', { p_worker: p.worker_id, p_family: f.code, p_on: !has });
          toast(`${p.name}: ${f.label} ${has ? 'taken away' : 'given'}`, 'ok');
          again();
        } catch (e) { b.disabled = false; toast(say(e), 'bad'); }
      };
      chips.append(b);
    });
    right.append(chips);
    row.append(who, right);
    box.append(row);
  });
  const legend = el('div', 'resp-cats team-ai-legend');
  [['toggle', 'true', 'from the job'], ['toggle team-ai-added', 'true', 'added for this person'],
   ['toggle team-ai-away', 'false', 'taken away from this person'], ['toggle', 'false', 'not given']].forEach(([cls, on, t]) => {
    const s = el('span', cls, t); s.setAttribute('aria-pressed', on); legend.append(s);
  });
  box.append(legend);
  return box;
}

// ── how they connect ────────────────────────────────────────────────────────
function connect() {
  const box = el('div', 'team-ai-block');
  box.append(el('div', 'sec-title team-sec', 'How they connect'));
  box.append(el('p', 'hint', 'Send them this address. In Claude: Settings › Connectors › Add custom connector. '
    + 'In ChatGPT: a custom connector (MCP) in its settings, under developer mode. They sign in with the e-mail on their row here and press Allow.'));
  const line = el('div', 'row team-more');
  const code = el('code', 'team-ai-url', MCP_URL);
  const copy = el('button', 'btn btn-sm', 'Copy');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(MCP_URL); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }
    catch { toast('Select the address and copy it', 'bad'); }
  };
  line.append(code, copy);
  box.append(line);
  return box;
}

// ── what was asked ─────────────────────────────────────────────────────────
function asked(calls) {
  const box = el('div', 'team-ai-block');
  box.append(el('div', 'sec-title team-sec', 'What was asked'));
  if (!calls.length) { box.append(el('div', 'hint', 'Nothing yet.')); return box; }
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'people team-ai-log');
  const hr = el('tr');
  ['When', 'Who', 'AI', 'Asked', 'Rows'].forEach(h => hr.append(el('th', null, h)));
  const thead = el('thead'); thead.append(hr); t.append(thead);
  const tb = el('tbody');
  calls.forEach(c => {
    const tr = el('tr');
    const what = c.tool === 'query' ? c.args?.sql : c.tool === 'photo' ? `photo ${c.args?.kind} ${c.args?.id}` : c.tool;
    const q = el('td');
    q.append(el('div', 'team-ai-sql', what || ''));
    if (!c.ok) q.append(el('div', 'team-over', c.error || 'refused'));
    tr.append(el('td', 'hint', when(c.at)), el('td', null, c.email || ''), el('td', null, c.client_name || ''), q, el('td', null, c.rows ?? ''));
    tb.append(tr);
  });
  t.append(tb);
  wrap.append(t);
  box.append(wrap);
  return box;
}
