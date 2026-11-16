// The product drawer's review block: the AI's reading of the label, or the product by hand (split from product.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, toast, busy, input, field, selectBox, confirmDrawer, once } from '../ui.js';
import { KIND } from '../kinds.js';
import { kindBox, FIELD, when, show, errText, marked } from './fields.js';

// ── the review: the AI's reading (check) or the product by hand (check null) ──
export function reviewBlock(ctx, check) {
  const { farm, p, took } = ctx;
  const w = el('section', 'lb-sec lb-review');
  const safety = new Set(ctx.det.safety);
  const cur = f => ctx.det.product[f];
  const ai = new Map((check?.fields || []).map(x => [x.field, x]));
  w.append(el('div', 'pd-hlabel', check ? `The AI read the label · ${when(check.at)} · asked by ${check.by || '?'}` : 'Correct by hand, against the label'));
  if (check?.summary) w.append(el('div', 'note', check.summary));
  if (!ctx.det.may_label) { w.append(el('div', 'hint', 'Waiting for the Admin, the Farm manager, the Office or the Agronomist to validate it.')); }
  const rows = [];
  const grid = el('div', 'lb-grid');
  grid.append(el('div', 'lb-gh', 'Field'), el('div', 'lb-gh', 'Now'), el('div', 'lb-gh', check ? 'Label says' : ''), el('div', 'lb-gh', 'Keep'), el('div', 'lb-gh', ''));
  ctx.det.fields.forEach(f => {
    const a = ai.get(f);
    if (check && !a) return;
    const differs = check ? !!a.differs : false;
    const readable = check ? !!a.readable : true;
    const start = check && readable ? a.value : cur(f);
    let box;
    if (f === 'kind') {
      const k = String(start ?? 'chemical').trim().toLowerCase();
      box = kindBox(k, KIND[k] ? [] : [[k, k + ' (not a kind: choose one)']]);
    }
    else if (f === 'rate_unit') box = selectBox([['', '—'], ['ml', 'ml'], ['g', 'g'], ['kg', 'kg'], ['individuals', 'individuals'], ['units', 'units']], start ?? '');
    else if (f === 'rate_per') box = selectBox([['', '—'], ['m2', 'per m²'], ['ha', 'per ha'], ['100L', 'per 100 L'], ['L', 'per L'], ['plant', 'per plant']], start ?? '');
    else box = input({ value: Array.isArray(start) ? start.join(', ') : start ?? '' });
    box.disabled = !ctx.det.may_label;
    const tick = input({ type: 'checkbox' });
    // ticked for you: a changed figure that is not a safety one; a safety one waits for your own click
    tick.checked = check ? differs && !safety.has(f) : false;
    tick.disabled = !ctx.det.may_label;
    const row = { f, box, tick, a, differs, readable, typed: false };
    box.oninput = box.onchange = () => { row.typed = true; tick.checked = true; paintState(); };
    tick.onchange = () => paintState();
    const name = el('div', 'lb-f', FIELD[f] || f);
    if (safety.has(f)) { const s = el('span', 'pill warn lb-safe', 'safety'); s.title = 'A mistake here costs a crop or a person: never ticked for you.'; name.append(' ', s); }
    const now = el('div', 'lb-now', show(cur(f)));
    const says = el('div', 'lb-says');
    if (check) {
      if (!readable) says.append(el('span', 'hint', 'not on the photos'));
      else if (!differs) says.append(el('span', 'pill ok', 'matches'));
      else says.append(marked(cur(f), a.value));
      if (readable && a.quote) { const q = el('div', 'hint lb-quote', '“' + a.quote + '”'); says.append(q); }
    }
    const state = el('div', 'lb-state');
    row.state = state;
    const keep = el('div', 'lb-keep'); keep.append(box);
    const t = el('label', 'lb-tick'); t.append(tick);
    grid.append(name, now, says, keep, t);
    row.cells = [name, now, says, keep, t];
    rows.push(row);
  });
  w.append(grid);
  const paintState = () => rows.forEach(r => r.cells.forEach(c => {
    c.classList.toggle('lb-diff', r.differs && !r.tick.checked);
    c.classList.toggle('lb-on', r.tick.checked);
    c.classList.toggle('lb-dim', !!r.a && !r.readable);
  }));
  paintState();

  if (ctx.det.may_label) {
    const note = input({ placeholder: 'optional' });
    const valueOf = r => { const v = r.box.value.trim(); return ['crops', 'pack_sizes'].includes(r.f) ? v.split(',').map(s => s.trim()).filter(Boolean) : v; };
    const send = async (btn, all) => {
      // Accept all: asked first when it would take a safety figure; a no leaves every tick as it was
      if (all) {
        const safe = rows.filter(r => r.differs && r.readable && !r.tick.checked && safety.has(r.f));
        if (safe.length && !await confirmDrawer('Accept the safety figures too?',
          `${safe.map(r => FIELD[r.f]).join(', ')} — read them on the label yourself before you accept.`, 'I read them — accept all')) return;
        rows.forEach(r => { if (r.differs && r.readable) r.tick.checked = true; });
        paintState();
      }
      const on = rows.filter(r => r.tick.checked);
      busy(btn, true, 'Saving…');
      try {
        const r = await rpc('apply_label_check', { p_farm: farm.id, p_product: p.id, p: {
          check_id: check?.id || null,
          changes: on.map(r => ({ field: r.f, value: valueOf(r) })),
          rejected: rows.filter(r => r.differs && !r.tick.checked).map(r => r.f),
          note: note.value || null } });
        toast(on.length ? `Saved ${on.length} field${on.length === 1 ? '' : 's'} — validated against the label` : 'Validated against the label', 'ok');
        took(r);
      } catch (e) { busy(btn, false); toast(errText(e), 'bad'); }
    };
    const acts = el('div', 'row lb-acts');
    const val = el('button', 'btn btn-primary', check ? 'Validate the ticked fields' : 'Save and validate');
    val.onclick = () => send(val, false);
    acts.append(field('Note for the log', note), el('span', 'spacer'));
    if (check) {
      const drop = el('button', 'btn btn-ghost', 'Dismiss this reading');
      drop.onclick = async () => {
        if (!await confirmDrawer('Dismiss this reading?', 'The AI reading of the label is set aside; the product keeps what it has.', 'Dismiss it', true)) return;
        await once(drop, async () => { try { took(await rpc('dismiss_label_check', { p_farm: farm.id, p_check: check.id })); } catch (e) { toast(errText(e), 'bad'); } });
      };
      const all = el('button', 'btn', 'Accept all');
      all.title = 'Every readable field as the AI read it';
      all.onclick = () => send(all, true);
      acts.append(drop, all);
    } else {
      const x = el('button', 'btn btn-ghost', 'Cancel'); x.onclick = () => w.remove(); acts.append(x);
    }
    acts.append(val);
    w.append(el('div', 'hint', 'Ticked: the value in “Keep” is saved. Unticked: the product keeps what it has. Saving marks the product as validated against the label, with your name and the day.'), acts);
  }
  return w;
}
