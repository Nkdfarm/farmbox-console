// ═══════════════════════════════════════════════════════════════════════════
// The trap map, as parts for the scouting report (migration 0146, console 0.7.155; a kit since 0.7.174)
//
// Each zone (a bay at FarmBox1) drawn to scale, the long side across the page
// from the corridor, cut in half across its short side and in four along its
// length (Map size…). An area's colour is its worst trap this week — new insects
// a day against the farm's watch / over (0147); grey when no trap hangs there —
// and its arrow the trend against the week before. The dots are the traps where
// their code says they hang (1B6 = zone 1, row B, 6 m). Click an area, a dot or a
// line of the list: each trap with its 8 weeks, its latest photo, the AI note and
// the person's note, and its history.
// Since console 0.7.174 (owner, 30 Sept 2026: "remove the traps page, the information is available") there is no
// Traps page: `trapKit({ farm, data, reload })` hands the scouting report its pieces — a zone's map (small in each
// zone's health section, all of them in the All zones report), every trap's list, a trap's window with its history,
// Map size… and Traps and limits…. A kit per page copy, so two units drawn side by side do not share a farm.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, drawer, num, toast, busy, input, field, trapCheckPill } from './ui.js';
import { openViewer } from './viewer.js';
import { renderIpm } from './ipm.js';

const TONE_WORD = { red: 'over the threshold', orange: 'watch', green: 'low' };
const TREND = { up: '▲', down: '▼', flat: '–' };
const TREND_WORD = { up: 'rising against last week', down: 'falling against last week', flat: 'about the same as last week' };
const shortCode = c => String(c || '').replace(/D\d{4}(?:\d{4})?$/, '');
const d1 = v => num(v, Number(v) >= 10 ? 0 : 1);                                   // insects a day: 1 decimal under 10
const FAMILY = { whitefly: 'Whitefly', thrips: 'Thrips', fungus_gnat: 'Fungus gnats', shore_fly: 'Shore flies', aphid: 'Aphids',
                 leafminer: 'Leaf miners', moth: 'Moths', beneficial: 'Beneficials', other: 'Other' };
const dm = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const m1 = v => num(v, Number(v) % 1 ? 1 : 0);
const when = ts => ts ? new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';

