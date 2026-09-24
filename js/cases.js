// ═══════════════════════════════════════════════════════════════════════════
// Pest & diseases — the case window: one problem followed until it is over (0097)
//
// A case is one pest, disease or disorder on one crop in one zone. Its window
// draws the evolution on a real date axis: the severity of the photos added
// to it, the insect counts of the traps it follows (a replaced card is a
// reset), the treatment applications (done solid, planned dashed) and the
// withholding period until harvesting is safe again. Below the curve: the
// photos (open in the viewer), the traps followed, the programmes, and the
// close with its outcome.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, select } from './api.js';
import { el, drawer, field, input, selectBox, toast, busy, num } from './ui.js';
import { openViewer, photoTitle, tagChips } from './viewer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SEV = ['none', 'slight', 'clear', 'severe'];
const KIND_WORD = { pest: 'Pest', disease: 'Disease', disorder: 'Disorder', beneficial: 'Beneficial' };
const OUTCOMES = [['resolved', 'Resolved — gone'], ['contained', 'Contained — held at a low level'],
                  ['crop_removed', 'Crop removed'], ['false_alarm', 'False alarm']];
const METHODS = [['biological', 'Biological'], ['chemical', 'Chemical'], ['cultural', 'Cultural'], ['mechanical', 'Mechanical']];
const day = ts => ts ? new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The farm the case windows act on: set by the Pest & diseases page (useFarm)
// before any case or photo is opened (0.7.101 — the Cases tab became part of it).
let farm = null, catalog = null;
export function useFarm(f, cat) { farm = f; if (cat) catalog = cat; }

