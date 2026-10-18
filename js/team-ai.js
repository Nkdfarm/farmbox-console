// ═════════════════════════════════════════════════════════════════════
// AI access on the Team page (migrations 0242–0245, console 0.7.264–0.7.265)
//
// Somebody of the team can connect their own Claude or ChatGPT to Naked Heart (the MCP) and have it
// READ the farm data that is ticked for them. Since 0.7.265 it is set where the rest of a person is set:
//   * a person's Edit window has a section "AI access": the tick, an end date, what it may read (chips,
//     starting from what their job gives), the address to send them and what their AI asked;
//   * a job's Change… window has "Their own AI may read": the chips everybody of the job starts from;
//   * the page itself keeps one line: who has AI access, What was asked, Stop all.
// Everything is saved with the window's own Save. The database decides who may (mcp_team's may_edit).
// ═════════════════════════════════════════════════════════════════════
import { rpc, URL_BASE } from './api.js';
import { el, toast, confirmDrawer, drawer, busy, farmInstant, farmLocal } from './ui.js';

export const MCP_URL = URL_BASE + '/functions/v1/mcp';
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const say = e => String(e?.message || e).replace(/^\d+ /, '');
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

// The chips of the data families, on and off; returns the node and the chosen set.
function familyChips(AI, chosen, onChange) {
  const box = el('div', 'resp-cats team-ai-chips');
  const draw = () => {
    box.textContent = '';
    AI.families.forEach(f => {
      const b = el('button', 'toggle', f.label);
      b.type = 'button';
      b.title = f.about;
      b.setAttribute('aria-pressed', String(chosen.has(f.code)));
      b.onclick = () => { chosen.has(f.code) ? chosen.delete(f.code) : chosen.add(f.code); draw(); onChange?.(); };
      box.append(b);
    });
  };
  draw();
  return { node: box, redraw: draw };
}

const jobFamilies = (AI, role) => (AI.roles.find(r => r.role === role) || { families: [] }).families;

// ── a person's Edit window ──────────────────────────────────────────────────
// p: the person (null for a new one); role: the job select of the form; email: its e-mail field.
// Returns { node, check(), save(workerId) } — save runs after the person is saved.
export function personAiSection(AI, p, role, email) {
  const me = p ? AI.people.find(x => x.worker_id === p.worker_id) : null;
  const start = new Set(me ? me.families : jobFamilies(AI, role.value));
  const chosen = new Set(start);
  let touched = false;

  const wrap = el('div');
  wrap.append(el('div', 'sec-title', 'AI access'));
  const lab = el('label', 'team-off team-ai-tick');
  const tick = el('input'); tick.type = 'checkbox'; tick.checked = !!me?.ai_access;
  lab.append(tick, 'Their own Claude or ChatGPT may read this farm’s data');
  wrap.append(lab);

  const more = el('div', 'team-ai-more');
  const until = el('input', 'input team-ai-until');
  until.type = 'date';
  until.value = me?.ai_until ? farmLocal(me.ai_until).slice(0, 10) : '';
  until.min = farmLocal(new Date().toISOString()).slice(0, 10);
  const untilRow = el('div', 'team-ai-access');
  untilRow.append(el('span', null, 'Until'), until, el('span', 'hint', 'empty: until you untick'));
  const chips = familyChips(AI, chosen, () => { touched = true; });
  const url = el('div', 'row team-more');
  const code = el('code', 'team-ai-url', MCP_URL);
  const copy = el('button', 'btn btn-sm', 'Copy');
  copy.type = 'button';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(MCP_URL); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }
    catch { toast('Select the address and copy it', 'bad'); }
  };
  url.append(code, copy);
  more.append(untilRow,
    el('div', 'hint team-ai-say', 'What it may read — it never changes anything:'), chips.node,
    el('div', 'hint team-ai-say', 'Send them this address. They add it in Claude (Settings › Connectors › Add custom connector) or ChatGPT, sign in with their e-mail here and press Allow.'),
    url);
  if (me?.last_used) {
    const used = el('div', 'hint team-ai-say');
    used.append(`Asked ${me.calls_30d} time${me.calls_30d === 1 ? '' : 's'} in 30 days, last ${when(me.last_used)}`
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
    if (touched) return;
    chosen.clear(); jobFamilies(AI, role.value).forEach(c => chosen.add(c)); chips.redraw();
  });

  const firstUntil = until.value;
  const untilIso = () => (tick.checked && until.value ? farmInstant(until.value + 'T23:59') : null);
  const changed = () => !!me?.ai_access !== tick.checked
    || (tick.checked && (until.value !== firstUntil || !sameSet(chosen, start)));

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
  const start = new Set(r.families), chosen = new Set(start);
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
        chips.redraw(); back.remove(); toast('Back to the standard list', 'ok');
      } catch (e) { busy(back, false); toast(say(e), 'bad'); }
    };
    head.append(back);
  }
  wrap.append(head, el('div', 'hint', 'For those of this job whose AI access is ticked (in their Edit window). A change here reaches all of them; what was changed for one person stays.'));
  const chips = familyChips(AI, chosen);
  wrap.append(chips.node);
  return {
    node: wrap,
    async save() {
      if (sameSet(chosen, start)) return false;
      await rpc('mcp_set_role', { p_farm: AI.farm_id, p_role: roleName, p_families: [...chosen] });
      return true;
    },
  };
}

// ── the Team page's line ────────────────────────────────────────────────────
export function aiLine(AI, done) {
  const on = AI.people.filter(p => p.in_force);
  const c = el('div', 'card card-pad team-ai-line');
  const row = el('div', 'row');
  const text = el('div');
  text.append(el('b', null, 'AI access '), el('span', 'hint', on.length
    ? `${on.map(p => p.name).join(', ')} can connect their own Claude or ChatGPT, read-only.`
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
  calls.forEach(c => {
    const b = el('div', 'team-ai-call');
    const what = c.tool === 'query' ? c.args?.sql : c.tool === 'photo' ? `photo ${c.args?.kind} ${c.args?.id}` : c.tool === 'describe' ? 'what can I see?' : c.tool;
    b.append(el('div', 'hint', [when(c.at), person ? null : c.email, c.client_name, c.rows != null ? `${c.rows} rows` : null].filter(Boolean).join(' · ')),
             el('div', 'team-ai-sql', what || ''));
    if (!c.ok) b.append(el('div', 'team-over', c.error || 'refused'));
    d.body.append(b);
  });
}
