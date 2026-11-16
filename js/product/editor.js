// Edit: every field a person may change, in sections (split from product.js, 16 Nov 2026)
import { rpc } from '../api.js';
import { el, drawer, toast, busy, input, field, selectBox, confirmDrawer } from '../ui.js';
import { KIND } from '../kinds.js';
import { kindBox, errText, FIELD } from './fields.js';

// ── Edit: every field a person may change, in sections ──
export async function openEditor(ctx) {
  const { farm, p, opts, took } = ctx;
  const pr = ctx.det.product;
  const allowed = new Set(ctx.det.edit_fields || ctx.det.fields);
  const safety = new Set(ctx.det.safety);
  const here = [opts.farmName || 'this unit', ...(ctx.det.sisters || [])].join(', ');
  const rows = [];
  const dirty = () => rows.some(r => r.changed());
  // a stray click outside, or Escape, does not throw away what was typed (review 29 Oct 2026)
  const e = drawer(`Edit · ${pr.name}`, pr.group_id ? `Our own product — for ${here}` : `Your changes hold for ${here}; the other farms keep the catalogue's`,
                   { guard: () => !dirty() || confirmDrawer('Close without saving?', 'Your changes to this product are not saved yet.', 'Close without saving', true) });
  e.box.classList.add('tr-drawer');
  // the pest list: from the list page, or read here (a product opened from the gallery has none)
  let catalog = opts.catalog || [];
  if (!catalog.length && allowed.has('targets')) { try { catalog = await rpc('pest_catalog', {}) || []; } catch { catalog = []; } }
  catalog = catalog.slice().sort((a, b) => a.label.localeCompare(b.label));
  if (ctx.det.check) e.body.append(el('div', 'note', 'An AI reading of the label is waiting to be reviewed: it stays open below. Saving here does not answer it.'));
  const LONG = new Set(['targets_text', 'rate_text', 'storage', 'conditions', 'compatibility', 'ppe', 'notes']);
  const SECTIONS = [
    ['Identity', ['name', 'supplier', 'kind', 'reg_no', 'active_ingredient', 'formulation', 'moa_group']],
    ['Use', ['targets', 'targets_text', 'crops']],
    ['Rate', ['rate_text', 'rate_value', 'rate_unit', 'rate_per', 'water_l_per_ha', 'water_l_min', 'water_l_max', 'dose_min_per_ha', 'dose_max_per_ha']],
    ['Safety', ['phi_days', 'rei_hours', 'max_applications', 'interval_days']],
    ['Packs and storage', ['pack_sizes', 'storage', 'shelf_life_days']],
    ['Notes', ['conditions', 'compatibility', 'ppe', 'notes', 'label_url']],
  ];
  // figures in a text box with a decimal keyboard: "1,5" reaches the database as typed (a number box sends nothing
  // for it on a South African computer, and the figure would be cleared)
  const NUM = new Set(['rate_value', 'water_l_per_ha', 'water_l_min', 'water_l_max', 'dose_min_per_ha', 'dose_max_per_ha', 'rei_hours', 'phi_days', 'max_applications', 'interval_days', 'shelf_life_days']);
  const LABEL = { ...FIELD, targets_text: 'Against, as printed', label_url: 'Label link (https://…)' };
  const count = el('span', 'hint');
  const recount = () => { const n = rows.filter(r => r.changed()).length; count.textContent = n ? `${n} change${n === 1 ? '' : 's'}` : 'No change yet'; };
  let uid = 0;
  SECTIONS.forEach(([title, fields]) => {
    const fs = fields.filter(f => allowed.has(f));
    if (!fs.length) return;
    e.body.append(el('div', 'pd-hlabel', title));
    const grid = el('div', 'tr-form lb-edit');
    fs.forEach(f => {
      const start = pr[f];
      let box, read, wrap;
      if (f === 'targets') {
        // against: chips of the pest list, the product's own first; a tick changes the chip in place
        const chosen = new Set(start || []);
        const chips = el('div', 'lb-chips');
        chips.setAttribute('role', 'group');
        const find = input({ type: 'search', placeholder: 'find a pest or disease' });
        find.setAttribute('aria-label', 'Find a pest or disease');
        const known = new Set(catalog.map(k => k.code));
        const listed = () => [...catalog.filter(k => chosen.has(k.code)), ...[...chosen].filter(c => !known.has(c)).map(c => ({ code: c, label: c })),
                              ...catalog.filter(k => !chosen.has(k.code))];
        const paintChips = () => {
          chips.textContent = '';
          const t = find.value.trim().toLowerCase();
          const shown = listed().filter(k => chosen.has(k.code) || !t || k.label.toLowerCase().includes(t));
          if (!shown.length) chips.append(el('span', 'hint', catalog.length ? 'Nothing of that name in the pest list.' : 'The pest list could not be read.'));
          shown.forEach(k => {
            const c = el('button', 'lb-chip' + (chosen.has(k.code) ? ' on' : ''), k.label);
            c.type = 'button';
            c.setAttribute('aria-pressed', String(chosen.has(k.code)));
            c.onclick = () => {
              chosen.has(k.code) ? chosen.delete(k.code) : chosen.add(k.code);
              c.classList.toggle('on', chosen.has(k.code)); c.setAttribute('aria-pressed', String(chosen.has(k.code)));
              mark();
            };
            chips.append(c);
          });
        };
        find.oninput = paintChips; paintChips();
        box = el('div'); box.append(find, chips);
        read = () => [...chosen].sort();
        const was = JSON.stringify(read());
        const mark = () => { wrap.classList.toggle('lb-changed', JSON.stringify(read()) !== was); recount(); };
        wrap = field(LABEL[f], box); wrap.classList.add('lb-wide');
        rows.push({ f, read, changed: () => JSON.stringify(read()) !== was });
        grid.append(wrap);
        return;
      }
      if (f === 'kind') {
        const k0 = String(start ?? '').toLowerCase();
        box = kindBox(k0 || 'chemical', KIND[k0] || !k0 ? [] : [[k0, k0 + ' (not a kind: choose one)']]);
      }
      else if (f === 'rate_unit') box = selectBox([['', '—'], ['ml', 'ml'], ['g', 'g'], ['kg', 'kg'], ['individuals', 'individuals'], ['units', 'units']], start ?? '');
      else if (f === 'rate_per') box = selectBox([['', '—'], ['m2', 'per m²'], ['ha', 'per ha'], ['100L', 'per 100 L'], ['L', 'per L'], ['plant', 'per plant']], start ?? '');
      else if (LONG.has(f)) { box = el('textarea'); box.rows = 2; box.value = start ?? ''; }
      else {
        box = input({ type: 'text', value: Array.isArray(start) ? start.join(', ') : start ?? '' });
        if (NUM.has(f)) box.inputMode = 'decimal';
        // as South African labels print it; the database writes it so, or says why not (0270)
        if (f === 'moa_group') box.placeholder = 'as on the label: Group 11 fungicide, Group 11 & 3 fungicide';
      }
      box.id = 'lbe-' + (++uid);
      const list = f === 'crops' || f === 'pack_sizes';
      read = () => list ? box.value.split(',').map(x => x.trim()).filter(Boolean) : box.value.trim();
      const now = () => list ? read().join(', ') : read();
      // the start is what the box shows, so nothing counts as changed before a person changes it
      const was = now();
      wrap = field(LABEL[f] || f, box, safety.has(f) ? 'safety: read it on the label' : (list ? 'comma between each' : null));
      if (LONG.has(f) || f === 'label_url') wrap.classList.add('lb-wide');
      box.oninput = box.onchange = () => { wrap.classList.toggle('lb-changed', now() !== was); recount(); };
      rows.push({ f, read, changed: () => now() !== was });
      grid.append(wrap);
    });
    e.body.append(grid);
  });
  e.body.append(el('div', 'hint', 'Save keeps your change and logs it. Save and validate also says you read it against the label: '
    + 'a label field saved without validating makes a validated product "not validated" again.'));
  recount();
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = () => e.close();
  const sv = el('button', 'btn', 'Save');
  const ok = el('button', 'btn btn-primary', 'Save and validate');
  ok.title = 'I read these figures on the label';
  const save = async (btn, validate) => {
    const changes = rows.filter(r => r.changed()).map(r => ({ field: r.f, value: r.read() }));
    if (!changes.length && !validate) { toast('Nothing changed', ''); return; }
    busy(btn, true, 'Saving…'); [sv, ok].forEach(b => { b.disabled = true; });
    try {
      const r = await rpc('apply_label_check', { p_farm: farm.id, p_product: p.id, p: { changes, validate } });
      toast(validate ? 'Saved and validated against the label' : `Saved ${changes.length} change${changes.length === 1 ? '' : 's'}`, 'ok');
      rows.length = 0;   // saved: closing asks nothing
      e.close(); took(r);
    } catch (er) { busy(btn, false); [sv, ok].forEach(b => { b.disabled = false; }); toast(errText(er), 'bad'); }
  };
  sv.onclick = () => save(sv, false);
  ok.onclick = () => save(ok, true);
  e.footer.append(count, el('span', 'spacer'), cancel, sv, ok);
}
