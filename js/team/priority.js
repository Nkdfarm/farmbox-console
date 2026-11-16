// Team page: the windows for one family's order and for all of them
import { rpc } from '../api.js';
import { loading, el, field, selectBox, toast, drawer, confirmDrawer, avatar, busy, subFamilyTag, emptyState } from '../ui.js';
import { paint, profile, reload } from './index.js';
import { S, first, keyLabel, roleLabel, sameKey } from './state.js';
import { orderLine, sameOrder } from './table.js';

// ── one family: who is asked first ──────────────────────────────────────────
export function openKey(p, r) {
  const label = keyLabel(r);
  const key = (S.T.keys || []).find(k => sameKey(k, r));
  const order = key?.order || [];
  const d = drawer(label, 'Who is asked first. Number 1 takes the work until their day is full, then number 2.');
  let subject = p.worker_id;
  const body = el('div');
  d.body.append(body);

  const send = async (n, mode, btn) => {
    if (btn) busy(btn, true, 'Saving…');
    try {
      const res = await rpc('team_set_priority', { p_worker: subject, p_family: r.family, p_category: r.category || null, p_n: n, p_mode: mode });
      if (res?.conflict) return res;
      d.close();
      toast(`${label}: ` + (res.order || []).map(o => `${o.priority} ${first(o.name)}`).join(' · '), 'ok');
      await reload();
      return null;
    } catch (e) { if (btn) busy(btn, false); toast(e.message, 'bad'); return null; }
  };

  const draw = () => {
    body.textContent = '';
    const list = el('div', 'team-order');
    order.forEach(o => {
      const row = el('button', 'team-orow');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(o.worker_id === subject));
      const txt = el('span', 'team-oname');
      txt.append(el('b', null, o.name), el('small', null, roleLabel(o.role)
        + (o.employment === 'casual' ? ' · on demand' : '') + (o.fixed ? ' · set by hand' : '')));
      row.append(el('span', 'team-on', String(o.priority ?? '–')), avatar({ ...o, photo_url: profile(o.worker_id)?.photo_url }, 'sm'), txt);
      row.onclick = () => { subject = o.worker_id; draw(); };
      list.append(row);
    });
    body.append(list);
    if (order.some(o => o.employment === 'casual')) body.append(el('div', 'hint team-hint',
      'Somebody on demand is asked only after the standing team, whatever their number — calling them in is your decision.'));

    const me = order.find(o => o.worker_id === subject);
    if (!me) return;
    const out = el('div', 'team-conflict');
    const sel = selectBox(order.map((_, i) => [String(i + 1), String(i + 1)]), String(me.priority));
    sel.disabled = order.length < 2;
    sel.onchange = async () => {
      out.textContent = '';
      const n = Number(sel.value);
      if (n === me.priority) return;
      out.append(loading('Checking…'));
      const res = await send(n, null);
      out.textContent = '';
      if (res?.conflict) conflict(out, res, n, me);
      else if (res === null && document.body.contains(sel)) sel.value = String(me.priority);
    };
    body.append(field(`${me.name}’s number for ${label}`, sel,
      order.length < 2 ? 'Nobody else is responsible for it.' : 'Choose a number; you are shown who holds it before anything changes.'));
    body.append(out);

    const more = el('div', 'row team-more');
    if (me.fixed) {
      const back = el('button', 'btn btn-sm', 'Back to the job’s order');
      back.title = 'Take the hand-set number off: the place in the job decides again';
      back.onclick = () => send(null, null, back);
      more.append(back);
    }
    const off = el('button', 'btn btn-sm btn-ghost team-danger', `Take ${label} off ${first(me.name)}`);
    off.onclick = async () => {
      if (!await confirmDrawer(`Take ${label} off ${me.name}?`,
        `${me.name} is no longer responsible for ${label}` + (me.manual ? '.' : ', although the job covers it — it stays off for them until added again.')
        + ' The others move up.', 'Remove', true)) return;
      try {
        await rpc('team_remove', { p_worker: me.worker_id, p_family: r.family, p_category: r.category || null });
        d.close(); toast(`${label} taken off ${me.name}`, 'ok'); await reload();
      } catch (e) { toast(e.message, 'bad'); }
    };
    more.append(off);
    body.append(more);
  };

  // the number is somebody's: who, and the two ways out
  const conflict = (out, res, n, me) => {
    const box = el('div', 'note warn team-ask');
    box.append(el('b', null, `${res.holder.name} holds ${label} ${n}.`));
    const same = sameOrder(res.swap, res.insert);
    let mode = 'swap';
    const opts = el('div', 'team-opts');
    const opt = (v, title, list) => {
      const l = el('label', 'team-opt');
      const rb = el('input'); rb.type = 'radio'; rb.name = 'team-mode'; rb.checked = v === mode;
      rb.onchange = () => { mode = v; };
      const t = el('span');
      t.append(el('b', null, title), el('br'), orderLine(list, res.before));
      l.append(rb, t);
      opts.append(l);
    };
    if (same) {
      box.append(el('div', null, `${first(res.holder.name)} becomes ${me.priority}:`), orderLine(res.swap, res.before));
    } else {
      opt('swap', `Swap — ${first(res.holder.name)} takes ${first(me.name)}’s ${me.priority}`, res.swap);
      opt('insert', `Insert — ${first(me.name)} takes ${n}, the others move down one`, res.insert);
      box.append(opts);
    }
    const go = el('button', 'btn btn-primary btn-sm', 'Apply');
    go.onclick = () => send(n, mode, go);
    const no = el('button', 'btn btn-sm', 'Leave it');
    no.onclick = () => draw();
    const row = el('div', 'row team-more'); row.append(go, no);
    box.append(row);
    out.append(box);
  };

  draw();
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

