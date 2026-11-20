// FarmNet recipes: a card for each (its EC and pH targets drawn on a scale, its fertiliser channels), and a
// drawer that shows the recipe in full and lets the farm's Admin and Farm manager change its EC target, its pH
// target and its channel ratios (owner, 20 Nov 2026: "possibility to edit recipes for farm managers and admin,
// clear recipes with visual as well"). The function `farmnet` (formula_set) reads the recipe again, changes only
// those values within FarmNet's own limits, sends the rest back as it was, and logs the command.
import { el, drawer, field, toast, busy, confirmDrawer, loading } from '../ui.js';
import { ask, bad, num, send } from './shell.js';

// the scales the cards draw on; the band is where a hydroponic solution usually sits
export const EC_SCALE = { lo: 0, hi: 4, band: [1, 2.6], unit: 'mS' };
export const PH_SCALE = { lo: 4, hi: 8, band: [5.5, 6.5], unit: '' };
const MODES = { 0: 'Ratio dilution', 1: 'Fixed flow', 2: 'Manual', 3: 'PID + ratio (automatic)' };

// FarmNet's one-line summary of a recipe, in English or in Chinese:
// "Water Source:Fismart-S,Ctrl:PID+Ratio, EC:1.50mS,pH:6.00,Fert. Ch.:Acid  A  B  C  D "
export function readInf(inf) {
  const s = String(inf || '').replace(/\s+/g, ' ');
  const m = re => (s.match(re) || [])[1];
  const ch = m(/(?:Fert\. ?Ch\.|注肥通道)\s*[:：]\s*(.*)$/i);
  return {
    source: (m(/(?:Water Source|水源)\s*[:：]\s*([^,，]+)/i) || '').trim(),
    ctrl: (m(/(?:Ctrl|控制)\s*[:：]\s*([^,，]+)/i) || '').trim().replace('比例', 'Ratio'),
    ec: num(m(/EC\s*[:：]\s*([\d.]+)/i)),
    ph: num(m(/pH\s*[:：]\s*([\d.]+)/i)),
    channels: ch ? ch.trim().split(' ').filter(Boolean).map(x => (x === '酸' ? 'Acid' : x)) : [],
  };
}

// a value on its scale: the usual band shaded, the target as a marker, and (optional) what is measured now
export function gauge(scale, target, now) {
  const g = el('div', 'ir-gauge');
  const pos = v => `${Math.max(0, Math.min(100, ((v - scale.lo) / (scale.hi - scale.lo)) * 100))}%`;
  const band = el('div', 'ir-gauge-band');
  band.style.left = pos(scale.band[0]); band.style.width = `calc(${pos(scale.band[1])} - ${pos(scale.band[0])})`;
  g.append(band);
  if (target !== null && target !== undefined) { const t = el('div', 'ir-gauge-target'); t.style.left = pos(target); t.title = `target ${target}`; g.append(t); }
  if (now !== null && now !== undefined) { const n = el('div', 'ir-gauge-now'); n.style.left = pos(now); n.title = `now ${now}`; g.append(n); }
  const ends = el('div', 'ir-gauge-ends');
  ends.append(el('span', null, String(scale.lo)), el('span', null, `${scale.hi}${scale.unit ? ' ' + scale.unit : ''}`));
  const w = el('div', 'ir-gauge-wrap'); w.append(g, ends);
  return w;
}

const chanClass = n => `ir-ch ir-ch-${/^acid$/i.test(n) ? 'acid' : String(n).toLowerCase().replace(/[^a-z0-9]/g, '') || 'x'}`;

