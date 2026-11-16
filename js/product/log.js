// The change logs: one line of a log (logLine) and the log of the whole catalogue (split from product.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, drawer, input, selectBox, loading } from '../ui.js';
import { FIELD, ACTION, when, day, show, qtyText, n2, errText } from './fields.js';

// one line of a log: dd/mm/yyyy hh:mm · what · who
export function logLine(h, unit, onUndo) {
  const li = el('li', 'lb-line' + (h.undone_at ? ' lb-undone' : ''));
  li.append(el('span', 'lb-when', when(h.at)));
  const what = el('span', 'lb-what');
  if (h.kind === 'stock') {
    const q = Number(h.qty);
    const why = { receipt: 'Received', consumption: 'Used', adjustment: 'Count corrected', waste: 'Thrown away', opening: 'Opening stock' }[h.reason] || h.reason;
    what.append(el('b', null, `${why} ${q > 0 ? '+' : ''}${qtyText(q, unit)}`));
    const bits = [h.packs ? `${n2(h.packs)} × ${n2(h.pack_size)} ${h.pack_unit || ''}${h.pack_format ? ' ' + h.pack_format : ''}` : null,
      h.lot ? 'lot ' + h.lot : null, h.expires_on ? 'expires ' + day(h.expires_on) : null, h.note, h.farm ? 'at ' + h.farm : null].filter(Boolean);
    if (bits.length) what.append(' · ' + bits.join(' · '));
  } else {
    const name = h.field ? (FIELD[h.field] || h.field) : null;
    what.append(el('b', null, (ACTION[h.action] || h.action) + (name ? ': ' + name : '')));
    if (h.action === 'ai_read' && h.field) what.append(` — ${show(h.old)} → `, el('mark', null, show(h.ai)));
    if (h.action === 'ai_read' && !h.field) what.append(' the label photos');
    else if (['accepted', 'modified', 'edited', 'undone'].includes(h.action) && h.field) what.append(` — ${show(h.old)} → ${show(h.new)}`);
    if (h.action === 'modified' && h.ai != null) what.append(el('span', 'hint', ` (the AI had read ${show(h.ai)})`));
    if (h.action === 'rejected') what.append(` — kept ${show(h.old)}, the AI read ${show(h.ai)}`);
    if (h.model) what.append(el('span', 'hint', ` · ${h.model}`));
    if (h.note) what.append(el('span', 'hint', ` · “${h.note}”`));
    if (h.undone_at) what.append(el('span', 'hint', ` · undone by ${h.undone_by || '?'} on ${when(h.undone_at)}`));
    if (h.farm) what.append(el('span', 'hint', ` · at ${h.farm}`));
    if (!h.farm && h.action === 'edited') what.append(el('span', 'hint', ' · in the catalogue, for every farm'));
  }
  li.append(what, el('span', 'lb-who', h.action === 'ai_read' ? `AI · asked by ${h.by || '?'}` : h.by || ''));
  if (h.may_undo && onUndo) { const u = el('button', 'btn btn-sm btn-ghost', 'Undo'); u.onclick = () => onUndo(u); li.append(u); }
  return li;
}

// ── the whole catalogue's log ──
export async function openChangeLog(farm, onOpen) {
  const d = drawer('Change log of the products', 'Every reading of the AI, every validation and change, with who and when');
  d.box.classList.add('tr-drawer');
  const x = el('button', 'btn', 'Close'); x.onclick = d.close; d.footer.append(x);
  d.body.append(loading('Reading the log…'));
  let rows;
  try { rows = await rpc('product_changes', { p_farm: farm.id, p_limit: 1000 }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', errText(e))); return; }
  d.body.textContent = '';
  const kinds = selectBox([['', 'Everything'], ['ai', 'Read by the AI'], ['people', 'Validated or changed by a person'], ['photo', 'Photos']], '');
  const who = selectBox([['', 'Anybody'], ...[...new Set(rows.map(r => r.by).filter(Boolean))].sort().map(n => [n, n])], '');
  const q = input({ type: 'search', placeholder: 'product' });
  const bar = el('div', 'tr-filters');
  [['Show', kinds], ['Who', who], ['Search', q]].forEach(([l, n]) => { const f = el('label', 'tr-filter'); f.append(el('span', 'hint', l), n); bar.append(f); });
  const list = el('ol', 'lb-log');
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const shown = rows.filter(r => (!who.value || r.by === who.value) && (!s || (r.product + ' ' + r.supplier).toLowerCase().includes(s))
      && (!kinds.value || (kinds.value === 'ai' ? r.action === 'ai_read' : kinds.value === 'photo' ? r.action.startsWith('photo') : r.action !== 'ai_read' && !r.action.startsWith('photo'))));
    list.textContent = '';
    shown.forEach(r => {
      const li = logLine(r, null, null);
      const pn = el('a', 'lb-prod', r.product); pn.href = '#';
      pn.onclick = e => { e.preventDefault(); d.close(); onOpen?.(r.product_id); };
      li.insertBefore(pn, li.children[1]);
      list.append(li);
    });
    if (!shown.length) list.append(el('li', 'hint', 'Nothing in the log for this choice.'));
  };
  kinds.onchange = who.onchange = draw; q.oninput = draw;
  d.body.append(bar, list);
  draw();
}
