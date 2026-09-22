// ═══════════════════════════════════════════════════════════════════════════
// IPM — sticky traps, their counts, the trap rounds (migration 0067, 0.7.64)
//
// Every sticky trap has a code that says where it hangs (3B8: zone 3, row B,
// 8 m from the corridor). The weekly trap round on the phone photographs
// each trap with its code, counts the insects and sends the readings here.
// This page shows, per zone, every trap with its last count, the change
// against the previous round, the trend, and the photo; the rounds on the
// go; the farm's week-by-week totals; and lets a manager add or move traps
// and set the watch / over thresholds. A count over the threshold has
// already raised an issue.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, drawer, field, input, selectBox, toast, busy, num, shortDate, confirmDrawer } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PESTS = [['', '—'], ['whitefly', 'Whitefly'], ['thrips', 'Thrips'], ['fungus_gnat', 'Fungus gnats'],
               ['aphid', 'Aphids'], ['leafminer', 'Leaf miners'], ['moth', 'Moths'], ['other', 'Other / mixed']];
const pestLabel = v => (PESTS.find(p => p[0] === v) || [v, v || '—'])[1];

let farm = null, data = null, mount = null;

export async function renderIpm(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the traps…'));
  try { data = await rpc('ipm', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

const when = ts => ts ? new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—';
const level = (n, th) => n == null ? '' : n >= th.over ? 'over' : n >= th.watch ? 'watch' : 'ok';

function paint() {
  mount.textContent = '';
  const th = data.threshold || { watch: 25, over: 50 };
  const traps = data.zones.flatMap(z => z.traps.map(t => ({ ...t, zone: z })));
  const active = traps.filter(t => t.active);
  const over = active.filter(t => level(t.last?.total, th) === 'over');
  const watch = active.filter(t => level(t.last?.total, th) === 'watch');
  const stale = active.filter(t => !t.last || (Date.now() - new Date(t.last.read_at)) > 10 * 86400000);

  const add = data.may_edit ? el('button', 'btn btn-primary', 'Add a trap') : null;
  if (add) add.onclick = () => editTrap(null);
  const thr = data.may_edit ? el('button', 'btn', `Thresholds ${th.watch} / ${th.over}`) : el('span', 'pill', `watch ${th.watch} · over ${th.over}`);
  if (data.may_edit) thr.onclick = () => editThreshold(th);
  mount.append(pageHead('IPM',
    'Sticky traps, counted every round. A trap over the threshold has raised an issue; ' +
    'the round itself is the procedure "IPM: sticky trap round", one task per zone every Monday.', thr, add));

  // ── the numbers ──
  const tiles = el('div', 'tiles ipm-tiles');
  const tile = (n, label, cls) => {
    const t = el('div', 'tile' + (cls ? ' ' + cls : ''));
    const body = el('div', 'tile-body');
    body.append(el('div', 'tile-value', String(n)), el('div', 'tile-label', label));
    t.append(body);
    tiles.append(t);
  };
  tile(active.length, `trap${active.length === 1 ? '' : 's'} hung`);
  tile(over.length, `over ${th.over}`, over.length ? 'is-bad' : '');
  tile(watch.length, `to watch (≥ ${th.watch})`, watch.length ? 'is-warn' : '');
  tile(stale.length, 'not read in 10 days', stale.length ? 'is-warn' : '');
  mount.append(tiles);

  // ── week by week ──
  if ((data.weeks || []).length) {
    const c = el('div', 'card');
    const head = el('div', 'row'); head.style.padding = 'var(--space-3) var(--space-4)';
    head.append(el('b', null, 'Week by week'), el('span', 'hint', ' · insects on all traps, and the busiest trap'));
    c.append(head);
    c.append(table([
      { key: 'week', label: 'Week of', fmt: shortDate },
      { key: 'traps', label: 'Traps read', align: 'right' },
      { key: 'total', label: 'Insects', align: 'right', fmt: v => num(v, 0) },
      { key: 'top', label: 'Busiest', align: 'right', fmt: (v, r) => `${r.top_code} · ${num(v, 0)}` },
    ], data.weeks.slice().reverse()));
    mount.append(c);
  }

  // ── the traps, zone by zone ──
  data.zones.filter(z => z.traps.length || true).forEach(z => {
    const c = el('div', 'card');
    const head = el('div', 'row'); head.style.padding = 'var(--space-3) var(--space-4)';
    head.append(el('b', null, z.name), el('span', 'hint', ` · ${z.traps.filter(t => t.active).length} trap${z.traps.filter(t => t.active).length === 1 ? '' : 's'}`));
    if (data.may_edit) {
      const b = el('button', 'btn btn-sm btn-ghost', '+ trap here');
      b.onclick = () => editTrap(null, z);
      head.append(el('div', 'spacer'), b);
    }
    c.append(head);
    if (!z.traps.length) { c.append(el('div', 'empty', 'No trap in this zone yet.')); mount.append(c); return; }
    c.append(table([
      { key: 'code', label: 'Trap', fmt: (v, t) => {
          const b = el('div');
          b.append(el('span', 'ipm-code ' + t.colour, v));
          b.append(el('div', 'hint', [t.row_label ? 'row ' + t.row_label : null, t.metres != null ? `${num(t.metres, 0)} m from the corridor` : null,
                                      t.installed_at ? 'hung ' + shortDate(t.installed_at) : null].filter(Boolean).join(' · ')));
          return b; } },
      { key: 'last', label: 'Last count', align: 'right', fmt: v => {
          if (!v) return el('span', 'hint', 'not read yet');
          const b = el('div');
          b.append(el('b', 'ipm-' + level(v.total, th), num(v.total, 0)));
          b.append(el('div', 'hint', when(v.read_at) + (v.replaced ? ' · replaced' : '')));
          return b; } },
      { key: 'previous', label: 'Change', align: 'right', fmt: (v, t) => {
          if (v == null || !t.last) return '—';
          const d = t.last.total - v;
          const s = el('span', d > 0 ? 'up' : d < 0 ? 'down' : 'hint', (d > 0 ? '+' : '') + d);
          s.title = `previous ${v}`;
          return s; } },
      { key: 'trend', label: 'Trend', fmt: (v, t) => sparkline(v || [], th) },
      { key: 'last', label: 'Mostly', fmt: v => v ? pestLabel(v.pest) + (v.corrected ? '' : v.algo_total != null ? ' · phone count' : '') : '—' },
      { key: 'last', label: 'Photo', fmt: (v, t) => {
          if (!v?.photo_data) return '—';
          const im = el('img', 'ipm-thumb'); im.src = v.photo_data; im.alt = `trap ${t.code}`;
          im.onclick = e => { e.stopPropagation(); openReading(t, v); };
          return im; } },
      { key: 'active', label: 'Status', fmt: (v, t) => el('span', 'pill' + (v ? (level(t.last?.total, th) === 'over' ? ' bad' : level(t.last?.total, th) === 'watch' ? ' warn' : ' ok') : ''),
                                                        v ? (level(t.last?.total, th) || 'no reading') : 'taken down') },
    ], z.traps, { onRow: t => data.may_edit ? editTrap(t, z) : (t.last ? openReading(t, t.last) : null),
                  rowClass: t => t.active ? '' : 'off' }));
    mount.append(c);
  });

  if ((data.unzoned || []).length) {
    mount.append(el('div', 'note warn', `${data.unzoned.length} trap${data.unzoned.length > 1 ? 's' : ''} without a zone: ` +
      data.unzoned.map(t => t.code).join(', ') + '. Open each one and give it a zone, or the round will not find it.'));
  }

  // ── the rounds ──
  const rc = el('div', 'card');
  const rh = el('div', 'row'); rh.style.padding = 'var(--space-3) var(--space-4)';
  rh.append(el('b', null, 'Trap rounds'), el('span', 'hint', ' · the last two weeks and the next two'));
  rc.append(rh);
  rc.append(table([
    { key: 'date', label: 'Day', fmt: shortDate },
    { key: 'area', label: 'Zone' },
    { key: 'status', label: 'Status', fmt: (v, r) => el('span', 'pill' + (v === 'done' ? ' ok' : new Date(r.date) < new Date(data.today) ? ' bad' : ''),
                                                       v === 'done' ? `done ${when(r.done_at)}` : new Date(r.date) < new Date(data.today) ? 'overdue' : v) },
    { key: 'readings', label: 'Traps read', align: 'right', fmt: (v, r) => `${v} / ${r.traps}` },
    { key: 'workers', label: 'Who', fmt: v => (v || []).join(', ') || '—' },
  ], data.rounds, { empty: 'No round scheduled — is the procedure "IPM: sticky trap round" approved, and the zones active?' }));
  mount.append(rc);

  // ── the latest photos ──
  if ((data.recent || []).some(r => r.photo_data)) {
    const gc = el('div', 'card');
    const gh = el('div', 'row'); gh.style.padding = 'var(--space-3) var(--space-4)';
    gh.append(el('b', null, 'Latest readings'));
    gc.append(gh);
    const grid = el('div', 'ipm-gallery');
    data.recent.filter(r => r.photo_data).forEach(r => {
      const fig = el('figure', 'ipm-fig');
      const im = el('img'); im.src = r.photo_data; im.alt = `trap ${r.trap}`;
      fig.append(im, el('figcaption', null, `${r.trap} · ${num(r.total, 0)} · ${when(r.read_at)}`));
      fig.onclick = () => openReading({ code: r.trap }, r);
      grid.append(fig);
    });
    gc.append(grid);
    mount.append(gc);
  }
}

// last ten readings as a small line, the threshold as a dotted rule
function sparkline(points, th) {
  if (points.length < 2) return el('span', 'hint', points.length ? 'one reading' : '—');
  const w = 110, h = 28, pad = 3;
  const ys = points.map(p => Number(p.total));
  const max = Math.max(...ys, th.over), min = 0, span = max - min || 1;
  const xy = ys.map((y, i) => [pad + i * (w - 2 * pad) / (ys.length - 1), h - pad - (y - min) * (h - 2 * pad) / span]);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('class', 'ipm-spark'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${ys.join(', ')} insects over ${ys.length} readings`);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = points.map(p => `${when(p.read_at)}: ${p.total}`).join('\n');
  const rule = document.createElementNS(SVG_NS, 'line');
  const ry = h - pad - (th.over - min) * (h - 2 * pad) / span;
  rule.setAttribute('x1', pad); rule.setAttribute('x2', w - pad); rule.setAttribute('y1', ry); rule.setAttribute('y2', ry);
  rule.setAttribute('class', 'ipm-rule');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  const dot = document.createElementNS(SVG_NS, 'circle');
  const [lx, ly] = xy[xy.length - 1];
  dot.setAttribute('cx', lx.toFixed(1)); dot.setAttribute('cy', ly.toFixed(1)); dot.setAttribute('r', '2.4');
  svg.append(title, rule, line, dot);
  return svg;
}

// ── one reading: the photo, the counts, a correction ───────────────────────
function openReading(t, r) {
  const d = drawer(`Trap ${t.code}`, `${when(r.read_at)} · ${num(r.total, 0)} insects` + (r.replaced ? ' · trap replaced' : ''));
  d.box.style.width = 'min(720px, 100vw)';
  if (r.photo_data) { const im = el('img', 'ipm-photo'); im.src = r.photo_data; im.alt = `trap ${t.code}`; d.body.append(im); }
  const c = r.counts || {};
  const facts = el('div', 'facts');
  const fact = (k, v) => { const f = el('div', 'fact'); f.append(el('span', 'fact-k', k), el('span', 'fact-v', v ?? '—')); facts.append(f); };
  fact('Counted', num(r.total, 0) + (r.corrected ? ' (corrected)' : r.algo_total != null ? ' by the phone' : ''));
  if (r.algo_total != null && r.corrected) fact('Phone said', num(r.algo_total, 0));
  fact('By size', ['tiny', 'small', 'medium', 'large'].filter(k => c[k] != null).map(k => `${k} ${c[k]}`).join(' · ') || '—');
  fact('Mostly', pestLabel(r.pest));
  if (r.confidence != null) fact('Card found', Math.round(r.confidence * 100) + ' %');
  if (r.notes) fact('Note', r.notes);
  d.body.append(facts);

  if (r.id) {
    d.body.append(el('div', 'sec-title', 'Correct it'));
    const total = input({ type: 'number', min: 0, step: 1, value: r.total });
    const pest = selectBox(PESTS, r.pest || '');
    const g = el('div', 'grid2'); g.append(field('Insects', total), field('Mostly', pest));
    d.body.append(g);
    const save = el('button', 'btn btn-primary', 'Save');
    save.onclick = async () => {
      busy(save, true, 'Saving…');
      try {
        await rpc('correct_trap_reading', { p_id: r.id, p_total: parseInt(total.value, 10) || 0, p_pest: pest.value || null });
        d.close(); toast('Reading corrected', 'ok'); await load();
      } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
    };
    d.footer.append(save);
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

// ── add or edit a trap ─────────────────────────────────────────────────────
function editTrap(t, zone) {
  const isNew = !t;
  const d = drawer(isNew ? 'Add a sticky trap' : `Trap ${t.code}`,
    'The code says where it hangs: zone number, row letter, metres from the corridor — 3B8. Write it on the trap.');
  const zones = data.zones.map(z => [z.id, z.name]);
  const zoneSel = selectBox(zones, t?.zone?.id ?? zone?.id ?? zones[0]?.[0]);
  const rowIn = input({ value: t?.row_label ?? '', placeholder: 'B', maxLength: 3 });
  const mIn = input({ type: 'number', min: 0, step: '0.5', value: t?.metres ?? '', placeholder: '8' });
  const code = input({ value: t?.code ?? '', placeholder: '3B8' });
  const suggest = () => {
    if (!isNew && t.code) return;
    const z = data.zones.find(x => x.id === zoneSel.value);
    const zn = z?.zone_number ?? '';
    const r = rowIn.value.trim().toUpperCase();
    const m = mIn.value !== '' ? Math.round(Number(mIn.value)) : '';
    if (zn !== '' && r && m !== '') code.value = `${zn}${r}${m}`;
  };
  zoneSel.onchange = suggest; rowIn.oninput = suggest; mIn.oninput = suggest;
  const colour = selectBox([['yellow', 'Yellow (most flying pests)'], ['blue', 'Blue (thrips)']], t?.colour ?? 'yellow');
  const wIn = input({ type: 'number', min: 5, step: '0.5', value: t?.width_cm ?? 25 });
  const hIn = input({ type: 'number', min: 5, step: '0.5', value: t?.height_cm ?? 10 });
  const hung = input({ type: 'date', value: t?.installed_at ?? '' });
  const notes = input({ value: t?.notes ?? '' });
  const active = selectBox([['true', 'Hung'], ['false', 'Taken down']], String(t?.active ?? true));
  d.body.append(
    field('Zone', zoneSel),
    (() => { const g = el('div', 'grid3'); g.append(field('Row', rowIn), field('Metres from the corridor', mIn), field('Code', code, 'Suggested from zone, row and metres; you can type your own.')); return g; })(),
    (() => { const g = el('div', 'grid3'); g.append(field('Colour', colour), field('Width cm', wIn, 'The phone uses the size to tell tiny from large insects.'), field('Height cm', hIn)); return g; })(),
    (() => { const g = el('div', 'grid2'); g.append(field('Hung on', hung), field('Status', active)); return g; })(),
    field('Notes', notes),
  );
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', isNew ? 'Add trap' : 'Save');
  save.onclick = async () => {
    if (!code.value.trim()) { toast('A trap needs a code', 'bad'); code.focus(); return; }
    busy(save, true, 'Saving…');
    try {
      await rpc('save_sticky_trap', { p: {
        id: t?.id ?? null, farm_id: farm.id, zone_id: zoneSel.value, code: code.value.trim(),
        row_label: rowIn.value.trim(), metres: mIn.value, colour: colour.value,
        width_cm: wIn.value, height_cm: hIn.value, installed_at: hung.value, notes: notes.value,
        active: active.value === 'true',
      } });
      d.close(); toast(isNew ? `Trap ${code.value.trim().toUpperCase()} added — sync the phones` : 'Trap saved', 'ok'); await load();
    } catch (e) { busy(save, false, isNew ? 'Add trap' : 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

function editThreshold(th) {
  const d = drawer('Count thresholds', 'Insects on one trap in one reading. Over raises an issue; watch is a warning on this page.');
  const watch = input({ type: 'number', min: 0, step: 1, value: th.watch });
  const over = input({ type: 'number', min: 0, step: 1, value: th.over });
  const g = el('div', 'grid2'); g.append(field('Watch from', watch), field('Over (issue) from', over));
  d.body.append(g, el('div', 'hint', 'Typical: whitefly on yellow cards, 20–30 a week is worth a look, 50 means act. Adjust to what your traps normally show.'));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save');
  save.onclick = async () => {
    busy(save, true, 'Saving…');
    try {
      await rpc('save_ipm_threshold', { p_farm: farm.id, p_watch: parseInt(watch.value, 10) || 0, p_over: parseInt(over.value, 10) || 0 });
      d.close(); toast('Thresholds saved — sync the phones', 'ok'); await load();
    } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
