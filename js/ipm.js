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
import { rpc, fn, api, URL_BASE } from './api.js';
import { el, table, pageHead, drawer, field, input, selectBox, toast, busy, num, shortDate, confirmDrawer } from './ui.js';
import { openViewer } from './viewer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PESTS = [['', '—'], ['whitefly', 'Whitefly'], ['thrips', 'Thrips'], ['fungus_gnat', 'Fungus gnats'],
               ['shore_fly', 'Shore flies'], ['aphid', 'Aphids'], ['leafminer', 'Leaf miners'], ['moth', 'Moths'],
               ['beneficial', 'Natural enemies'], ['other', 'Other / mixed']];
const pestLabel = v => (PESTS.find(p => p[0] === v) || [v, v || '—'])[1];

let farm = null, data = null, mount = null;

export async function renderIpm(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the traps…'));
  try { const [d, cat] = await Promise.all([rpc('ipm', { p_farm: farm.id }), rpc('pest_catalog')]); data = d; data.catalog = cat; }
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
  mount.append(pageHead('Traps',
    'The sticky traps and their counts. They are counted during the daily scouting when the person opens the trap cards; ' +
    'a trap over the threshold has raised an issue. The curves are drawn by date, so a gap is a gap.', thr, add));

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

  // ── what the AI saw on the photos, last four weeks ──
  const sp = data.species || [];
  if (sp.length || data.ai_pending) {
    const c = el('div', 'card');
    const head = el('div', 'row'); head.style.padding = 'var(--space-3) var(--space-4)';
    head.append(el('b', null, 'Species on the traps'),
      el('span', 'hint', ' · from the trap photos somebody asked the AI about, last four weeks' +
        (data.ai_pending ? ` · ${data.ai_pending} photo${data.ai_pending > 1 ? 's' : ''} waiting` : '')));
    c.append(head);
    if (sp.length) c.append(speciesTable(sp, true));
    else c.append(el('div', 'empty', 'No photo named yet.'));
    mount.append(c);
  } else if (!data.ai_ready) {
    mount.append(el('div', 'note', 'The AI is off: paste an Anthropic API key in Settings › Integrations, then open any trap photo and press Ask the AI.'));
  }

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
      { key: 'trend', label: 'Trend', fmt: (v, t) => sparkline(v || [], th, t.installed_at) },
      { key: 'last', label: 'Mostly', fmt: v => {
          if (!v) return '—';
          const tag = (v.tags || [])[0];
          if (tag) return tag.label || tag.code;
          if (v.ai_status === 'done' && v.ai_pest) return el('span', 'hint', pestLabel(v.ai_pest) + ' · AI');
          if (v.pest) return pestLabel(v.pest);
          return el('span', 'hint', 'not named yet'); } },
      { key: 'last', label: 'Photo', fmt: (v, t) => {
          if (!v?.photo_data) return '—';
          const im = el('img', 'ipm-thumb'); im.src = v.photo_data; im.alt = `trap ${t.code}`;
          im.onclick = e => { e.stopPropagation(); viewReading(t, v, z); };
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
  rh.append(el('b', null, 'Scouting rounds'), el('span', 'hint', ' · the last two weeks and the next two, zone by zone'));
  rc.append(rh);
  rc.append(table([
    { key: 'date', label: 'Day', fmt: shortDate },
    { key: 'area', label: 'Zone' },
    { key: 'status', label: 'Status', fmt: (v, r) => el('span', 'pill' + (v === 'done' ? ' ok' : new Date(r.date) < new Date(data.today) ? ' bad' : ''),
                                                       v === 'done' ? `done ${when(r.done_at)}` : new Date(r.date) < new Date(data.today) ? 'overdue' : v) },
    { key: 'readings', label: 'Traps read', align: 'right', fmt: (v, r) => `${v} / ${r.traps}` },
    { key: 'workers', label: 'Who', fmt: v => (v || []).join(', ') || '—' },
  ], data.rounds, { empty: 'No scouting scheduled — is the procedure "Daily scouting: traps and plants" approved?' }));
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
      fig.append(im, el('figcaption', null, `${r.trap} · ${num(r.total, 0)} · ${when(r.read_at)}` +
        (r.ai_status === 'done' && r.ai_pest ? ` · ${pestLabel(r.ai_pest)}` : '')));
      fig.onclick = () => viewReading({ code: r.trap }, r, null);
      grid.append(fig);
    });
    gc.append(grid);
    mount.append(gc);
  }
}

