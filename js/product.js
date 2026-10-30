// ═══════════════════════════════════════════════════════════════════════════
// One product of the catalogue (console 0.7.284, migration 0263, owner 29 Oct 2026: "add the possibility to add label
// pictures on each product … ai check the information and propose modifications or validation for each entries with
// highlighted text in case of modification, user can check each entry and modify manually and validate all
// modifications … the available stock … the possibility to add/modify stock (with his format and volume and qty)";
// then "Farm manager, agronomist, admin and office, create a log … made by ai on dd/mm/yyyy, validated by user on,
// modified by user").
//
//   openProduct(farm, p, label, opts) — the drawer of Scouting › Products:
//     • what the catalogue says (read only)
//     • Label photos: front, back, leaflet, safety data sheet, pack — added by the Admin, Farm manager, Office and
//       Agronomist (product-labels bucket, <farm>/<product>/<uuid>.jpg), seen by everyone; or picked from the farm
//       gallery ("From the gallery", 0.7.286, migration 0265: the same file, signed from its own bucket, farm-gallery;
//       taking it off the product leaves the file in the gallery)
//     • Read the label with AI (edge function label-check) → a review, field by field: Now · Label says (what differs
//       highlighted) · the value to keep, editable · a tick. A changed safety figure (rate, withholding, re-entry,
//       applications, interval) is never ticked for you. Validate saves the ticked ones and marks the product validated
//       against the label
//     • Edit (0.7.287, migration 0266, owner 29 Oct 2026: "before we need to be able to edit/modify each product"): every
//       field a person may change, in sections; Save keeps it as it is checked, Save and validate marks it validated
//       against the label. A label field saved without validating makes a validated product "not validated" again
//     • In the store: what is held, the lots still there (first in, first out) with their expiry, Add stock (packs ×
//       size, the pack, the lot, the expiry) and Correct the count; the Stock page shows the same movements
//     • History: every change, the AI's and the people's, dd/mm/yyyy, with Undo
//     • Side effects on beneficials (0.7.288, migration 0267): for a spray, what it does to each beneficial (safe,
//       moderate, harmful, unknown, how many days, where it was read) — the catalogue's rows and the unit's own, which
//       come first; for a beneficial, the sprays known to touch it. The four roles add the unit's own; the franchisor
//       the catalogue's. The treatment's preview warns from them
//   openChangeLog(farm, onOpen) — the log of the whole catalogue
//   openNewProduct(farm, products, onCreated, onOpenExisting) — a product of our own (0.7.285, migration 0264, owner
//     29 Oct 2026: "add the possibility to add a product manually just adding photos as well"): a name, or none when
//     its label photos follow; with photos the drawer opens and the AI reads them at once, name, supplier and kind
//     included. A name like one already in the list says so first. Seen by this unit and its sister units only.
//     Its photos are chosen on this computer or picked from the gallery (0.7.286)
// The system proposes, a person validates: nothing the AI read is saved until somebody presses Validate.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, api, URL_BASE } from './api.js';
import { el, num, drawer, toast, busy, input, field, selectBox, table, loading, confirmDrawer, FARM_TZ } from './ui.js';
import { pickFromGallery } from './gallery.js';
import { KIND, KIND_HINT, SPRAY } from './kinds.js';

const EFFECT = { safe: 'Safe', moderate: 'Moderate', harmful: 'Harmful', unknown: 'Not known' };
const EFFECT_PILL = { safe: 'ok', moderate: 'warn', harmful: 'bad', unknown: 'info' };
// the kind select says what each kind holds as you choose
const kindBox = (k, extra) => {
  const b = selectBox([...Object.entries(KIND), ...extra], k);
  b.title = KIND_HINT[k] || '';
  b.addEventListener('change', () => { b.title = KIND_HINT[b.value] || ''; });
  return b;
};
const CONF = { label: 'the label', supplier_page: 'the supplier\'s page', secondary: 'another site', unverified: 'not verified' };
export const FIELD = {
  name: 'Name', supplier: 'Supplier', kind: 'Kind', targets: 'Against', notes: 'Notes', label_url: 'Label link',
  active_ingredient: 'Active', formulation: 'Formulation', reg_no: 'Registration (Act 36)', moa_group: 'Resistance group',
  targets_text: 'Against', crops: 'Crops on the label', rate_text: 'Rate as written', rate_value: 'Rate, a figure',
  rate_unit: 'Rate unit', rate_per: 'Rate per', water_l_per_ha: 'Spray volume, L/ha', phi_days: 'Withholding, days',
  water_l_min: 'Spray volume, least L/ha', water_l_max: 'Spray volume, most L/ha', dose_min_per_ha: 'Least per ha (rate unit)',
  dose_max_per_ha: 'Most per ha (rate unit)',
  rei_hours: 'Re-entry, hours', max_applications: 'Most applications', interval_days: 'Interval, days', pack_sizes: 'Packs',
  storage: 'Storage', shelf_life_days: 'Keeps, days', conditions: 'Works when', compatibility: 'Compatibility', ppe: 'Protection',
};
const PHOTO_KIND = [['label', 'Front label'], ['back', 'Back label'], ['leaflet', 'Leaflet'], ['sds', 'Safety data sheet'], ['pack', 'Pack'], ['other', 'Other']];
const PACK = [['bottle', 'Bottle'], ['can', 'Can'], ['drum', 'Drum'], ['bag', 'Bag'], ['sachet', 'Sachet'], ['box', 'Box'], ['bucket', 'Bucket'], ['card', 'Card'], ['other', 'Other']];
const UNIT_CHOICES = { ml: [['L', 'L'], ['ml', 'ml']], g: [['kg', 'kg'], ['g', 'g']], kg: [['kg', 'kg'], ['g', 'g']] };
// one pack into the store's unit (0.7.289: a product counted in kg takes packs in kg or g)
const packFactor = (pu, unit) => pu === unit ? 1 : unit === 'ml' && pu === 'L' ? 1000 : unit === 'g' && pu === 'kg' ? 1000
  : unit === 'kg' && pu === 'g' ? 0.001 : 1;
