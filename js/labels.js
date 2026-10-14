// ═══════════════════════════════════════════════════════════════════════════
// Batch labels (migration 0234, console 0.7.254) — one label a batch, staked at
// its table, and the same code written on its crates.
//
// lot_labels gives each batch its lot code if it has none yet (a running
// number per farm and year, never changed) and returns what goes printed
// beside it. The sheet opens in a window of its own: A4, 8 labels of
// 99.1 × 67.7 mm (the common 8-up sticker sheet), with cut lines for plain
// paper. The QR holds https://brain.nkd.farm/#/lot/<batch id>: Naked Brain's
// scanner opens the batch's card, a phone's own camera opens the app there.
// What a person needs without a phone is printed big: the lot, the crop, the
// table, and the harvest week in the crop's colour, readable from the path.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { toast, cropHue } from './ui.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
const SCAN_URL = 'https://brain.nkd.farm/#/lot/';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const nice = s => s ? day(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
// ISO week, as the farm counts them
function isoWeek(s) {
  const d = day(s); if (!d) return null;
  const t = new Date(d); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
const CATEGORY = { fruiting_vines: 'Fruiting · vine', fruiting_bush: 'Fruiting', vines: 'Fruiting · vine', fruiting: 'Fruiting',
                   leafy: 'Leafy', mixed_leafy: 'Leafy mix', herbs: 'Herb', microgreens: 'Microgreens' };

// Opens the window at once, from the click itself (a window opened after a wait is blocked as a pop-up),
// then asks for the codes and draws the sheet in it.
export async function printLabels(planIds) {
  const ids = [...new Set((planIds || []).filter(Boolean))];
  if (!ids.length) { toast('No batch to print', 'bad'); return null; }
  const w = window.open('', '_blank');
  if (!w) { toast('The browser blocked the label window: allow pop-ups for this site', 'bad'); return null; }
  w.document.write('<p style="font:14px Inter,system-ui,sans-serif;padding:24px">Giving the batches their lot codes…</p>');
  try {
    const labels = await rpc('lot_labels', { p_plans: ids });
    if (!labels.length) { w.close(); toast('Nothing to print: a proposed or cancelled batch gets no label', 'bad'); return labels; }
    w.document.open(); w.document.write(labelSheet(labels)); w.document.close();
    return labels;
  } catch (e) { w.close(); toast(e.message, 'bad'); return null; }
}

function label(l) {
  const hue = cropHue(l.category);
  const wkFrom = isoWeek(l.harvest_from), wkTo = isoWeek(l.harvest_to);
  const weeks = wkFrom == null ? '—' : wkTo == null || wkTo === wkFrom ? `wk ${wkFrom}` : `wk ${wkFrom}–${wkTo}`;
  const start = l.nursery === 'external'
    ? (l.received ? `Seedlings in ${nice(l.received)}` : 'Seedlings bought in')
    : (l.sow ? `Sown ${nice(l.sow)}` : null);
  const plants = l.plants ? `${Math.round(Number(l.plants)).toLocaleString('en-ZA')} plants` : '';
  return `<div class="lab" style="--h:${hue}">
    <div class="band"></div>
    <div class="qr" data-url="${esc(SCAN_URL + l.id)}"></div>
    <div class="top">
      <div class="k">LOT</div>
      <div class="code">${esc(l.lot_code)}</div>
      <div class="crop">${esc(l.crop)}</div>
      <div class="var">${esc([l.variety, CATEGORY[l.category] || l.category].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="place"><b>${esc(l.zone)}</b> · ${esc(l.system)} · table <b>${esc(l.position)}</b><span>${esc(plants)}</span></div>
    <div class="dates">
      ${start ? `<span>${esc(start)}</span>` : ''}
      <span>${l.transplanted ? 'Transplanted' : 'Transplant'} <b>${esc(nice(l.transplant))}</b> · wk ${esc(isoWeek(l.transplant) ?? '—')}</span>
    </div>
    <div class="harvest"><span class="hk">HARVEST</span><b>${esc(weeks)}</b><span class="hd">${esc(nice(l.harvest_from))}${l.harvest_to && l.harvest_to !== l.harvest_from ? ' – ' + esc(nice(l.harvest_to)) : ''}${l.expected_kg ? ` · ~${esc(Math.round(Number(l.expected_kg)))} kg` : ''}</span></div>
    <div class="foot">${esc(l.farm)} · scan for cases, sprays and the next tasks</div>
  </div>`;
}

export function labelSheet(labels) {   // exported for a look at the sheet without the database
  const pages = [];
  for (let i = 0; i < labels.length; i += 8) pages.push(labels.slice(i, i + 8));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Batch labels · ${esc(labels.length)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #16161a; font-family: Inter, system-ui, sans-serif; }
  .how { max-width: 198mm; margin: 8mm auto 4mm; font-size: 12px; line-height: 1.45; }
  .how b.t { font-size: 15px; display: block; margin-bottom: 2mm; }
  .how button { font: inherit; font-weight: 700; padding: 6px 14px; border-radius: 999px; border: 1px solid #16161a; background: #16161a; color: #fff; cursor: pointer; }
  /* A4 8-up: 2 × 99.1 mm across, 4 × 67.7 mm down, 4.65 mm side and 13.1 mm top margins */
  .page { width: 210mm; height: 297mm; padding: 13.1mm 4.65mm 0; margin: 0 auto 6mm; display: grid;
          grid-template-columns: 99.1mm 99.1mm; column-gap: 2.5mm; grid-auto-rows: 67.7mm; align-content: start;
          box-shadow: 0 0 0 1px #ddd; }
  .lab { position: relative; overflow: hidden; border: 0.2mm dashed #bbb; padding: 3.5mm 3.5mm 3mm 6mm;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .band { position: absolute; left: 0; top: 0; bottom: 0; width: 3mm; background: hsl(var(--h) 45% 42%); }
  .qr { position: absolute; right: 3.5mm; top: 3.5mm; width: 27mm; height: 27mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .top { margin-right: 30mm; min-height: 27mm; }
  .k { font-size: 2.4mm; letter-spacing: .4mm; color: #555; font-weight: 700; }
  .code { font: 800 9mm/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .2mm; margin: .6mm 0 1.4mm; }
  .crop { font-size: 5mm; font-weight: 800; line-height: 1.05; }
  .var { font-size: 2.8mm; color: #444; margin-top: .6mm; }
  .place { font-size: 3.1mm; margin-top: 1.6mm; display: flex; gap: 2mm; }
  .place span { margin-left: auto; color: #444; }
  .dates { font-size: 2.8mm; margin-top: 1mm; display: flex; gap: 3mm; flex-wrap: wrap; color: #222; }
  .harvest { margin-top: 1.8mm; display: flex; align-items: baseline; gap: 2mm; padding: 1.2mm 2mm; border-radius: 1.2mm;
             background: hsl(var(--h) 45% 42%); color: #fff; }
  .harvest .hk { font-size: 2.4mm; letter-spacing: .3mm; font-weight: 700; }
  .harvest b { font-size: 5mm; }
  .harvest .hd { font-size: 2.8mm; margin-left: auto; }
  .foot { position: absolute; left: 6mm; right: 3.5mm; bottom: 2.2mm; font-size: 2.2mm; color: #666; }
  @media print { .how { display: none; } .page { margin: 0; box-shadow: none; break-after: page; } .page:last-child { break-after: auto; } }
</style></head><body>
<div class="how">
  <b class="t">${esc(labels.length)} batch label${labels.length === 1 ? '' : 's'}</b>
  Print at <b>100 % (Actual size)</b>, not "fit to page". The sheet is the common A4 8-up label (99.1 × 67.7 mm);
  for the greenhouse, waterproof polyester or vinyl labels last a crop. On plain paper, cut along the dashed lines and laminate.
  Stake the label at the table so the QR faces the path; write the lot code on every crate of its harvest.
  <p><button onclick="print()">Print</button></p>
</div>
${pages.map(p => `<div class="page">${p.map(label).join('')}</div>`).join('')}
<script src="${QR_LIB}"></script>
<script>
  // each QR drawn as an SVG of its own modules: sharp at any printer resolution
  document.querySelectorAll('.qr').forEach(box => {
    if (typeof qrcode !== 'function') { box.textContent = 'QR not loaded'; return; }
    const q = qrcode(0, 'M'); q.addData(box.dataset.url); q.make();
    const n = q.getModuleCount(), m = 2;
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * m) + ' ' + (n + 2 * m) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) s += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    box.innerHTML = s + '"/></svg>';
  });
</script>
</body></html>`;
}