// the card of one recipe in the grid
export function recipeCard(r, colourOf, usedBy, inMixer, onOpen) {
  const info = readInf(r.INF);
  const k = el('button', 'ir-recipe' + (inMixer ? ' is-live' : ''));
  k.type = 'button';
  k.style.setProperty('--rc', colourOf);
  const head = el('div', 'ir-recipe-head');
  head.append(el('span', 'ir-dot'), el('b', null, r.NM || `Recipe ${r.ID}`));
  if (inMixer) head.append(el('span', 'pill ok', 'In the mixer now'));
  const nums = el('div', 'ir-recipe-nums');
  const big = (v, u, l) => { const b = el('div', 'ir-big'); b.append(el('span', 'ir-big-v', v === null ? '—' : v.toFixed(2)), el('span', 'ir-big-u', u), el('span', 'ir-big-l', l)); return b; };
  nums.append(big(info.ec, 'mS', 'EC target'), big(info.ph, '', 'pH target'));
  const chans = el('div', 'ir-chans');
  info.channels.forEach(n => chans.append(el('span', chanClass(n), n)));
  if (!info.channels.length) chans.append(el('span', 'hint', 'no channel listed'));
  k.append(head, nums, gauge(EC_SCALE, info.ec), gauge(PH_SCALE, info.ph), chans,
    el('div', 'hint ir-recipe-foot', `${info.ctrl ? info.ctrl + ' · ' : ''}${usedBy.length ? 'used by ' + usedBy.join(', ') : 'no program uses it'}`));
  k.onclick = onOpen;
  return k;
}

// the name of a channel: the mixer's own list when FarmNet gives one; else the summary's order, but only when the
// summary lists exactly as many channels as the recipe has (one missing would shift every name onto the wrong
// channel, in an editor); else its number. The number is always shown beside it (chanNo).
function chanName(full, info, fc, i) {
  const mixer = (full.FISMART || []).find(f => Number(f.ID) === Number(full.LST)) || (full.FISMART || [])[0];
  const c = mixer?.CHAN?.[fc];
  const n = typeof c === 'string' ? c : c?.N;
  const fcl = Array.isArray(full.FCL) ? full.FCL : [];
  return n || (info.channels.length === fcl.length ? info.channels[i] : null) || `Ch ${Number(fc) + 1}`;
}
const chanNo = fc => `channel ${Number(fc) + 1}`;
const tankName = (list, id) => (list || []).find(t => Number(t.ID) === Number(id))?.N || (Number(id) === -1 ? 'none' : id === undefined ? '—' : `#${id}`);