const ACTION = {
  ai_read: 'Read by the AI', accepted: 'Validated as the AI read it', modified: 'Changed', rejected: 'Kept, the AI\'s reading refused',
  edited: 'Edited', checked: 'Validated against the label', unchecked: 'No longer validated', undone: 'Undone',
  created: 'Added as a product of our own', archived: 'Taken off the list',
  photo_added: 'Label photo added', photo_removed: 'Label photo removed',
};

// dd/mm/yyyy hh:mm, the farm's time (owner: "made by ai on dd/mm/yyyy")
const when = iso => new Date(iso).toLocaleString('en-GB', { timeZone: FARM_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// a date ('2026-10-29') as it is; a moment (a timestamp) on the farm's own day
const day = s => !s ? '—' : String(s).length <= 10
  ? new Date(String(s) + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : new Date(s).toLocaleDateString('en-GB', { timeZone: FARM_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const daysTo = s => Math.round((new Date(String(s).slice(0, 10) + 'T12:00:00') - new Date()) / 864e5);
const show = v => v == null || v === '' || (Array.isArray(v) && !v.length) ? '—' : Array.isArray(v) ? v.join(', ') : String(v);
const qtyText = (q, unit) => q == null ? '—' : unit === 'kg' && Math.abs(q) < 1 && q !== 0 ? `${num(q * 1000, Math.abs(q) < 0.01 ? 2 : 0)} g` : unit === 'ml' && Math.abs(q) >= 1000 ? `${num(q / 1000, 2)} L` : unit === 'g' && Math.abs(q) >= 1000 ? `${num(q / 1000, 2)} kg`
  : `${num(q, Math.abs(q) < 10 ? 2 : Math.abs(q) < 100 ? 1 : 0)} ${unit || ''}`.trim();
const n2 = v => num(v, Number(v) % 1 ? 2 : 0);
const errText = e => String(e?.message || e).replace(/^\d+ /, '');

// an expiry as a pill: red when past or within 30 days, amber within 90
export function expiryPill(s) {
  if (!s) return null;
  const d = daysTo(s);
  const pill = el('span', 'pill ' + (d < 30 ? 'bad' : d < 90 ? 'warn' : 'ok'), d < 0 ? `expired ${day(s)}` : `expires ${day(s)}`);
  pill.title = d < 0 ? 'Past its expiry: do not use it.' : `${d} days left`;
  return pill;
}

// the words of the new value that the old one does not have, marked (the owner's "highlighted text")
function marked(oldV, newV) {
  const w = el('span', 'lb-new');
  const now = show(newV);
  if (now === '—') { w.textContent = '—'; return w; }
  const had = new Set(show(oldV).toLowerCase().split(/[\s,;]+/).filter(Boolean));
  now.split(/(\s+|,\s*)/).forEach(t => {
    if (!t) return;
    if (/^\s+$|^,\s*$/.test(t) || had.has(t.toLowerCase().replace(/[.;:]$/, ''))) w.append(document.createTextNode(t));
    else w.append(el('mark', null, t));
  });
  return w;
}

// ── photos: shrunk on this computer (small print needs more than a scouting photo: 2000 px), one by one ──
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
  return new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
}
const encPath = path => path.split('/').map(encodeURIComponent).join('/');
// a photo is signed from its own bucket: product-labels, or farm-gallery for one picked from the gallery (0265)
const signed = new Map();
async function photoUrl(ph) {
  const bucket = ph.bucket || 'product-labels', key = bucket + '/' + ph.path;
  if (signed.has(key)) return signed.get(key);
  try {
    const r = await api(`/storage/v1/object/sign/${bucket}/` + encPath(ph.path), { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    const u = r?.signedURL ? URL_BASE + '/storage/v1' + r.signedURL : null;
    if (u) signed.set(key, u);
    return u;
  } catch { return null; }
}

export function openProduct(farm, p, label, opts = {}) {
  let changed = !!p._new;   // a product just added is in the list when the drawer closes
  const d = drawer(p.name, `${p.supplier} · ${KIND[p.kind] || p.kind}`, { onClose: () => { if (changed) opts.onChanged?.(); } });
  d.box.classList.add('tr-drawer');
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
  let det = null;
  const mount = el('div');
  d.body.append(mount);
  mount.append(loading('Reading the product…'));

  const load = async () => {
    try { det = await rpc('product_detail', { p_farm: farm.id, p_product: p.id }); paint(); }
    catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', errText(e))); }
  };
  // every write answers with the whole product again
  const took = r => { det = r; changed = true; Object.assign(p, r.product); const h = d.box.querySelector('header h2'); if (h) h.textContent = r.product.name;
    const sub = d.box.querySelector('header .hint'); if (sub) sub.textContent = `${r.product.supplier} · ${KIND[r.product.kind] || r.product.kind}`;
    d.box.setAttribute('aria-label', r.product.name); paint(); };
  let readBtn = null, autoRead = !!opts.autoRead;

  function paint() {
    const pr = det.product;
    mount.textContent = '';
    mount.append(factsBlock(pr, label));
    mount.append(photosBlock());
    if (det.check) mount.append(reviewBlock(det.check));
    if (!pr.perishable && pr.item_id) mount.append(stockBlock(pr));
    else if (pr.perishable) mount.append(el('div', 'note', 'A living product: ordered for each application, never stocked.'));
    if (SPRAY.includes(pr.kind) || pr.kind === 'beneficial') mount.append(effectsBlock(pr));
    mount.append(historyBlock());
    footer();
    // a new product with its photos: the AI reads them as soon as the drawer is open
    if (autoRead && readBtn && !readBtn.disabled && !det.check) { autoRead = false; readBtn.click(); }
  }
  function footer() {
    d.footer.textContent = '';
    if (det.may_label) {
      const ed = el('button', 'btn btn-primary', 'Edit');
      ed.title = 'Change any field of this product, for your unit and its sister units';
      ed.onclick = () => openEditor();
      d.footer.append(ed);
    }
    if (det.may_archive) {
      const off = el('button', 'btn btn-ghost', 'Take off the list');
      off.title = 'A product of our own: it leaves the list, its history and stock movements stay.';
      off.onclick = async () => {
        if (!await confirmDrawer('Take this product off the list?', `${det.product.name} leaves Products for your unit and its sister units. Its history and its stock movements stay.`, 'Take it off', true)) return;
        try { await rpc('archive_own_product', { p_farm: farm.id, p_product: p.id }); changed = true; toast('Taken off the list', 'ok'); d.close(); }
        catch (e) { toast(errText(e), 'bad'); }
      };
      d.footer.append(off);
    }
    d.footer.append(el('span', 'spacer'), close);
  }

  // ── Edit: every field a person may change, in sections ──
  async function openEditor() {
    const pr = det.product;
    const allowed = new Set(det.edit_fields || det.fields);
    const safety = new Set(det.safety);
    const here = [opts.farmName || 'this unit', ...(det.sisters || [])].join(', ');
    const rows = [];
    const dirty = () => rows.some(r => r.changed());
    // a stray click outside, or Escape, does not throw away what was typed (review 29 Oct 2026)
    const e = drawer(`Edit · ${pr.name}`, pr.group_id ? `Our own product — for ${here}` : `Your changes hold for ${here}; the other farms keep the catalogue's`,
                     { guard: () => !dirty() || confirm('Close without saving your changes?') });
    e.box.classList.add('tr-drawer');
    // the pest list: from the list page, or read here (a product opened from the gallery has none)
    let catalog = opts.catalog || [];
    if (!catalog.length && allowed.has('targets')) { try { catalog = await rpc('pest_catalog', {}) || []; } catch { catalog = []; } }
    catalog = catalog.slice().sort((a, b) => a.label.localeCompare(b.label));
    if (det.check) e.body.append(el('div', 'note', 'An AI reading of the label is waiting to be reviewed: it stays open below. Saving here does not answer it.'));
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

  // ── what the catalogue says ──
  function factsBlock(pr, label) {
    const w = el('div');
    const facts = el('dl', 'tr-facts');
    const fact = (k, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return; facts.append(el('dt', null, k), el('dd', null, Array.isArray(v) ? v.join(', ') : String(v))); };
    fact('Active', pr.active_ingredient); fact('Formulation', pr.formulation); fact('Resistance group', pr.moa_group);
    fact('Registration (Act 36 of 1947)', pr.reg_no);
    fact('Against', (pr.targets || []).map(label)); fact('As the source names them', pr.targets_text);
    fact('Crops on the label', pr.crops);
    fact('Rate', pr.rate_text);
    fact('Worked out as', pr.rate_value != null && pr.rate_per ? `${pr.rate_value} ${pr.rate_unit || ''} per ${pr.rate_per}` : 'not a figure the console can multiply — measure from the label');
    fact('Spray volume', pr.water_l_per_ha != null ? pr.water_l_per_ha + ' L/ha' : null);
    const range = (lo, hi, unit) => lo != null && hi != null ? `${lo}–${hi} ${unit}` : hi != null ? `at most ${hi} ${unit}` : lo != null ? `at least ${lo} ${unit}` : null;
    fact('Spray volume on the label', range(pr.water_l_min, pr.water_l_max, 'L/ha'));
    fact('Per hectare', range(pr.dose_min_per_ha, pr.dose_max_per_ha, (pr.rate_unit || '') + '/ha'));
    fact('Withholding period', pr.phi_days != null ? pr.phi_days + ' days (the longest of its crops)' : 'not found — read the label');
    fact('Re-entry', pr.rei_hours != null ? pr.rei_hours + ' h' : null);
    fact('At most', pr.max_applications != null ? pr.max_applications + ' applications' : null);
    fact('Usual interval', pr.interval_days != null ? pr.interval_days + ' days' : null);
    fact('Packs', pr.pack_sizes); fact('Storage', pr.storage); fact('Keeps', pr.shelf_life_days != null ? pr.shelf_life_days + ' days' : null);
    fact('Works when', pr.conditions); fact('Compatibility', pr.compatibility); fact('Protection', pr.ppe); fact('Notes', pr.notes);
    fact('Used by', p.programs ? `${p.programs} program${p.programs === 1 ? '' : 's'} of the library` : null);
    w.append(facts);
    if ((pr.per_crop || []).length) {
      w.append(el('div', 'pd-hlabel', 'Crop by crop, as the label says'));
      w.append(table([{ key: 'crop', label: 'Crop' }, { key: 'targets_text', label: 'Against' }, { key: 'rate_text', label: 'Rate' },
        { key: 'phi_days', label: 'Withholding', align: 'right', fmt: v => v == null ? '?' : v + ' d' }], pr.per_crop));
    }
    if (pr.group_id) w.prepend(el('div', 'hint', `Our own product — seen by ${[opts.farmName || 'this unit', ...(det.sisters || [])].join(', ')} only.`));
    const st = el('div', 'note ' + (pr.verified_at ? 'ok' : 'warn'), pr.verified_at
      ? `Validated against the label by ${pr.verified_name || 'the franchisor'} on ${day(pr.verified_at)}.`
      : pr.group_id ? 'A product of our own, not validated against its label yet: add its photos and have the AI read them, or edit it.'
      : `Read from ${CONF[pr.confidence] || pr.confidence}; nobody has validated it against the label yet. The label on the pack is the law — this page is a copy.`);
    w.append(st);
    // what this unit and its sisters corrected is theirs: the other franchise farms keep the catalogue's figures (0263)
    const here = [opts.farmName || 'this unit', ...(det.sisters || [])].join(', ');
    if ((pr.corrected || []).length) w.append(el('div', 'hint', `Changed for ${here}: ${pr.corrected.map(f => FIELD[f] || f).join(', ')}. The other farms of the franchise keep the catalogue's figures.`));
    else if (det.may_label) w.append(el('div', 'hint', `What you validate here holds for ${here} — the other farms of the franchise keep the catalogue's figures.`));
    const links = el('div', 'tr-links');
    [pr.label_url, ...(pr.source_urls || [])].filter((u, i, a) => u && /^https?:\/\//i.test(u) && a.indexOf(u) === i).forEach((u, i) => {
      const a = el('a', null, i === 0 && pr.label_url ? 'Label' : (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'source'; } })());
      a.href = u; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
    });
    if (links.childElementCount) w.append(el('div', 'pd-hlabel', 'Read from'), links);
    return w;
  }

  // ── the label photos ──
  function photosBlock() {
    const w = el('section', 'lb-sec');
    const head = el('div', 'lb-head');
    head.append(el('div', 'pd-hlabel', `Label photos${det.photos.length ? ' · ' + det.photos.length : ''}`), el('span', 'spacer'));
    w.append(head);
    const strip = el('div', 'lb-photos');
    det.photos.forEach(ph => {
      const fig = el('figure', 'lb-photo');
      const img = el('img'); img.alt = (PHOTO_KIND.find(k => k[0] === ph.kind) || [, ph.kind])[1]; img.loading = 'lazy';
      const a = el('a'); a.target = '_blank'; a.rel = 'noopener'; a.append(img);
      photoUrl(ph).then(u => { if (u) { img.src = u; a.href = u; } });
      const cap = el('figcaption', null, `${img.alt} · ${ph.by || '?'} · ${day(ph.at)}`);
      fig.append(a, cap);
      if (ph.may_remove) {
        const x = el('button', 'btn btn-sm btn-ghost lb-x', '✕'); x.title = 'Remove this photo';
        x.onclick = async () => {
          if (!await confirmDrawer('Remove this photo?', 'It goes from this product for your unit and its sister units. The log keeps a line that it was removed.'
            + (ph.bucket === 'farm-gallery' ? ' The photo stays in the gallery.' : ''), 'Remove', true)) return;
          try {
            const r = await rpc('remove_product_photo', { p_farm: farm.id, p_photo: ph.id });
            // a photo picked from the gallery answers removed_path null: its file stays in the gallery, nothing to delete
            if (r.removed_path) api('/storage/v1/object/product-labels/' + encPath(r.removed_path), { method: 'DELETE' }).catch(() => {});
            took(r);
          } catch (e) { toast(errText(e), 'bad'); }
        };
        fig.append(x);
      }
      strip.append(fig);
    });
    if (!det.photos.length) strip.append(el('div', 'hint', det.may_label
      ? 'No photo yet. Add the front and the back of the label — the small print is what the AI reads.'
      : 'No photo of this label yet.'));
    w.append(strip);

    if (det.may_label) {
      const acts = el('div', 'row lb-acts');
      const kind = selectBox(PHOTO_KIND, det.photos.some(x => x.kind === 'label') ? 'back' : 'label');
      const pick = input({ type: 'file', accept: 'image/*', multiple: true }); pick.hidden = true;
      const add = el('button', 'btn btn-sm', 'Add label photos');
      add.onclick = () => pick.click();
      // the farm gallery (0.7.286): photos the phones sent, tagged "label" first; the same file is linked, not copied
      const gal = el('button', 'btn btn-sm', 'From the gallery');
      gal.title = 'Choose photos the farm already sent from the phone (Office › Gallery)';
      gal.onclick = async () => {
        const chosen = await pickFromGallery(farm, { tag: 'label', multiple: true });
        if (!chosen.length) return;
        let r = null;
        try {
          for (let i = 0; i < chosen.length; i++) {
            busy(gal, true, `Adding ${i + 1} of ${chosen.length}…`);
            r = await rpc('add_product_photo_from_gallery', { p_farm: farm.id, p_product: p.id, p_photo: chosen[i].id, p_kind: kind.value });
          }
          busy(gal, false); toast(chosen.length === 1 ? 'Photo added' : `${chosen.length} photos added`, 'ok');
        } catch (e) { busy(gal, false); toast(errText(e), 'bad'); }
        if (r) took(r);
      };
      pick.onchange = async () => {
        const files = [...pick.files]; pick.value = '';
        if (!files.length) return;
        let r = null;
        try {
          for (let i = 0; i < files.length; i++) {
            busy(add, true, `Sending ${i + 1} of ${files.length}…`);
            const blob = await shrink(files[i]);
            const path = `${farm.id}/${p.id}/${crypto.randomUUID()}.jpg`;
            await api('/storage/v1/object/product-labels/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
            r = await rpc('add_product_photo', { p_farm: farm.id, p_product: p.id, p_path: path, p_kind: kind.value });
          }
          busy(add, false); toast(files.length === 1 ? 'Photo added' : `${files.length} photos added`, 'ok');
        } catch (e) { busy(add, false); toast(errText(e), 'bad'); }
        if (r) took(r);
      };
      const read = el('button', 'btn btn-sm btn-primary', det.check ? 'Read the label again' : 'Read the label with AI');
      readBtn = read;
      read.disabled = !det.photos.length;
      read.title = det.photos.length ? 'The AI reads every field from the photos and proposes; nothing is saved until you validate.' : 'Add a photo of the label first.';
      read.onclick = async () => {
        busy(read, true, 'The AI is reading the label… (up to a minute)');
        try {
          const r = await fn('label-check', { farm_id: farm.id, product_id: p.id });
          if (!r?.ok) throw new Error(r?.error || 'the AI gave no answer');
          changed = true; await load();
          const n = (r.check.fields || []).filter(f => f.differs).length;
          toast(n ? `${n} field${n === 1 ? '' : 's'} differ from the label — review them below` : 'The label agrees with the catalogue — validate it below', 'ok');
          mount.querySelector('.lb-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { busy(read, false); toast(errText(e), 'bad'); }
      };
      acts.append(field('Photo of', kind), add, gal, pick, el('span', 'spacer'), read);
      w.append(acts);
    }
    return w;
  }

  // ── the review: the AI's reading (check) or the product by hand (check null) ──
  function reviewBlock(check) {
    const w = el('section', 'lb-sec lb-review');
    const safety = new Set(det.safety);
    const cur = f => det.product[f];
    const ai = new Map((check?.fields || []).map(x => [x.field, x]));
    w.append(el('div', 'pd-hlabel', check ? `The AI read the label · ${when(check.at)} · asked by ${check.by || '?'}` : 'Correct by hand, against the label'));
    if (check?.summary) w.append(el('div', 'note', check.summary));
    if (!det.may_label) { w.append(el('div', 'hint', 'Waiting for the Admin, the Farm manager, the Office or the Agronomist to validate it.')); }
    const rows = [];
    const grid = el('div', 'lb-grid');
    grid.append(el('div', 'lb-gh', 'Field'), el('div', 'lb-gh', 'Now'), el('div', 'lb-gh', check ? 'Label says' : ''), el('div', 'lb-gh', 'Keep'), el('div', 'lb-gh', ''));
    det.fields.forEach(f => {
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
      box.disabled = !det.may_label;
      const tick = input({ type: 'checkbox' });
      // ticked for you: a changed figure that is not a safety one; a safety one waits for your own click
      tick.checked = check ? differs && !safety.has(f) : false;
      tick.disabled = !det.may_label;
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

    if (det.may_label) {
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
        drop.onclick = async () => { try { took(await rpc('dismiss_label_check', { p_farm: farm.id, p_check: check.id })); } catch (e) { toast(errText(e), 'bad'); } };
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

  // ── the store ──
  function stockBlock(pr) {
    const w = el('section', 'lb-sec lb-stock');
    const unit = pr.unit;
    const head = el('div', 'lb-head');
    head.append(el('div', 'pd-hlabel', 'In the store'), el('b', 'lb-oh', qtyText(Number(pr.on_hand || 0), unit)));
    const soon = (det.lots || []).map(l => l.expires_on).filter(Boolean).sort()[0];
    if (soon) head.append(expiryPill(soon));
    w.append(head);
    if ((det.lots || []).length) {
      w.append(table([
        { key: 'at', label: 'Received', fmt: v => day(v) },
        { key: 'packs', label: 'Pack', fmt: (v, r) => v ? `${n2(v)} × ${n2(r.pack_size)} ${r.pack_unit || ''}${r.pack_format ? ' ' + r.pack_format : ''}` : '—' },
        { key: 'lot', label: 'Lot' },
        { key: 'expires_on', label: 'Expiry', fmt: v => v ? expiryPill(v) : '—' },
        { key: 'left', label: 'Still here', align: 'right', fmt: v => qtyText(Number(v), unit) },
      ], det.lots));
      w.append(el('div', 'hint', 'What was received last is counted as what is left (first in, first out).'));
    }
    if (det.may_label) {
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
        if (cnt.value === '') { toast('What does the store hold, in ' + unit + '?', 'bad'); return; }
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

  // ── the history ──
  // ── Side effects on beneficials (0267): read on their own, so the drawer opens without waiting for them ──
  function effectsBlock(pr) {
    const ben = pr.kind === 'beneficial';
    const w = el('section', 'lb-sec lb-effects');
    const head = el('div', 'lb-head');
    head.append(el('div', 'pd-hlabel', ben ? 'Sprays known to touch it' : 'Side effects on beneficials'));
    const body = el('div');
    w.append(head, body);
    body.append(loading('Reading the side effects…'));
    const paintFx = fx => {
      body.textContent = '';
      head.querySelectorAll('button').forEach(b => b.remove());
      const may = !ben && (fx.may_change || fx.may_catalogue);
      const rows = ben ? fx.on_this : fx.as_spray;
      if (!rows.length) {
        body.append(el('div', 'hint', ben ? 'No spray has a side effect recorded on it yet.'
          : 'None recorded yet. Where beneficials are released, the treatment\'s preview says "not known yet" for a chemical, mineral or adjuvant spray.'));
      } else {
        body.append(table([
          { key: ben ? 'product' : 'beneficial', label: ben ? 'Spray' : 'Beneficial', fmt: (v, r) => {
            const s = el('span');
            s.append(v || el('i', null, `${r.species} (every product)`));
            if (r.own) s.append(' ', el('span', 'pill info', 'ours'));
            return s;
          } },
          { key: 'rating', label: 'Effect', fmt: v => el('span', 'pill ' + (EFFECT_PILL[v] || 'info'), EFFECT[v] || v) },
          { key: 'persistence_days', label: 'Lasts', align: 'right', fmt: v => v == null ? '—' : v + ' d' },
          { key: 'source', label: 'Read in', fmt: (v, r) => [v, r.note].filter(Boolean).join(' · ') || '—' },
          { key: 'checked_at', label: 'By', fmt: (v, r) => [r.checked_name, v ? day(v) : null].filter(Boolean).join(', ') },
          ...(may ? [{ key: 'id', label: '', fmt: (v, r) => {
            if (r.own ? !fx.may_change : !fx.may_catalogue) return '';
            const b = el('span');
            const ed = el('button', 'btn btn-sm btn-ghost', 'Change');
            ed.onclick = () => effectForm(fx, r);
            const rm = el('button', 'btn btn-sm btn-ghost', 'Remove');
            rm.onclick = async () => {
              if (!await confirmDrawer('Remove this side effect?', `${r.beneficial || r.species}: ${EFFECT[r.rating] || r.rating}${r.own ? '' : ' — the catalogue\'s, for every farm'}.`, 'Remove', true)) return;
              busy(rm, true, 'Removing…');
              try { paintFx(await rpc('remove_side_effect', { p_farm: farm.id, p_id: r.id })); toast('Removed', 'ok'); }
              catch (e) { busy(rm, false); toast(errText(e), 'bad'); }
            };
            b.append(ed, rm);
            return b;
          } }] : []),
        ], rows));
      }
      if (may) {
        const add = el('button', 'btn btn-sm', 'Add a side effect');
        add.onclick = () => effectForm(fx, null);
        head.append(add);
      }
    };
    // one side effect: a beneficial product or every product of its species, the effect, how long, where it was read
    const effectForm = (fx, r) => {
      const e = drawer(r ? 'Change a side effect' : 'Add a side effect', `${pr.name} on a beneficial`);
      const species = [...new Set(fx.beneficials.map(b => b.species).filter(Boolean))].sort();
      const who = selectBox([['', 'Choose…'], ...fx.beneficials.map(b => [b.id, b.name + (b.species ? ` — ${b.species}` : '')]),
        ...species.map(s => ['sp:' + s, `Every product of ${s}`])], r ? (r.beneficial_id || 'sp:' + r.species) : '');
      const rating = selectBox(Object.entries(EFFECT), r?.rating || 'harmful');
      const days = input({ type: 'number', min: 0, max: 365, step: 1, value: r?.persistence_days ?? '' });
      const source = input({ placeholder: 'e.g. the supplier\'s side-effects list, 2026; the label', value: r?.source || '' });
      const note = el('textarea'); note.rows = 2; note.value = r?.note || '';
      const cat = input({ type: 'checkbox' });
      const cw = el('label', 'lb-check');
      cw.append(cat, el('span', null, 'For the catalogue: every farm sees it'));
      e.body.append(field('Beneficial', who), field('Effect', rating), field('It lasts, days', days), field('Read in', source), field('Note', note));
      if (!r && fx.may_catalogue && fx.may_change) e.body.append(cw);
      if (!r && !fx.may_change) cat.checked = true;
      const save = el('button', 'btn btn-primary', 'Save');
      save.onclick = async () => {
        if (!who.value) { toast('Choose the beneficial', 'bad'); return; }
        const sp = who.value.startsWith('sp:') ? who.value.slice(3) : null;
        busy(save, true, 'Saving…');
        try {
          paintFx(await rpc('save_side_effect', { p_farm: farm.id, p: { id: r?.id, product_id: pr.id, beneficial_id: sp ? null : who.value, species: sp,
            rating: rating.value, persistence_days: days.value, source: source.value, note: note.value, catalogue: r ? !r.own : cat.checked } }));
          toast('Saved', 'ok');
          e.close();
        } catch (er) { busy(save, false); toast(errText(er), 'bad'); }
      };
      const cancel = el('button', 'btn', 'Cancel');
      cancel.onclick = e.close;
      e.footer.append(save, el('span', 'spacer'), cancel);
    };
    rpc('product_side_effects', { p_farm: farm.id, p_product: pr.id }).then(paintFx)
      .catch(e => { body.textContent = ''; body.append(el('div', 'note bad', errText(e))); });
    return w;
  }

  function historyBlock() {
    const w = el('section', 'lb-sec lb-history');
    w.append(el('div', 'pd-hlabel', 'History'));
    const unit = det.product.unit;
    if (!det.history.length) { w.append(el('div', 'hint', 'Nothing changed on this product yet.')); return w; }
    const list = el('ol', 'lb-log');
    det.history.slice(0, 60).forEach(h => list.append(logLine(h, unit, async btn => {
      if (!await confirmDrawer('Undo this change?', `${FIELD[h.field] || h.field} goes back to ${show(h.old)}. If the product was validated against the label it stays so, now in your name.`, 'Undo')) return;
      busy(btn, true, 'Undoing…');
      try { took(await rpc('undo_product_change', { p_farm: farm.id, p_change: h.id })); toast('Undone', 'ok'); }
      catch (e) { busy(btn, false); toast(errText(e), 'bad'); }
    })));
    w.append(list);
    if (det.history.length > 60) w.append(el('div', 'hint', `The 60 latest of ${det.history.length}.`));
    return w;
  }

  load();
  return d;
}

// one line of a log: dd/mm/yyyy hh:mm · what · who
function logLine(h, unit, onUndo) {
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

// ── a product of our own ──
export function openNewProduct(farm, products, onCreated, onOpenExisting) {
  const d = drawer('New product', 'A product of our own: give it a name, or just add the photos of its label — the AI reads them');
  const name = input({ placeholder: 'as on the label (empty: the AI reads it from the photos)' });
  const supplier = input({ placeholder: 'optional' });
  const kind = kindBox('chemical', []);
  const unit = selectBox([['ml', 'ml (a liquid)'], ['g', 'g (a powder, granules)'], ['kg', 'kg (a solid in bulk)'], ['units', 'units (traps, sachets, cards)'], ['individuals', 'individuals (living)']], 'ml');
  const living = input({ type: 'checkbox' });
  const lw = el('label', 'lb-check'); lw.append(living, el('span', null, 'A living product (predators, parasitoids): ordered for each use, never stocked'));
  kind.onchange = () => { if (kind.value === 'beneficial') { living.checked = true; unit.value = 'individuals'; } };
  // a name like one already in the list: open that one instead of adding it twice
  const like = el('div', 'lb-like');
  name.oninput = () => {
    const t = name.value.trim().toLowerCase();
    like.textContent = '';
    if (t.length < 3) return;
    const hits = products.filter(x => x.name.toLowerCase().includes(t) || t.includes(x.name.toLowerCase())).slice(0, 4);
    if (!hits.length) return;
    like.append(el('span', 'hint', 'Already in the list: '));
    hits.forEach((x, i) => {
      const a = el('a', null, `${x.name} (${x.supplier})`); a.href = '#';
      a.onclick = e => { e.preventDefault(); d.close(); onOpenExisting?.(x); };
      if (i) like.append(document.createTextNode(' · '));
      like.append(a);
    });
  };
  const kindPhoto = selectBox(PHOTO_KIND, 'label');
  const pick = input({ type: 'file', accept: 'image/*', multiple: true }); pick.hidden = true;
  const choose = el('button', 'btn btn-sm', 'Choose photos'); choose.onclick = () => pick.click();
  const picked = el('div', 'hint');
  let fromGallery = [];   // the photos picked from the gallery (0.7.286), linked once the product exists
  const paintPicked = () => {
    const n = pick.files.length + fromGallery.length;
    picked.textContent = n ? `${n} photo${n === 1 ? '' : 's'} chosen${fromGallery.length ? ` (${fromGallery.length} from the gallery)` : ''} — the AI reads them once the product is added` : '';
  };
  pick.onchange = paintPicked;
  const gallery = el('button', 'btn btn-sm', 'From the gallery');
  gallery.title = 'Choose photos the farm already sent from the phone (Office › Gallery)';
  gallery.onclick = async () => {
    const chosen = await pickFromGallery(farm, { tag: 'label', multiple: true });
    if (chosen.length) { fromGallery = chosen; paintPicked(); }
  };
  const f = el('div', 'tr-form');
  f.append(field('Name', name), field('Supplier', supplier), field('Kind', kind), field('The store counts it in', unit));
  d.body.append(f, like, lw, el('div', 'pd-hlabel', 'Label photos'), el('div', 'row lb-acts'), picked);
  d.body.lastChild.previousSibling.append(field('First photo is the', kindPhoto), choose, gallery, pick);
  d.body.append(el('div', 'hint', 'It is seen by your unit and its sister units only. Everything else — rate, withholding, re-entry, packs — comes from its label: read by the AI and validated by you, or typed in with Edit.'));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Add the product');
  let made = null;   // the product, once it exists: a retry sends the photos only
  go.onclick = async () => {
    const files = [...pick.files], total = files.length + fromGallery.length;
    if (!name.value.trim() && !total) { toast('Give it a name, or add the photos of its label', 'bad'); name.focus(); return; }
    busy(go, true, 'Adding…');
    try {
      let r = made || await rpc('create_own_product', { p_farm: farm.id, p: { name: name.value, supplier: supplier.value, kind: kind.value,
        unit: unit.value, perishable: living.checked, from_photos: total > 0 } });
      made = r;
      const p = r.product;
      for (let i = 0; i < files.length; i++) {
        busy(go, true, `Sending photo ${i + 1} of ${files.length}…`);
        const path = `${farm.id}/${p.id}/${crypto.randomUUID()}.jpg`;
        await api('/storage/v1/object/product-labels/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: await shrink(files[i]) });
        r = await rpc('add_product_photo', { p_farm: farm.id, p_product: p.id, p_path: path, p_kind: i === 0 ? kindPhoto.value : 'back' });
      }
      // the gallery's photos: the same files, linked (twice for the same product is one row)
      for (let i = 0; i < fromGallery.length; i++) {
        busy(go, true, `Adding gallery photo ${i + 1} of ${fromGallery.length}…`);
        r = await rpc('add_product_photo_from_gallery', { p_farm: farm.id, p_product: p.id, p_photo: fromGallery[i].id, p_kind: !files.length && i === 0 ? kindPhoto.value : 'back' });
      }
      toast(total ? 'Added — the AI is reading its label' : 'Added', 'ok');
      d.close();
      onCreated?.({ ...r.product, _new: true, _autoRead: total > 0 });
    } catch (e) {
      busy(go, false);
      if (!made) { toast(errText(e), 'bad'); return; }
      // the product is there, a photo did not go: open it — its photos can be added from its own window
      toast(`Added, but a photo did not go: ${errText(e)}. Add it from the product.`, 'bad');
      d.close();
      onCreated?.({ ...made.product, _new: true });
    }
  };
  d.footer.append(cancel, go);
}