// the last readings as a small line drawn by date — a gap over a weekend or a
// holiday shows as a gap (0096) — the threshold as a dotted rule
function sparkline(points, th, since) {
  if (points.length < 2) return el('span', 'hint', points.length ? 'one reading' : '—');
  const w = 120, h = 28, pad = 3;
  const ts = points.map(p => new Date(p.read_at).getTime());
  const t0 = Math.min(...ts, since ? new Date(since).getTime() : Infinity), t1 = Math.max(...ts);
  const span = (t1 - t0) || 1;
  const ys = points.map(p => Number(p.total));
  const max = Math.max(...ys, th.over), yspan = max || 1;
  const xy = points.map((p, i) => [pad + (ts[i] - t0) * (w - 2 * pad) / span, h - pad - ys[i] * (h - 2 * pad) / yspan]);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('class', 'ipm-spark'); svg.setAttribute('role', 'img');
  const days = Math.round(span / 864e5);
  svg.setAttribute('aria-label', `${ys.join(', ')} insects over ${days} day${days === 1 ? '' : 's'}`);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = points.map(p => `${when(p.read_at)}: ${p.total}`).join('\n');
  const rule = document.createElementNS(SVG_NS, 'line');
  const ry = h - pad - th.over * (h - 2 * pad) / yspan;
  rule.setAttribute('x1', pad); rule.setAttribute('x2', w - pad); rule.setAttribute('y1', ry); rule.setAttribute('y2', ry);
  rule.setAttribute('class', 'ipm-rule');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  svg.append(title, rule, line);
  xy.forEach(([x, y], i) => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1)); dot.setAttribute('r', i === xy.length - 1 ? '2.4' : '1.4');
    svg.append(dot);
  });
  return svg;
}

