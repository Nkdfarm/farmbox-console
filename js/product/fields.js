// The product drawer's shared words, formatters, the label-photo helpers and the expiry pill (split from product.js, 16 Nov 2026)
import { api, URL_BASE } from '../api.js';
import { el, num, selectBox, FARM_TZ, farmToday, parseYmd } from '../ui.js';
import { KIND, KIND_HINT } from '../kinds.js';

export const EFFECT = { safe: 'Safe', moderate: 'Moderate', harmful: 'Harmful', unknown: 'Not known' };
export const EFFECT_PILL = { safe: 'ok', moderate: 'warn', harmful: 'bad', unknown: 'info' };
// the kind select says what each kind holds as you choose
export const kindBox = (k, extra) => {
  const b = selectBox([...Object.entries(KIND), ...extra], k);
  b.title = KIND_HINT[k] || '';
  b.addEventListener('change', () => { b.title = KIND_HINT[b.value] || ''; });
  return b;
};
export const CONF = { label: 'the label', supplier_page: 'the supplier\'s page', secondary: 'another site', unverified: 'not verified' };
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
export const PHOTO_KIND = [['label', 'Front label'], ['back', 'Back label'], ['leaflet', 'Leaflet'], ['sds', 'Safety data sheet'], ['pack', 'Pack'], ['other', 'Other']];
export const PACK = [['bottle', 'Bottle'], ['can', 'Can'], ['drum', 'Drum'], ['bag', 'Bag'], ['sachet', 'Sachet'], ['box', 'Box'], ['bucket', 'Bucket'], ['card', 'Card'], ['other', 'Other']];
export const UNIT_CHOICES = { ml: [['L', 'L'], ['ml', 'ml']], g: [['kg', 'kg'], ['g', 'g']], kg: [['kg', 'kg'], ['g', 'g']] };
// one pack into the store's unit (0.7.289: a product counted in kg takes packs in kg or g)
export const packFactor = (pu, unit) => pu === unit ? 1 : unit === 'ml' && pu === 'L' ? 1000 : unit === 'g' && pu === 'kg' ? 1000
  : unit === 'kg' && pu === 'g' ? 0.001 : 1;
export const ACTION = {
  ai_read: 'Read by the AI', accepted: 'Validated as the AI read it', modified: 'Changed', rejected: 'Kept, the AI\'s reading refused',
  edited: 'Edited', checked: 'Validated against the label', unchecked: 'No longer validated', undone: 'Undone',
  created: 'Added as a product of our own', archived: 'Taken off the list',
  photo_added: 'Label photo added', photo_removed: 'Label photo removed',
};

// dd/mm/yyyy hh:mm, the farm's time (owner: "made by ai on dd/mm/yyyy")
export const when = iso => new Date(iso).toLocaleString('en-GB', { timeZone: FARM_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// a date ('2026-10-29') as it is; a moment (a timestamp) on the farm's own day
export const day = s => !s ? '—' : String(s).length <= 10
  ? new Date(String(s) + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : new Date(s).toLocaleDateString('en-GB', { timeZone: FARM_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
export const daysTo = s => Math.round((parseYmd(String(s).slice(0, 10)) - parseYmd(farmToday())) / 864e5);   // from the farm's today
export const show = v => v == null || v === '' || (Array.isArray(v) && !v.length) ? '—' : Array.isArray(v) ? v.join(', ') : String(v);
export const qtyText = (q, unit) => q == null ? '—' : unit === 'kg' && Math.abs(q) < 1 && q !== 0 ? `${num(q * 1000, Math.abs(q) < 0.01 ? 2 : 0)} g` : unit === 'ml' && Math.abs(q) >= 1000 ? `${num(q / 1000, 2)} L` : unit === 'g' && Math.abs(q) >= 1000 ? `${num(q / 1000, 2)} kg`
  : `${num(q, Math.abs(q) < 10 ? 2 : Math.abs(q) < 100 ? 1 : 0)} ${unit || ''}`.trim();
export const n2 = v => num(v, Number(v) % 1 ? 2 : 0);
export const errText = e => String(e?.message || e).replace(/^\d+ /, '');

// an expiry as a pill: red when past or within 30 days, amber within 90
export function expiryPill(s) {
  if (!s) return null;
  const d = daysTo(s);
  const pill = el('span', 'pill ' + (d < 30 ? 'bad' : d < 90 ? 'warn' : 'ok'), d < 0 ? `expired ${day(s)}` : `expires ${day(s)}`);
  pill.title = d < 0 ? 'Past its expiry: do not use it.' : `${d} days left`;
  return pill;
}

// the words of the new value that the old one does not have, marked (the owner's "highlighted text")
export function marked(oldV, newV) {
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
export async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
  return new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
}
export const encPath = path => path.split('/').map(encodeURIComponent).join('/');
// a photo is signed from its own bucket: product-labels, or farm-gallery for one picked from the gallery (0265)
const signed = new Map();
export async function photoUrl(ph) {
  const bucket = ph.bucket || 'product-labels', key = bucket + '/' + ph.path;
  if (signed.has(key)) return signed.get(key);
  try {
    const r = await api(`/storage/v1/object/sign/${bucket}/` + encPath(ph.path), { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }), quiet: true });
    const u = r?.signedURL ? URL_BASE + '/storage/v1' + r.signedURL : null;
    if (u) signed.set(key, u);
    return u;
  } catch { return null; }
}
