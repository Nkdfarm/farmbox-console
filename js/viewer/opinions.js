// Asking the team for an opinion on a photo, and the list of photos waiting for mine (split from viewer.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, drawer, toast, busy, confirmDrawer, once, avatar } from '../ui.js';
import { day, whoAmI, signedUrl, errWord, riskSelect } from './parts.js';

export async function askOpinion(photo, kind, ctx, question = '') {
  const d = drawer('Ask for an opinion', 'They find this photo with all its data in their list, in Naked Brain and Naked Heart');
  d.body.append(el('div', 'hint', 'Reading the team…'));
  let people = [];
  try { people = await rpc('dg_people', { p_farm: ctx.farm.id }); } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', errWord(e))); return; }
  const mine = await whoAmI();
  d.body.textContent = '';
  const box = el('div', 'vw-ask-people');
  const picks = new Set();
  people.filter(x => x.user_id !== mine).forEach(x => {
    const lab = el('label', 'vw-ask-person'); const cb = el('input'); cb.type = 'checkbox';
    cb.onchange = () => { if (cb.checked) picks.add(x.user_id); else picks.delete(x.user_id); };
    lab.append(cb, avatar({ worker_id: x.worker_id || null, name: x.name }, 'xs'), el('span', null, x.name));
    box.append(lab);
  });
  const q = el('textarea', 'vw-note-box'); q.rows = 3; q.maxLength = 1000; q.placeholder = 'Your question (optional)'; q.value = question || '';
  const go = el('button', 'btn btn-primary', 'Send');
  go.onclick = async () => {
    if (!picks.size) { toast('Choose at least one person', 'bad'); return; }
    busy(go, true, 'Sending…');
    try {
      const r = await rpc('dg_ask_opinion', { p: { kind, ref_id: photo.id, to: [...picks], question: q.value } });
      toast(r.asked ? `Asked ${r.asked} ${r.asked === 1 ? 'person' : 'people'}` : 'Already asked', 'ok'); d.close();
    } catch (e) { busy(go, false, 'Send'); toast(errWord(e), 'bad'); }
  };
  d.body.append(box, q, go);
}

// the photos waiting for my opinion, with an answer box (0.7.269): opened from the Scouting page
export async function openOpinions(farm, onChange) {
  const d = drawer('Asked for your opinion', 'Photos the team sent you, newest first');
  const paint = async () => {
    d.body.textContent = ''; d.body.append(el('div', 'hint', 'Reading…'));
    let rows = [];
    try { rows = await rpc('dg_my_requests', { p_farm: farm.id }); } catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', errWord(e))); return; }
    d.body.textContent = '';
    if (!rows.length) { d.body.append(el('div', 'hint', 'Nothing waiting for your opinion.')); return; }
    rows.forEach(q => {
      const card = el('div', 'vw-req');
      const ph = q.photo || {};
      const img = el('img', 'vw-req-img'); img.alt = '';
      if (ph.photo_path) signedUrl(ph.photo_path).then(u => { if (u) { img.src = u; img.onclick = () => window.open(u, '_blank', 'noopener'); } });
      const info = el('div', 'vw-req-info');
      info.append(el('b', null, [q.kind === 'trap' ? `Trap ${ph.trap || ''}${ph.side ? ' (' + ph.side + ')' : ''}` : 'Plant photo', ph.zone, ph.taken_at ? day(ph.taken_at) : null].filter(Boolean).join(' · ')),
                  el('div', 'hint', `From ${q.by || 'somebody'} · ${day(q.at)}`));
      if (q.question) info.append(el('div', null, '"' + q.question + '"'));
      if (ph.note) info.append(el('div', 'hint', 'Note: ' + ph.note));
      const ta = el('textarea', 'vw-note-box'); ta.rows = 2; ta.placeholder = 'Your opinion';
      const risk = riskSelect();
      const ans = el('button', 'btn btn-sm btn-primary', 'Answer');
      const cref = 'hc:' + crypto.randomUUID();
      ans.onclick = async () => {
        if (!ta.value.trim()) { toast('Write your opinion first', 'bad'); return; }
        busy(ans, true, 'Sending…');
        try {
          await rpc('dg_add_note', { p: { kind: q.kind, ref_id: q.ref_id, body: ta.value, level: risk.value, request_id: q.id, client_ref: cref } });
          toast('Answer added to the photo', 'ok'); onChange?.(); paint();
        } catch (e) { busy(ans, false, 'Answer'); toast(errWord(e), 'bad'); }
      };
      const dis = el('button', 'btn btn-sm', 'Dismiss');
      dis.onclick = async () => {
        if (!await confirmDrawer('Dismiss this request?', 'The question is closed without an answer.', 'Dismiss it', true)) return;
        await once(dis, async () => { try { await rpc('dg_dismiss_request', { p_id: q.id }); paint(); onChange?.(); } catch (e) { toast(errWord(e), 'bad'); } });
      };
      const acts = el('div', 'vw-note-acts'); acts.append(risk, ans, dis);
      info.append(ta, acts);
      card.append(img, info);
      d.body.append(card);
    });
  };
  paint();
}