// ── a new case, from a photo or by hand ───────────────────────────────────
// ctx: { zone_id, crop_id, from_kind, from_id, code, severity, zones?, crops? , onDone }
export async function newCase(ctx) {
  const cat = catalog || await rpc('pest_catalog');
  const d = drawer('Open a case', ctx.from_id ? 'From this photo — it becomes the first point' : 'One problem, on one crop, in one zone');
  const opts = [];
  ['pest', 'disease', 'disorder'].forEach(k => cat.filter(c => c.kind === k).forEach(c => opts.push([c.code, `${KIND_WORD[k]}: ${c.label}`])));
  const code = selectBox(opts, ctx.code && opts.some(o => o[0] === ctx.code) ? ctx.code : opts[0][0]);
  const sev = selectBox([[1, 'slight'], [2, 'clear'], [3, 'severe']], ctx.severity || 1);
  const note = el('textarea'); note.rows = 3; note.placeholder = 'What was seen, how widespread.';
  d.body.append(field('What it is', code), field('How bad now', sev));
  let zone = null, crop = null;
  if (!ctx.zone_id) {
    const zs = await select('zone', `select=id,name,zone_number&farm_id=eq.${farm.id}&order=zone_number,name`).catch(() => []);
    const zones = (zs || []).map(z => [z.id, z.name]);
    zone = selectBox([['', '— the whole unit'], ...zones], '');
    d.body.append(field('Zone', zone));
  }
  if (!ctx.crop_id && ctx.crops?.length) {
    crop = selectBox([['', '— not one crop'], ...ctx.crops.map(c => [c.id, c.name])], '');
    d.body.append(field('Crop', crop));
  }
  d.body.append(field('Note', note));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Open the case');
  ok.onclick = async () => {
    busy(ok, true, 'Opening…');
    try {
      const c = await rpc('open_case', { p: { farm_id: farm.id, code: code.value, severity: Number(sev.value), note: note.value.trim(),
        zone_id: ctx.zone_id || zone?.value || null, crop_id: ctx.crop_id || crop?.value || null,
        from_kind: ctx.from_kind || null, from_id: ctx.from_id || null } });
      d.close(); toast('Case opened: ' + c.title, 'ok');
      ctx.onDone?.(c);
    } catch (e) { busy(ok, false, 'Open the case'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

// ── the case window ───────────────────────────────────────────────────────
export async function openCase(id, onChange) {
  const d = drawer('Case', 'Reading…');
  d.box.classList.add('case-drawer');
  let det;
  const reload = async () => {
    try { det = await rpc('case_detail', { p_case: id }); }
    catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }
    paintCase();
  };
  const changed = () => { reload(); onChange?.(); };
  const paintCase = () => {
    const c = det.case;
    d.box.querySelector('header h2').textContent = c.title;
    d.box.querySelector('header .hint').textContent = [KIND_WORD[c.kind_of] || '', c.latin, c.zone, c.crop,
      `opened ${day(c.created_at)}`, c.status === 'closed' ? `closed ${day(c.closed_at)} · ${String(c.outcome || '').replace('_', ' ')}` : null]
      .filter(Boolean).join(' · ');
    d.body.textContent = '';
    d.footer.textContent = '';

    // withholding: the one thing nobody may miss
    const wait = (det.programs || []).map(p => p.harvest_after).filter(Boolean).sort().pop();
    if (wait && wait >= ymd(new Date())) d.body.append(el('div', 'note warn', `Do not harvest ${c.crop || 'this crop'} in ${c.zone || 'this zone'} before ${new Date(wait + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} — the withholding period of the last treatment.`));
    if (c.detail) d.body.append(el('p', 'hint', c.detail));

    // the curve
    d.body.append(el('div', 'sec-title', 'How it goes'));
    d.body.append(caseChart(det));

    // the points
    const pts = det.points || [];
    d.body.append(el('div', 'sec-title', `Photos and readings · ${pts.length}`));
    if (!pts.length) d.body.append(el('div', 'hint', 'Nothing added yet. In Scouting, open a photo of this zone and press Add to this case.'));
    else {
      const grid = el('div', 'sc-grid');
      pts.slice().reverse().forEach(pt => {
        const ph = pt.photo || {};
        const fig = el('figure', 'sc-fig');
        const im = el('img'); im.src = ph.photo_data || ''; im.alt = photoTitle(ph); im.loading = 'lazy';
        const cap = el('figcaption');
        cap.append(el('b', null, `${day(pt.at)} · ${pt.kind === 'trap' ? `trap ${ph.code} · ${num(pt.count, 0)}` : (pt.severity != null ? SEV[pt.severity] : 'photo')}`));
        cap.append(tagChips(ph));
        if (pt.note) cap.append(el('div', 'hint', pt.note));
        if (det.may_write) {
          const rm = el('button', 'btn btn-sm btn-ghost', 'Take out of the case');
          rm.onclick = async e => { e.stopPropagation(); try { await rpc('remove_case_point', { p_point: pt.id }); changed(); } catch (er) { toast(er.message, 'bad'); } };
          cap.append(rm);
        }
        fig.append(im, cap);
        fig.onclick = () => openViewer({ farm, photo: { ...ph, zone: c.zone }, catalog: catalog || [], mayWrite: det.may_write,
          zonePhotos: c.zone_id ? () => rpc('zone_photos', { p_farm: farm.id, p_zone: c.zone_id }) : null, onChange: changed });
        grid.append(fig);
      });
      d.body.append(grid);
    }

    // the traps followed
    if ((det.zone_traps || []).length) {
      d.body.append(el('div', 'sec-title', 'Traps followed'));
      const row = el('div', 'row'); row.style.flexWrap = 'wrap';
      const on = new Set(det.zone_traps.filter(t => t.followed).map(t => t.id));
      det.zone_traps.forEach(t => {
        const b = el('button', 'toggle', t.code); b.type = 'button';
        b.setAttribute('aria-pressed', String(on.has(t.id)));
        b.disabled = !det.may_write;
        b.onclick = async () => {
          on.has(t.id) ? on.delete(t.id) : on.add(t.id);
          try { await rpc('follow_traps', { p_case: id, p_traps: [...on] }); changed(); } catch (e) { toast(e.message, 'bad'); }
        };
        row.append(b);
      });
      d.body.append(row, el('div', 'hint', 'Their counts are drawn on the curve from two weeks before the case opened; a replaced card is marked as a reset.'));
    }

    // the treatment
    d.body.append(el('div', 'sec-title', 'Treatment'));
    (det.programs || []).forEach(p => d.body.append(programCard(p, det, changed)));
    if (!(det.programs || []).length) d.body.append(el('div', 'hint', 'No treatment yet.'));
    if (det.may_manage && c.status !== 'closed') {
      const start = el('button', 'btn btn-sm', 'Start a treatment…');
      start.onclick = () => programForm(det, null, changed);
      d.body.append(start);
    }

    // closing
    const shut = el('button', 'btn', 'Close');
    shut.onclick = d.close;
    if (det.may_manage && c.status !== 'closed') {
      const end = el('button', 'btn btn-primary', 'Close the case…');
      end.onclick = () => closeForm(det, () => { changed(); });
      d.footer.append(end);
    }
    d.footer.append(shut);
  };
  await reload();
}

function programCard(p, det, changed) {
  const card = el('div', 'card card-pad case-prog');
  const head = el('div', 'row'); head.style.alignItems = 'center';
  head.append(el('b', null, `${p.product || p.name}`), el('span', 'pill', p.method),
              el('span', 'pill' + (p.state === 'running' ? ' info' : p.state === 'done' ? ' ok' : ''), p.state));
  card.append(head);
  card.append(el('div', 'hint', [p.rate, `${p.applications} application${p.applications > 1 ? 's' : ''} every ${p.interval_days} day${p.interval_days > 1 ? 's' : ''}`,
    p.withholding_days ? `withholding ${p.withholding_days} days` : 'no withholding',
    p.harvest_after ? `harvest from ${day(p.harvest_after)}` : null].filter(Boolean).join(' · ')));
  const apps = el('div', 'vw-chips'); apps.style.marginTop = '6px';
  (p.applications_list || []).forEach(a => apps.append(el('span', 'vw-tag ' + (a.status === 'done' ? 'beneficial' : ''),
    `${a.n}: ${day(a.date)}${a.status === 'done' ? ' ✓' : a.status === 'skipped' ? ' skipped' : ''}`)));
  card.append(apps);
  if (p.note) card.append(el('div', 'hint', p.note));
  if (det.may_manage && p.state === 'running' && det.case.status !== 'closed') {
    const acts = el('div', 'row'); acts.style.marginTop = '6px';
    const edit = el('button', 'btn btn-sm', 'Change…'); edit.onclick = () => programForm(det, p, changed);
    const stop = el('button', 'btn btn-sm btn-ghost', 'Stop');
    stop.onclick = async () => { busy(stop, true, '…'); try { await rpc('stop_program', { p_program: p.id }); toast('Stopped — the applications not done are gone', 'ok'); changed(); } catch (e) { busy(stop, false, 'Stop'); toast(e.message, 'bad'); } };
    acts.append(edit, stop);
    card.append(acts);
  }
  return card;
}

function programForm(det, p, changed) {
  const d = drawer(p ? 'Change the treatment' : 'Start a treatment', det.case.title);
  const name = input({ value: p?.name || '', placeholder: 'e.g. Mildew control round 1' });
  const method = selectBox(METHODS, p?.method || 'biological');
  const product = input({ value: p?.product || '', placeholder: 'e.g. Bacillus subtilis, Encarsia formosa' });
  const rate = input({ value: p?.rate || '', placeholder: 'e.g. 2 ml/l, 5 cards per 100 m²' });
  const start = input({ type: 'date', value: p?.start_date || ymd(new Date(Date.now() + 864e5)) });
  const every = input({ type: 'number', min: 1, max: 90, value: p?.interval_days ?? 7 });
  const count = input({ type: 'number', min: 1, max: 52, value: p?.applications ?? 3 });
  const wh = input({ type: 'number', min: 0, max: 180, value: p?.withholding_days ?? 0 });
  const note = el('textarea'); note.rows = 2; note.value = p?.note || '';
  const g1 = el('div', 'grid2'); g1.append(field('Product', product), field('Method', method));
  const g2 = el('div', 'grid3'); g2.append(field('First application', start), field('Every (days)', every), field('Applications', count));
  const g3 = el('div', 'grid2'); g3.append(field('Rate', rate), field('Withholding (days)', wh, 'Days after the last application before this crop may be harvested.'));
  d.body.append(field('Name', name), g1, g2, g3, field('Note', note));
  d.body.append(el('div', 'hint', 'Each application becomes a task on a working day in this zone' +
    (det.treatment_sop ? `, with the procedure "${det.treatment_sop.title}".` : '.') + ' The case shows when harvesting is safe again.'));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', p ? 'Save' : 'Start');
  ok.onclick = async () => {
    if (!product.value.trim() && !name.value.trim()) { toast('Name the product or the treatment', 'bad'); return; }
    busy(ok, true, 'Saving…');
    try {
      await rpc('save_program', { p: { id: p?.id || null, issue_id: det.case.id, name: name.value.trim(), method: method.value,
        product: product.value.trim(), rate: rate.value.trim(), start_date: start.value, interval_days: Number(every.value) || 7,
        applications: Number(count.value) || 1, withholding_days: Number(wh.value) || 0, note: note.value.trim() } });
      d.close(); toast(p ? 'Treatment changed — the applications moved with it' : 'Treatment started — its applications are on the Tasks board', 'ok');
      changed();
    } catch (e) { busy(ok, false, p ? 'Save' : 'Start'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

function closeForm(det, done) {
  const d = drawer('Close the case', det.case.title);
  const out = selectBox(OUTCOMES, 'resolved');
  const note = el('textarea'); note.rows = 3; note.placeholder = 'What worked, what did not — the next case reads it.';
  d.body.append(field('How it ended', out), field('Note', note),
    el('div', 'hint', 'A treatment still running stops; its applications not done are removed from the plan.'));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Close it');
  ok.onclick = async () => {
    busy(ok, true, 'Closing…');
    try { await rpc('close_case', { p_case: det.case.id, p_outcome: out.value, p_note: note.value.trim() || null }); d.close(); toast('Case closed', 'ok'); done(); }
    catch (e) { busy(ok, false, 'Close it'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

// ── the curve, on a real date axis ────────────────────────────────────────
// severity 0–3 of the points (left), the trap counts (right, one line a trap,
// a reset where the card was replaced), the applications as vertical marks,
// the withholding as a band, today as a line.
export function caseChart(det) {
  const W = 880, H = 240, L = 44, R = 44, T = 14, B = 30;
  const t0 = new Date(det.from).getTime();
  const tEnd = Math.max(new Date(det.to).getTime(),
    ...(det.programs || []).flatMap(p => [...(p.applications_list || []).map(a => new Date(a.date + 'T12:00:00').getTime()),
                                          p.harvest_after ? new Date(p.harvest_after + 'T12:00:00').getTime() : 0]));
  const span = Math.max(tEnd - t0, 864e5);
  const x = t => L + (t - t0) * (W - L - R) / span;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'case-chart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The evolution of the case over time');
  const mk = (tag, attrs, text) => { const n = document.createElementNS(SVG_NS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text != null) n.textContent = text; svg.append(n); return n; };

  // the date axis: a tick a week, a label every other
  const first = new Date(t0); first.setHours(12, 0, 0, 0); first.setDate(first.getDate() + ((8 - first.getDay()) % 7));
  for (let t = first.getTime(), i = 0; t <= tEnd; t += 7 * 864e5, i++) {
    mk('line', { x1: x(t), x2: x(t), y1: T, y2: H - B, class: 'cc-grid' });
    if (i % (span > 70 * 864e5 ? 2 : 1) === 0) mk('text', { x: x(t), y: H - B + 16, class: 'cc-label', 'text-anchor': 'middle' }, day(t));
  }
  // severity axis (left)
  const ys = s => H - B - s * (H - B - T) / 3;
  [0, 1, 2, 3].forEach(s => mk('text', { x: L - 6, y: ys(s) + 4, class: 'cc-label', 'text-anchor': 'end' }, SEV[s]));
  // withholding bands
  (det.programs || []).forEach(p => {
    if (!p.harvest_after || !p.applications_list?.length) return;
    const last = p.applications_list[p.applications_list.length - 1];
    const a = new Date(last.date + 'T12:00:00').getTime(), b = new Date(p.harvest_after + 'T12:00:00').getTime();
    mk('rect', { x: x(a), y: T, width: Math.max(1, x(b) - x(a)), height: H - B - T, class: 'cc-withhold' });
  });
  // applications
  (det.programs || []).forEach(p => (p.applications_list || []).forEach(a => {
    const t = new Date(a.date + 'T12:00:00').getTime();
    mk('line', { x1: x(t), x2: x(t), y1: T, y2: H - B, class: 'cc-app' + (a.status === 'done' ? ' done' : '') });
    mk('text', { x: x(t) + 3, y: T + 10, class: 'cc-label' }, `${a.n}`);
  }));
  // the trap counts (right axis)
  const traps = (det.traps || []).filter(t => t.readings.length);
  const maxCount = Math.max(10, ...traps.flatMap(t => t.readings.map(r => r.total || 0)));
  const yc = n => H - B - n * (H - B - T) / maxCount;
  if (traps.length) {
    [0, Math.round(maxCount / 2), maxCount].forEach(n => mk('text', { x: W - R + 6, y: yc(n) + 4, class: 'cc-label' }, String(n)));
    traps.forEach((t, k) => {
      const cls = 'cc-trap t' + (k % 4);
      let seg = [];
      const flush = () => { if (seg.length > 1) mk('polyline', { points: seg.map(p => p.join(',')).join(' '), class: cls }); seg = []; };
      t.readings.forEach(r => {
        const px = x(new Date(r.at).getTime()), py = yc(r.total || 0);
        if (r.replaced) { flush(); mk('text', { x: px, y: H - B - 3, class: 'cc-reset', 'text-anchor': 'middle' }, '↺'); }
        seg.push([px.toFixed(1), py.toFixed(1)]);
        mk('circle', { cx: px, cy: py, r: 2.2, class: cls });
      });
      flush();
      const last = t.readings[t.readings.length - 1];
      mk('text', { x: x(new Date(last.at).getTime()) + 4, y: yc(last.total || 0) - 4, class: 'cc-label ' + cls }, t.code);
    });
  }
  // severity points
  const sp = (det.points || []).filter(p => p.severity != null);
  if (sp.length > 1) mk('polyline', { points: sp.map(p => `${x(new Date(p.at).getTime()).toFixed(1)},${ys(p.severity).toFixed(1)}`).join(' '), class: 'cc-sev' });
  sp.forEach(p => mk('circle', { cx: x(new Date(p.at).getTime()), cy: ys(p.severity), r: 4, class: 'cc-sev-dot' }));
  // the case opened, and today
  const opened = new Date(det.case.created_at).getTime();
  mk('line', { x1: x(opened), x2: x(opened), y1: T, y2: H - B, class: 'cc-open' });
  mk('text', { x: x(opened) + 3, y: H - B - 4, class: 'cc-label' }, 'opened');
  const now = Date.now();
  if (now <= tEnd) { mk('line', { x1: x(now), x2: x(now), y1: T, y2: H - B, class: 'cc-today' }); mk('text', { x: x(now) + 3, y: T + 22, class: 'cc-label' }, 'today'); }
  mk('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'cc-axis' });

  const wrap = el('div', 'case-chart-wrap');
  wrap.append(svg);
  const legend = el('div', 'hint');
  legend.textContent = 'Dots: severity of the photos added · lines: insects on the traps followed (↺ card replaced) · vertical marks: applications (solid done, dashed planned) · shaded: withholding. Drawn by date.';
  wrap.append(legend);
  return wrap;
}
