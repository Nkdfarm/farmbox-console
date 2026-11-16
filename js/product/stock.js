// The product drawer's store block: stock, lots, add and count (split from product.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, toast, busy, input, field, selectBox, table } from '../ui.js';
import { UNIT_CHOICES, packFactor, day, qtyText, n2, errText, expiryPill, PACK } from './fields.js';

// ── the store ──
export function stockBlock(ctx, pr) {
  const { farm, p, took } = ctx;
  const w = el('section', 'lb-sec lb-stock');
  const unit = pr.unit;
  const head = el('div', 'lb-head');
  head.append(el('div', 'pd-hlabel', 'In the store'), el('b', 'lb-oh', qtyText(Number(pr.on_hand || 0), unit)));
  const soon = (ctx.det.lots || []).map(l => l.expires_on).filter(Boolean).sort()[0];
  if (soon) head.append(expiryPill(soon));
  w.append(head);
  if ((ctx.det.lots || []).length) {
    w.append(table([
      { key: 'at', label: 'Received', fmt: v => day(v) },
      { key: 'packs', label: 'Pack', fmt: (v, r) => v ? `${n2(v)} × ${n2(r.pack_size)} ${r.pack_unit || ''}${r.pack_format ? ' ' + r.pack_format : ''}` : '—' },
      { key: 'lot', label: 'Lot' },
      { key: 'expires_on', label: 'Expiry', fmt: v => v ? expiryPill(v) : '—' },
      { key: 'left', label: 'Still here', align: 'right', fmt: v => qtyText(Number(v), unit) },
    ], ctx.det.lots));
    w.append(el('div', 'hint', 'What was received last is counted as what is left (first in, first out).'));
  }
  if (ctx.det.may_label) {
    const f = el('div', 'tr-form lb-stockform');
    const packs = input({ type: 'number', min: 1, step: 'any', value: 1 });
    const choices = UNIT_CHOICES[unit] || [[unit, unit]];
    const first = (pr.pack_sizes || [])[0] || '';
    const m = /([\d.,]+)\s*(ml|l|g|kg)\b/i.exec(first);
    const size = input({ type: 'number', min: 0, step: 'any', value: m ? m[1].replace(',', '.') : '' });
    const pu = selectBox(choices, m ? (choices.find(c => c[0].toLowerCase() === m[2].toLowerCase())?.[0] ?? choices[0][0]) : choices[0][0]);
    const fmt = selectBox([['', '—'], ...PACK], 'bottle');
    const lot = input({ placeholder: 'as printed' });
    const exp = input({ type: 'date' });
    const note = input({ placeholder: 'invoice, supplier…' });
    f.append(field('Packs', packs), field('One pack holds', size, (pr.pack_sizes || []).length ? 'Label: ' + pr.pack_sizes.join(', ') : null), field('Unit', pu),
      field('Pack', fmt), field('Lot', lot), field('Expiry', exp), field('Note', note));
    const add = el('button', 'btn btn-primary btn-sm', 'Add to stock');
    add.onclick = async () => {
      busy(add, true, 'Adding…');
      try {
        took(await rpc('add_product_stock', { p_farm: farm.id, p_product: p.id, p: { packs: packs.value, pack_size: size.value, pack_unit: pu.value,
          pack_format: fmt.value, lot: lot.value, expires_on: exp.value || null, note: note.value } }));
        toast('Added to the stock', 'ok');
      } catch (e) { busy(add, false); toast(errText(e), 'bad'); }
    };
    const cnt = input({ type: 'number', min: 0, step: 'any', placeholder: unit });
    const why = input({ placeholder: 'why (optional)' });
    const fix = el('button', 'btn btn-sm', 'Correct the count');
    fix.title = 'After counting the store: what is really there, in ' + unit;
    fix.onclick = async () => {
      if (cnt.value.trim() === '' || !(Number(cnt.value) >= 0)) { toast('What does the store hold, in ' + unit + '? A number, 0 or more.', 'bad'); return; }
      busy(fix, true, 'Saving…');
      try { took(await rpc('count_product_stock', { p_farm: farm.id, p_product: p.id, p_on_hand: Number(cnt.value), p_note: why.value || null })); toast('Count corrected', 'ok'); }
      catch (e) { busy(fix, false); toast(errText(e), 'bad'); }
    };
    const total = el('div', 'hint');
    const sum = () => {
      const k = packFactor(pu.value, unit);
      const q = Number(packs.value) * Number(size.value) * k;
      total.textContent = q > 0 ? `= ${qtyText(q, unit)} into the store` : '';
    };
    [packs, size, pu].forEach(x => { x.oninput = x.onchange = sum; }); sum();
    const a1 = el('div', 'row lb-acts'); a1.append(total, el('span', 'spacer'), add);
    const a2 = el('div', 'row lb-acts'); a2.append(field('Counted, ' + unit, cnt), field('Why', why), el('span', 'spacer'), fix);
    w.append(el('div', 'pd-hlabel', 'Add stock'), f, a1, el('div', 'pd-hlabel', 'After a count'), a2);
    w.append(el('div', 'hint', 'Office › Stock shows the same movements: one line for this product, whatever the pack.'));
  }
  return w;
}