// ── the place in the job: every family the job covers follows — shown first ─
export function openGlobal(p, n) {
  let applied = false;
  const d = drawer(`${p.name} — place ${n} among the ${roleLabel(p.role)}s`,
    'The place in the job orders every family the job covers. Nothing changes until you apply.',
    { onClose: () => { if (!applied) paint(); } });
  let mode = 'swap', res = null;
  const follow = new Set();            // families where the hand-set numbers give way
  const kid = k => k.family + '|' + (k.category || '');
  const body = el('div');
  d.body.append(body);
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Apply');
  go.disabled = true;
  d.footer.append(cancel, el('div', 'spacer'), go);

  const read = async () => {
    body.textContent = ''; body.append(loading('Working out what changes…'));
    go.disabled = true;
    try {
      res = await rpc('team_set_global', { p_worker: p.worker_id, p_n: n, p_mode: mode, p_take: [], p_preview: true });
      draw();
      go.disabled = false;
    } catch (e) { body.textContent = ''; body.append(el('div', 'note bad', e.message)); }
  };

  const draw = () => {
    body.textContent = '';
    const job = el('div', 'team-block');
    job.append(el('div', 'sec-title', `The ${roleLabel(p.role)}s`));
    job.append(el('div', 'team-ba', null));
    const ba = job.lastChild;
    ba.append(el('span', 'hint', 'now '), orderLine(res.job_before), el('br'), el('span', 'hint', 'then '), orderLine(res.job_after, res.job_before));
    body.append(job);

    if (res.holder && (res.job_before || []).length > 2) {
      const opts = el('div', 'team-opts');
      [['swap', `Swap with ${res.holder.name}`], ['insert', 'Insert — the others move down one']].forEach(([v, title]) => {
        const l = el('label', 'team-opt');
        const rb = el('input'); rb.type = 'radio'; rb.name = 'team-gmode'; rb.checked = v === mode;
        rb.onchange = () => { mode = v; follow.clear(); read(); };
        l.append(rb, el('span', null, title));
        opts.append(l);
      });
      body.append(opts);
    }

    const keys = res.keys || [];
    const choices = keys.filter(k => k.choice);
    body.append(el('div', 'sec-title team-sec', keys.length ? `Family by family · ${keys.length}` : 'Family by family'));
    if (!keys.length) body.append(emptyState('No family changes its order: each is held by one of them, or the others come before by their job.'));
    if (choices.length) {
      const note = el('div', 'note warn team-ask');
      note.append(document.createTextNode(`${choices.length === 1 ? 'One family has' : choices.length + ' families have'} numbers set by hand that the new order would not give. ` +
        'They are kept unless you hand the family back to the job’s order.'));
      const allb = el('button', 'btn btn-sm', follow.size === choices.length ? 'Keep them all' : 'Follow the new order everywhere');
      allb.onclick = () => { if (follow.size === choices.length) follow.clear(); else choices.forEach(k => follow.add(kid(k))); draw(); };
      const row = el('div', 'row team-more'); row.append(allb); note.append(row);
      body.append(note);
    }
    keys.forEach(k => {
      const b = el('div', 'team-key');
      const head = el('div', 'team-keyhead');
      head.append(k.category ? subFamilyTag(k.category, 'chip') : el('span', 'chip fam-' + k.family, 'All ' + k.family));
      b.append(head);
      const after = follow.has(kid(k)) ? k.follow : k.keep;
      const same = sameOrder(k.before, after);
      const line = el('div', 'team-ba');
      line.append(el('span', 'hint', 'now '), orderLine(k.before));
      if (same) line.append(el('span', 'hint', '  ·  stays as it is'));
      else line.append(el('br'), el('span', 'hint', 'then '), orderLine(after, k.before));
      b.append(line);
      if (k.choice) {
        const pins = (k.pins || []).map(o => `${first(o.name)} ${o.priority}`).join(', ');
        const sw = el('div', 'seg team-seg');
        [[false, 'Keep the hand-set numbers'], [true, 'Follow the new order']].forEach(([v, title]) => {
          const x = el('button', 'seg-btn', title);
          x.type = 'button';
          x.setAttribute('aria-pressed', String(follow.has(kid(k)) === v));
          x.onclick = () => { if (v) follow.add(kid(k)); else follow.delete(kid(k)); draw(); };
          sw.append(x);
        });
        b.append(el('div', 'hint', pins ? `Set by hand: ${pins}` : 'Numbers set by hand'), sw);
      }
      body.append(b);
    });
  };

  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      const take = (res.keys || []).filter(k => follow.has(kid(k))).map(k => ({ family: k.family, category: k.category || '' }));
      await rpc('team_set_global', { p_worker: p.worker_id, p_n: n, p_mode: mode, p_take: take, p_preview: false });
      applied = true;
      d.close();
      toast(`${p.name} is ${n} among the ${roleLabel(p.role)}s`, 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Apply'); toast(e.message, 'bad'); }
  };
  read();
}
