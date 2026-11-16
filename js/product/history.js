// The product drawer's history block, with Undo (split from product.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, toast, busy, confirmDrawer } from '../ui.js';
import { FIELD, show, errText } from './fields.js';
import { logLine } from './log.js';

export function historyBlock(ctx) {
  const { farm, took } = ctx;
  const w = el('section', 'lb-sec lb-history');
  w.append(el('div', 'pd-hlabel', 'History'));
  const unit = ctx.det.product.unit;
  if (!ctx.det.history.length) { w.append(el('div', 'hint', 'Nothing changed on this product yet.')); return w; }
  const list = el('ol', 'lb-log');
  ctx.det.history.slice(0, 60).forEach(h => list.append(logLine(h, unit, async btn => {
    if (!await confirmDrawer('Undo this change?', `${FIELD[h.field] || h.field} goes back to ${show(h.old)}. If the product was validated against the label it stays so, now in your name.`, 'Undo')) return;
    busy(btn, true, 'Undoing…');
    try { took(await rpc('undo_product_change', { p_farm: farm.id, p_change: h.id })); toast('Undone', 'ok'); }
    catch (e) { busy(btn, false); toast(errText(e), 'bad'); }
  })));
  w.append(list);
  if (ctx.det.history.length > 60) w.append(el('div', 'hint', `The 60 latest of ${ctx.det.history.length}.`));
  return w;
}