// the drawer: the recipe in full; for the farm's Admin and Farm manager, its EC, pH and channel ratios to change
export async function openRecipe(ctx, c, r, usedBy) {
  const info = readInf(r.INF);
  let dirty = () => false;
  const d = drawer(r.NM || `Recipe ${r.ID}`, `${c.name} · as FarmNet holds it`, {
    guard: () => (dirty() ? confirmDrawer('Leave without saving?', 'The values you changed are not sent to FarmNet.', 'Leave') : true),
  });
  d.body.append(loading('Reading the recipe…'));
  let full;
  try { full = await ask(ctx.farm, 'formula_param', { id: c.id, proId: r.ID }); }
  catch (e) { d.body.textContent = ''; d.body.append(bad(e.message)); return; }
  d.body.textContent = '';
  if (!full || typeof full !== 'object') { d.body.append(bad('FarmNet sent no recipe.')); return; }

  const inputs = [];   // { label, read, from, unit, kind, fc? }
  const may = p => ctx.may && p && p.EEN !== false;
  const numInput = (value, lo, hi, dec) => {
    const i = el('input', 'input'); i.type = 'number'; i.value = value === null ? '' : Number(value).toFixed(dec);
    if (lo !== null) i.min = String(lo); if (hi !== null) i.max = String(hi);
    i.step = dec > 0 ? String(10 ** -dec) : '1';
    return i;
  };

  // EC and pH, large, on their scales
  const targets = el('div', 'ir-targets');
  [['EC', 'EC target', EC_SCALE, 'ec'], ['PH', 'pH target', PH_SCALE, 'ph']].forEach(([key, label, scale, kind]) => {
    const p = full[key];
    const v = num(p?.V) ?? info[kind];
    const box = el('div', 'ir-target');
    box.append(el('div', 'cx-kind-label ir-keep-case', label));
    const lo = num(p?.L), hi = num(p?.H), dec = Number.isInteger(p?.D) ? p.D : 2;
    if (may(p)) {
      const i = numInput(v, lo, hi, dec);
      const g = el('div', 'ir-gauge-slot'); g.append(gauge(scale, v));
      i.oninput = () => { g.replaceChildren(gauge(scale, i.value.trim() === '' ? v : Number(i.value))); };
      const row = el('div', 'ir-target-edit'); row.append(i, el('span', 'hint', `${p.U || scale.unit} · ${lo ?? '…'} – ${hi ?? '…'}`));
      box.append(row, g);
      inputs.push({ label, kind, from: v, unit: p.U || scale.unit, lo, hi, read: () => (i.value.trim() === '' ? v : Number(i.value)) });   // emptied = unchanged
    } else {
      const b = el('div', 'ir-big'); b.append(el('span', 'ir-big-v', v === null ? '—' : Number(v).toFixed(dec)), el('span', 'ir-big-u', p?.U || scale.unit));
      box.append(b, gauge(scale, v));
      if (ctx.may && p?.EEN === false) box.append(el('div', 'hint', 'FarmNet does not let this value be changed.'));
    }
    targets.append(box);
  });
  d.body.append(targets);

  // the channels: each one's share of the mix, drawn as a bar
  const fcl = Array.isArray(full.FCL) ? full.FCL : [];
  const sec = el('div', 'ir-section');
  sec.append(el('div', 'cx-kind-label', 'Fertiliser channels'));
  if (!fcl.length) sec.append(el('div', 'hint', 'FarmNet lists no channel for this recipe.'));
  const bars = el('div', 'ir-mix');
  const paintBars = () => {
    const vals = fcl.map((x, i) => { const inp = inputs.find(y => y.kind === 'ratio' && y.fc === x.FC); return inp ? inp.read() : num(x.FR) ?? 0; });
    const total = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) || 1;
    bars.replaceChildren(...fcl.map((x, i) => {
      const n = chanName(full, info, x.FC, i);
      const s = el('div', chanClass(n) + ' ir-mix-part');
      s.style.flexGrow = String(Math.max(0, vals[i]) / total);
      s.title = `${n}: ${vals[i]}`;
      s.textContent = vals[i] > 0 ? n : '';
      return s;
    }));
  };
  sec.append(bars);
  const list = el('div', 'ir-chan-list');
  fcl.forEach((x, i) => {
    const n = chanName(full, info, x.FC, i);
    const row = el('div', 'fc-param');
    const lab = el('span'); lab.append(el('span', chanClass(n), n), el('span', 'hint', ` ${chanNo(x.FC)}${x.TC !== undefined ? ' · stock tank ' + (Number(x.TC) + 1) : ''}`));
    row.append(lab);
    if (ctx.may) {
      const from = num(x.FR) ?? 0;
      const inp = numInput(from, 0, 100, 2);
      inp.oninput = paintBars;
      inputs.push({ label: `${n} (${chanNo(x.FC)}) ratio`, kind: 'ratio', fc: x.FC, from, unit: '', lo: 0, hi: 100, read: () => (inp.value.trim() === '' ? from : Number(inp.value)) });
      row.append(inp, el('span', 'hint', 'ratio'));
    } else row.append(el('b', null, show2(x.FR)), el('span'));
    list.append(row);
  });
  sec.append(list);
  d.body.append(sec);
  paintBars();

  // the rest, read only: how it mixes, where the water comes from and goes, who uses it
  const facts = el('div', 'ir-section');
  facts.append(el('div', 'cx-kind-label', 'How FarmNet mixes it'));
  const fact = (k, v) => { const r2 = el('div', 'fc-param'); r2.append(el('span', null, k), el('b', null, v ?? '—'), el('span')); facts.append(r2); };
  fact('Control', MODES[full.FMD] ?? info.ctrl ?? '—');
  fact('Mixer', tankName(full.FISMART, full.LST));
  fact('Raw water from', tankName(full.SRC, full.LWT ?? full.LWF));
  fact('Drain water back to', tankName(full.BACK, full.LBT));
  if (num(full.FPT) !== null || num(full.FST) !== null) fact('Clear water before · after fertiliser', `${num(full.FPT) ?? 0} s · ${num(full.FST) ?? 0} s`);
  if (num(full.SMRT) !== null) fact('Stirring before mixing', `${num(full.SMRT)} s`);
  fact('Used by', usedBy.length ? usedBy.join(', ') : 'no program');
  d.body.append(facts);

  const adv = el('details', 'ir-section');
  adv.append(el('summary', 'hint', 'Control tuning (changed on FarmNet only)'));
  const tune = [['EC allowed error', full.EAE, 'mS'], ['EC P · I · D', [full.EP, full.EI, full.ED].map(show2).join(' · ')],
    ['EC valve min · max', `${show2(full.EMIND)} · ${show2(full.EMAXD)} %`], ['pH allowed error', full.PAE],
    ['pH P · I · D', [full.PP, full.PI, full.PD].map(show2).join(' · ')], ['pH valve min · max', `${show2(full.PMIND)} · ${show2(full.PMAXD)} %`]];
  tune.forEach(([k, v, u]) => { const r2 = el('div', 'fc-param'); r2.append(el('span', null, k), el('b', null, `${show2(v)}${u ? ' ' + u : ''}`), el('span')); adv.append(r2); });
  d.body.append(adv);

  if (!ctx.may) { d.body.append(el('div', 'hint', 'Only the farm admin and farm manager change a recipe.')); return; }

  const changes = () => inputs.filter(x => Number.isFinite(x.read()) && x.read() !== x.from);
  dirty = () => changes().length > 0;
  const save = el('button', 'btn btn-primary', 'Save…');
  save.onclick = async () => {
    if (save.disabled) return;
    const nan = inputs.find(x => !Number.isFinite(x.read()));
    if (nan) { toast(`${nan.label}: not a number`, 'bad'); return; }
    const ch = changes();
    if (!ch.length) { toast('Nothing changed'); return; }
    const out = ch.find(x => (x.lo !== null && x.read() < x.lo) || (x.hi !== null && x.read() > x.hi));
    if (out) { toast(`${out.label} must be between ${out.lo ?? '…'} and ${out.hi ?? '…'}`, 'bad'); return; }
    const said = ch.map(x => `${x.label}: ${x.from} → ${x.read()}${x.unit ? ' ' + x.unit : ''}`).join(' · ');
    save.disabled = true;
    const who = usedBy.length ? ` ${usedBy.join(', ')} mix${usedBy.length === 1 ? 'es' : ''} with the new values from the next run.` : '';
    if (!(await confirmDrawer(`Change "${r.NM}" on FarmNet?`, `${said}.${who}`, 'Change it'))) { save.disabled = false; return; }
    const body = {};
    ch.forEach(x => { if (x.kind === 'ec') body.ec = x.read(); else if (x.kind === 'ph') body.ph = x.read(); else (body.ratios ||= []).push({ FC: x.fc, FR: x.read() }); });
    busy(save, true, 'Sending…');
    try {
      const res = await send(ctx.farm, 'formula_set', { id: c.id, proId: r.ID }, body);
      toast(`"${r.NM}" changed — FarmNet: ${res?.msg || 'OK'}`, 'ok');
    } catch (e) { toast(e.message, 'bad'); busy(save, false, 'Save…'); return; }
    dirty = () => false;
    d.close();
    setTimeout(ctx.redraw, 1200);
  };
  d.footer.append(save);
}

const show2 = v => { const n = num(v); return n === null ? (v ?? '—') : String(Number(n.toFixed(4))); };