export function trapKit(K) {
  const farm = K.farm, data = K.data || {};
  const load = () => K.reload?.();

  // the colours and marks, in one line
  function legend() {
    const th = data.threshold || {};
    const box = el('div', 'tm-legend');
    [['green', 'Low'], ['orange', `Watch · ${th.watch ?? '—'}+ a day`], ['red', `Over · ${th.over ?? '—'}+ a day`], ['none', 'No trap']]
      .forEach(([t, l]) => { const s = el('span', 'tm-key'); s.append(el('i', 'tm-sw ' + t), el('span', null, l)); box.append(s); });
    box.append(el('span', 'tm-key', '▲ rising · ▼ falling · – steady'));
    return box;
  }
  // a trap by its position (1B6), for its window from a trap card
  const spotOf = code => (data.spots || []).find(s => shortCode(s.code) === shortCode(code) || s.spot === shortCode(code));

  // ── one zone, to scale: the long side across, the corridor on the left ──
  function unitMap(u, spots) {
    const cfg = data.config;
    const card = el('div', 'card card-pad tm-unit');
    const title = el('div', 'row');
    const worst = u.cells.reduce((a, c) => rank(c.tone) > rank(a) ? c.tone : a, null);
    title.append(el('b', null, u.label), el('span', 'hint', `${spots.filter(s => s.active).length} trap${spots.filter(s => s.active).length === 1 ? '' : 's'}`));
    if (worst) title.append(el('span', 'pill ' + (worst === 'red' ? 'bad' : worst === 'orange' ? 'warn' : 'ok'), TONE_WORD[worst]));
    card.append(title);

    const wrap = el('div', 'tm-wrap');
    const grid = el('div', 'tm-grid');
    grid.style.aspectRatio = `${cfg.length_m} / ${cfg.width_m}`;
    grid.style.gridTemplateColumns = `repeat(${cfg.rows}, 1fr)`;          // along the length
    grid.style.gridTemplateRows = `repeat(${cfg.cols}, 1fr)`;             // across the width
    u.cells.forEach(c => {
      const b = el('button', 'tm-cell ' + (c.tone || 'none'));
      b.type = 'button';
      b.style.gridColumn = String(c.row + 1);
      b.style.gridRow = String(c.col + 1);
      const n = c.spots.length;
      b.append(el('span', 'tm-trend', c.trend ? TREND[c.trend] : ''), el('b', null, c.level != null ? d1(c.level) : ''),
               el('span', 'tm-n', n ? `${n} trap${n > 1 ? 's' : ''}` : ''));
      const rows = (c.letters || []).length ? `rows ${c.letters[0]}–${c.letters[c.letters.length - 1]}` : 'rows —';
      b.title = `${u.label} · ${rows} · ${num(c.from_m, 0)}–${num(c.to_m, 0)} m` + (c.level != null ? ` · ${d1(c.level)} new a day, ${TONE_WORD[c.tone]}` : n ? ' · not read in the last 10 days' : ' · no trap') +
                (c.trend ? ` · ${TREND_WORD[c.trend]}` : '');
      b.onclick = () => openArea(u, c);
      grid.append(b);
    });
    // the traps where their code says they hang
    const letters = u.letters || [];
    spots.filter(s => s.active && s.metres != null && letters.includes(s.row)).forEach(s => {
      const d = el('button', 'tm-dot ' + (s.tone || 'none'));
      d.type = 'button';
      d.style.left = `${Math.min(98, Math.max(2, 100 * Number(s.metres) / Number(cfg.length_m)))}%`;
      d.style.top = `${100 * (letters.indexOf(s.row) + 0.5) / letters.length}%`;
      d.title = `${shortCode(s.code)} · ${s.level != null ? d1(s.level) + ' new a day' : 'not read lately'}`;
      d.onclick = e => { e.stopPropagation(); openSpots(`${u.label} · trap ${shortCode(s.code)}`, [s]); };
      grid.append(d);
    });
    wrap.append(grid);
    const axis = el('div', 'tm-axis');
    axis.append(el('span', null, '0 m · corridor'), el('span', null, `${num(cfg.length_m, 0)} m`));
    const side = el('div', 'tm-side');
    for (let c = 0; c < cfg.cols; c++) {
      const part = letters.slice(Math.floor(c * letters.length / cfg.cols), Math.floor((c + 1) * letters.length / cfg.cols));
      side.append(el('span', null, part.length ? `${part[0]}–${part[part.length - 1]}` : '—'));
    }
    const body = el('div', 'tm-body');
    body.append(side, wrap);
    card.append(body, axis);
    return card;
  }
  const rank = t => ({ red: 3, orange: 2, green: 1 })[t] || 0;

  function openArea(u, c) {
    const rows = (c.letters || []).length ? `rows ${c.letters[0]}–${c.letters[c.letters.length - 1]}` : 'rows —';
    const spots = (data.spots || []).filter(s => c.spots.includes(s.spot));
    openSpots(`${u.label} · ${rows} · ${num(c.from_m, 0)}–${num(c.to_m, 0)} m`, spots);
  }

  // ── the traps of an area, a dot or a line ──
  function openSpots(title, spots) {
    const d = drawer(title, spots.length ? `${spots.length} trap${spots.length > 1 ? 's' : ''}` : 'No trap hangs here');
    d.box.style.width = 'min(720px, 100vw)';
    if (!spots.length) d.body.append(el('div', 'hint', 'Hang a card here and photograph it in the next scouting: it is added from its code.'));
    spots.forEach(s => d.body.append(spotCard(s)));
    const close = el('button', 'btn', 'Close');
    close.onclick = () => d.close();
    d.footer.append(close);
  }

  function spotCard(s) {
    const card = el('div', 'card card-pad tm-spot');
    const head = el('div', 'row');
    head.append(el('span', 'ipm-code ' + (s.colour || ''), shortCode(s.code)),
                el('span', 'hint', `card since ${dm(s.hung_on)}${s.active ? '' : ' · taken down'}`));
    if (s.tone) head.append(el('span', 'pill ' + (s.tone === 'red' ? 'bad' : s.tone === 'orange' ? 'warn' : 'ok'),
                               `${d1(s.level)} new a day · ${TONE_WORD[s.tone]}`));
    if (s.trend) head.append(el('span', 'tm-trend-word', `${TREND[s.trend]} ${TREND_WORD[s.trend]}`));
    card.append(head);

    const body = el('div', 'tm-spot-body');
    const photo = el('button', 'tm-photo');
    photo.type = 'button';
    if (s.photo_data) { const im = el('img'); im.src = s.photo_data; im.alt = 'trap ' + shortCode(s.code); photo.append(im); }
    else photo.append(el('span', 'hint', 'no photo'));
    photo.disabled = !s.reading_id;
    const info = el('div', 'tm-info');
    info.append(weekBars(s));
    // a two-sided card: each face its own figure, the trap's the two added (0149)
    const sides = s.sides && typeof s.sides === 'object' ? Object.entries(s.sides).filter(([k]) => k === 'yellow' || k === 'blue') : [];
    if (sides.length) {
      const sr = el('div', 'tm-fam');
      sides.sort((a, b) => (a[0] === 'yellow' ? -1 : 1)).forEach(([k, v]) =>
        sr.append(el('span', 'pill tm-side ' + k, `${k === 'yellow' ? 'Yellow' : 'Blue'} side ${v.rate != null ? d1(v.rate) + '/day' : 'count starts'} · ${num(v.total, 0)} on it`)));
      info.append(sr);
    }
    // by insect family, the last two weeks: the reading's split (the AI note, else the person's pest) on its new insects
    const fam = Object.entries(s.families || {}).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    if (fam.length) {
      const fr = el('div', 'tm-fam');
      fam.forEach(([g, v]) => fr.append(el('span', 'pill', `${FAMILY[g] || g} ${d1(v)}/day`)));
      info.append(fr);
    } else info.append(el('div', 'hint', 'By insect family: ask the AI note on a photo, or name the insect.'));
    info.append(el('div', 'hint', `Last read ${when(s.read_at)}${s.total != null ? ` · ${num(s.total, 0)} on the card` : ''}`));
    if (s.ai_notes) info.append(el('div', 'tm-ai', '✦ ' + s.ai_notes));
    if (s.notes) info.append(el('div', 'tm-note', '“' + s.notes + '”'));
    body.append(photo, info);
    card.append(body);

    const hist = el('div', 'tm-hist');
    const more = el('button', 'btn btn-sm', 'History');
    let readings = null;
    const getReadings = async () => readings || (readings = (await rpc('trap_spot', { p_farm: farm.id, p_spot: s.spot })).readings || []);
    more.onclick = async () => {
      busy(more, true, 'Reading…');
      try {
        const r = await getReadings();
        hist.textContent = '';
        if (!r.length) hist.append(el('div', 'hint', 'No reading in the last 120 days.'));
        r.forEach(x => {
          const f = el('button', 'tm-hfig');
          f.type = 'button';
          const im = x.photo_data ? el('img') : el('span', 'tm-nophoto', 'no photo');
          if (x.photo_data) { im.src = x.photo_data; im.alt = ''; }
          const excl = x.check?.state === 'excluded';
          f.append(im, el('span', null, `${dm(x.taken_at)}${x.side ? ' · ' + x.side : ''} · ${num(x.total, 0)}${x.day_rate != null ? ` · ${d1(x.day_rate)}/day` : excl ? '' : ' · count starts'}`),
                   el('span', 'hint', shortCode(x.code) + (x.replaced ? ' · replaced after' : '')));
          const chk = trapCheckPill(x.check, x.total);
          if (chk) f.append(chk);
          if (excl) f.classList.add('excluded');
          f.onclick = () => view(x, getReadings);
          hist.append(f);
        });
        more.remove();
      } catch (e) { busy(more, false, 'History'); toast(e.message, 'bad'); }
    };
    photo.onclick = async () => {
      const r = await getReadings().catch(() => []);
      const x = r.find(y => y.id === s.reading_id) || { kind: 'trap', id: s.reading_id, code: s.code, taken_at: s.read_at, total: s.total,
                                                         photo_data: s.photo_data, photo_path: s.photo_path, tags: [] };
      view(x, getReadings);
    };
    card.append(more, hist);
    return card;
  }

  function view(photo, getReadings) {
    openViewer({
      farm, photo: { ...photo, kind: 'trap' }, catalog: [], aiReady: true, mayWrite: !!data.may_edit,   // a worker only looks (0.7.162)
      zonePhotos: getReadings,                                  // Compare with… = this spot's other photos
      zoneId: photo.zone_id || null, crops: [], openCases: async () => [],
      onChange: () => load(),
    });
  }

  // eight weeks of new insects a day (each week's new insects over its days), a bar each; a new card is a mark under its week
  function weekBars(s) {
    const weeks = s.weeks || [];
    const th = data.threshold || {};
    const max = Math.max(th.over || 0, 1, ...weeks.map(w => Number(w.v) || 0));
    const box = el('div', 'tm-bars');
    const changes = (s.changes || []).map(x => String(x).slice(0, 10));
    weeks.forEach(w => {
      const col = el('div', 'tm-bar');
      const v = w.v == null ? null : Number(w.v);
      const bar = el('i', v == null ? 'none' : v >= (th.over ?? Infinity) ? 'red' : v >= (th.watch ?? Infinity) ? 'orange' : 'green');
      bar.style.height = v == null ? '2px' : `${Math.max(3, 100 * v / max)}%`;
      const start = new Date(w.w + 'T12:00:00'), end = new Date(start); end.setDate(end.getDate() + 7);
      const newCard = changes.some(c => { const d = new Date(c + 'T12:00:00'); return d >= start && d < end; });
      col.title = `Week of ${dm(w.w)}: ${v == null ? 'no rate' : d1(v) + ' new a day'}${newCard ? ' · new card' : ''}`;
      col.append(bar, el('span', 'tm-wk' + (newCard ? ' new' : ''), newCard ? '↺' : ''));
      box.append(col);
    });
    if (th.over) { const line = el('div', 'tm-over'); line.style.bottom = `${100 * th.over / max}%`; line.title = `over: ${th.over} a day`; box.append(line); }
    return box;
  }

  // ── every trap, worst first ──
  function trapList(spots) {
    const card = el('div', 'card');
    card.style.marginTop = 'var(--space-4)';
    const head = el('div', 'card-pad row');
    head.append(el('div', 'sec-title', 'Every trap'), el('div', 'spacer'), el('span', 'hint', 'worst first'));
    card.append(head);
    const t = el('table', 'table');
    const tr = el('tr');
    ['Trap', 'Where', 'New a day', 'Trend', '8 weeks', 'Last read'].forEach(h => tr.append(el('th', null, h)));
    const thead = el('thead'); thead.append(tr);
    const tb = el('tbody');
    spots.filter(s => s.active).forEach(s => {
      const r = el('tr');
      r.style.cursor = 'pointer';
      const cfg = data.config;
      const code = el('td'); code.append(el('span', 'ipm-code ' + (s.colour || ''), shortCode(s.code)));
      const lvl = el('td');
      if (s.tone) lvl.append(el('span', 'pill ' + (s.tone === 'red' ? 'bad' : s.tone === 'orange' ? 'warn' : 'ok'), d1(s.level)));
      else lvl.append(el('span', 'hint', 'not read lately'));
      const spark = el('td'); spark.append(weekBars(s)); spark.firstChild.classList.add('mini');
      r.append(code, el('td', null, `${cfg.label} ${s.n} · row ${s.row ?? '—'} · ${s.metres != null ? num(s.metres, 0) + ' m' : '—'}`), lvl,
               el('td', 'tm-trend-cell', s.trend ? TREND[s.trend] : ''), spark, el('td', null, when(s.read_at)));
      r.onclick = () => openSpots(`${cfg.label} ${s.n} · trap ${shortCode(s.code)}`, [s]);
      tb.append(r);
    });
    t.append(thead, tb);
    const scroll = el('div', 'table-scroll'); scroll.append(t);
    card.append(scroll);
    return card;
  }

  // ── the map's size (a manager) ──
  function openSize() {
    const cfg = data.config;
    const d = drawer('Map size', 'How the trap map draws a zone');
    const label = input({ value: cfg.label || 'Zone' });
    const w = input({ type: 'number', min: 1, step: '0.1', value: cfg.width_m });
    const l = input({ type: 'number', min: 1, step: '0.1', value: cfg.length_m });
    const c = input({ type: 'number', min: 1, max: 6, step: '1', value: cfg.cols });
    const r = input({ type: 'number', min: 1, max: 12, step: '1', value: cfg.rows });
    d.body.append(
      field('Called', label, 'The first number of a trap code is this: Zone at FarmLab, Bay at FarmBox1.'),
      field('Width (short side), m', w), field('Length (long side, from the corridor), m', l),
      field('Areas across the width', c, 'The rows are shared equally: 2 = halves.'),
      field('Areas along the length', r, '4 = quarters of the length.'));
    const save = el('button', 'btn btn-primary', 'Save');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => d.close();
    save.onclick = async () => {
      busy(save, true, 'Saving…');
      try {
        await rpc('save_trap_map', { p_farm: farm.id, p: { label: label.value, width_m: w.value, length_m: l.value, cols: c.value, rows: r.value } });
        d.close(); toast('Map saved', 'ok'); await load();
      } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
    };
    d.footer.append(cancel, save);
  }

  function openSetup() {
    const d = drawer('Traps and limits', 'Every trap on the list, the watch and over limits', { onClose: () => load() });
    d.box.style.width = 'min(1100px, 100vw)';
    renderIpm(d.body, farm);
    const close = el('button', 'btn', 'Close');
    close.onclick = () => d.close();
    d.footer.append(close);
  }

  return { legend, unitMap, trapList, openSpots, openSize, openSetup, spotOf };
}