// ── one reading: the photo, the counts, a correction ───────────────────────
function openReading(t, r) {
  const d = drawer(`Trap ${t.code}`, `${when(r.read_at)} · ${num(r.total, 0)} insects` + (r.replaced ? ' · trap replaced' : ''));
  d.box.style.width = 'min(720px, 100vw)';
  if (r.photo_data) {
    const im = el('img', 'ipm-photo'); im.src = r.photo_data; im.alt = `trap ${t.code}`; d.body.append(im);
    // the full photo from the evidence bucket, when the phone uploaded one (Naked Brain 0.11.11)
    if (r.photo_path) {
      const link = el('a', 'linkish', 'Full photo…'); link.style.display = 'inline-block'; link.style.marginBottom = 'var(--space-3)';
      link.href = '#'; link.onclick = e => { e.preventDefault(); };
      d.body.append(link);
      fullPhotoUrl(r.photo_path).then(u => {
        if (!u) { link.textContent = 'Full photo not reachable'; return; }
        im.src = u; im.title = 'the full photo';
        link.textContent = 'Open the full photo in a new tab';
        link.href = u; link.target = '_blank'; link.rel = 'noopener'; link.onclick = null;
      }).catch(() => { link.textContent = 'Full photo not reachable'; });
    }
  }
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

  // what the AI saw on the photo
  const secAI = el('div', 'ipm-narrow');
  const paintAI = rr => {
    secAI.textContent = '';
    secAI.append(el('div', 'sec-title', 'Species, named by the AI'));
    if (rr.ai_status === 'done') {
      const list = Array.isArray(rr.species) ? rr.species : [];
      if (list.length) secAI.append(speciesTable(list, false));
      else secAI.append(el('div', 'hint', 'Nothing it could name.'));
      const meta = [rr.ai_total != null ? `${num(rr.ai_total, 0)} insects in all` : null,
                    rr.ai_quality && rr.ai_quality !== 'ok' ? 'photo ' + rr.ai_quality.replace('_', ' ') : null,
                    rr.ai_model, rr.ai_at ? when(rr.ai_at) : null].filter(Boolean).join(' · ');
      if (meta) secAI.append(el('div', 'hint', meta));
      if (rr.ai_notes) secAI.append(el('p', 'ipm-ai-notes', rr.ai_notes));
    } else if (rr.ai_status === 'queued') secAI.append(el('div', 'hint', 'Sent to the AI — the answer is on the page at the next reload.'));
    else if (rr.ai_status === 'failed') secAI.append(el('div', 'note bad', 'The AI could not answer: ' + (rr.ai_error || 'unknown error')));
    else if (rr.ai_status === 'no_key') secAI.append(el('div', 'hint', 'Not sent: no Anthropic API key. Paste one in Settings › Integrations.'));
    else if (!rr.photo_data) secAI.append(el('div', 'hint', 'No photo to send.'));
    else secAI.append(el('div', 'hint', 'Not asked yet.'));
  };
  paintAI(r);
  d.body.append(secAI);

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
  if (r.id && r.photo_data && data.may_write !== false) {
    const label = () => r.ai_status === 'done' ? 'Identify again' : 'Identify with AI';
    const ai = el('button', 'btn', label());
    ai.title = 'Send this photo to Claude (Anthropic) to name the species';
    ai.onclick = async () => {
      if (!data.ai_ready) { toast('Paste an Anthropic API key in Settings › Integrations first', 'bad'); return; }
      busy(ai, true, 'Asking the AI… about half a minute');
      try {
        await rpc('identify_trap_species', { p_id: r.id, p_force: true });
        const res = await fn('trap-species', { reading_id: r.id });
        if (!res?.ok) throw new Error(res?.error || 'no answer');
        Object.assign(r, res.reading);
        paintAI(r);
        busy(ai, false, label());
        toast('Species named', 'ok');
        load();
      } catch (e) { busy(ai, false, label()); toast(e.message, 'bad'); }
    };
    d.footer.append(ai);
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

// a signed URL (one hour) for a photo in the private evidence bucket; storage RLS
// lets a member of the farm read its own farm's folder
async function fullPhotoUrl(path) {
  const res = await api('/storage/v1/object/sign/evidence/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) });
  return res?.signedURL ? URL_BASE + '/storage/v1' + res.signedURL : null;
}

// the AI's species list: common name, taxon, group, count with a bar, confidence
function speciesTable(list, rolled) {
  const max = Math.max(...list.map(s => Number(s.count) || 0), 1);
  const cols = [
    { key: 'common', label: 'Species', fmt: (v, s) => {
        const b = el('div');
        b.append(el('b', null, v || s.name || '?'));
        b.append(el('div', 'hint', (v && s.name && s.name !== v ? s.name : '') + (s.beneficial ? (s.name ? ' · ' : '') + 'natural enemy' : '')));
        return b; } },
    { key: 'group', label: 'Group', fmt: v => pestLabel(v) },
    { key: 'count', label: 'Insects', align: 'right', fmt: (v, s) => {
        const w = el('div', 'ipm-bar-wrap');
        const bar = el('div', 'ipm-bar' + (s.beneficial ? ' good' : ''));
        bar.style.width = Math.max(2, Math.round((rolled ? 90 : 48) * (Number(v) || 0) / max)) + 'px';
        w.append(bar, el('span', null, num(v, 0)));
        return w; } },
  ];
  if (rolled) cols.push({ key: 'traps', label: 'On traps', align: 'right', fmt: (v, s) => `${v} · ${s.readings} reading${s.readings > 1 ? 's' : ''}` });
  cols.push({ key: 'confidence', label: 'Sure', align: 'right', fmt: v => v != null ? Math.round(Number(v) * 100) + ' %' : '—' });
  return table(cols, list);
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

// a reading in the viewer (0096): zoom, tags, the AI on request, compare with the zone's photos
function viewReading(t, r, zone) {
  const zoneId = zone?.id || t.zone_id;
  openViewer({
    farm, photo: { ...r, kind: 'trap', code: t.code, colour: t.colour, installed_at: t.installed_at, zone: zone?.name, taken_at: r.read_at },
    catalog: data.catalog || [], aiReady: data.ai_ready, mayWrite: data.may_write !== false,
    zonePhotos: zoneId ? () => rpc('zone_photos', { p_farm: farm.id, p_zone: zoneId }) : null,
    zoneId,
    openCases: async () => ((await rpc('cases', { p_farm: farm.id, p_include_closed: false })).cases || []).filter(c => !zoneId || c.zone_id === zoneId),
    onChange: () => load(),
  });
}
