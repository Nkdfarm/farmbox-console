// ═══════════════════════════════════════════════════════════════════════════
// Prices & market — what a kilo is worth here (spec §7.9, §10.4)
//
// Three things, next to each other: what the book says, what this farm
// actually sold for, and what Cape Town Market paid this week. The book is
// derived — a base price in USD, a country index, a season factor, a channel
// factor — so it is never wrong so much as generic. An observation from a real
// invoice beats it everywhere, including inside the crop planner.
//
// The market is collected by itself every Monday (and with the Scan button):
// one price per kg per species per week, so this page can show the week against
// the previous one, twelve weeks of trend, and the season's variation — from
// Cape Town's own history once there is a year of it, and labelled an estimate
// until then. A wholesale price is shown for comparison and never replaces the
// book or the farm's own prices in the planner.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, openFast } from './api.js';
import { loading, el, table, pageHead, card, drawer, field, input, selectBox,
         toast, busy, num, shortDate } from './ui.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const UNIT_WORD = { piece: 'each', bunch: 'per bunch', punnet: 'per punnet' };

let farm = null, data = null, trends = null, mount = null;

export async function renderPrices(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load(fresh = false) {
  const here = mount, a = { p_farm: farm.id };
  // last time's copy at once, the server's answer behind it (0.7.106–0.7.107)
  await openFast([['price_table', a], ['market_trends', a, true]], {   // the market card is extra
    show: ([book, tr]) => { data = book; trends = tr; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the price book…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}

function paint() {
  mount.textContent = '';
  const ci = data.country_index || {};
  const rec = el('button', 'btn btn-primary', 'Record a price');
  rec.onclick = () => record();
  const scan = el('button', 'btn', 'Scan Cape Town now');
  scan.title = 'Collect this week’s Cape Town Market prices now. It also runs by itself every Monday at 13:30.';
  scan.onclick = () => scanMarket(scan);

  mount.append(pageHead('Prices & market',
    `${data.currency} per kg in ${ci.name || data.country}, sold ` +
    `${data.channel === 'direct' ? 'direct to the consumer' : 'to a retailer'}. ` +
    `It is ${data.season_now} here now.`,
    data.may_edit ? scan : null, data.may_edit ? rec : null));

  if (trends) mount.append(marketCard());

  mount.append(el('div', 'note',
    `The book is derived, not quoted: a base price in USD × a country index of ` +
    `${ci.index ?? '—'} × the season × the channel, converted at ` +
    `${num(ci.fx, 2)} ${data.currency} to the dollar` +
    `${ci.fx_as_of ? ` as of ${shortDate(ci.fx_as_of)}` : ''}. ` +
    'Indicative, and dated. Your own observations win wherever you have them.'));

  const seasonCol = s => ({
    key: s, label: s, align: 'right',
    fmt: v => el('span', s === data.season_now ? 'now' : null, v == null ? '—' : num(v, 2)),
  });

  mount.append(card('The book, by season',
    table([
      { key: 'crop', label: 'Crop', fmt: (v, r) => {
          const b = el('div');
          b.append(el('b', null, v));
          b.append(el('div', 'hint', String(r.category).replace('_', ' ')));
          return b; } },
      ...SEASONS.map(seasonCol),
      { key: 'today', label: 'Today', align: 'right',
        fmt: v => el('b', null, v == null ? '—' : num(v, 2)) },
      // today's price for one unit as the crop is sold (crop.sell_unit, grams_per_unit)
      { key: 'sell_unit', label: 'Per unit', align: 'right',
        fmt: (u, r) => {
          const w = el('div');
          if (!u || u === 'kg' || !r.grams_per_unit) {
            w.append(el('span', 'hint', 'sold per kg'));
            return w;
          }
          const each = r.today == null ? null : r.today * r.grams_per_unit / 1000;
          const b = el('b', null, each == null ? '—' : num(each, 2));
          b.title = `${num(r.today, 2)} per kg × ${num(r.grams_per_unit, 0)} g`;
          w.append(b, el('div', 'hint', `${UNIT_WORD[u] || u} · ${num(r.grams_per_unit, 0)} g`));
          return w; } },
      { key: 'market', label: 'Cape Town', align: 'right',
        fmt: m => {
          if (!m) return '—';
          const w = el('div');
          const s = el('span', null, `R ${num(m.price, 2)} /kg`);
          s.title = `${m.species} at Cape Town Market, week of ${shortDate(m.week_start)} · ${m.source}`;
          w.append(s, el('div', 'hint', `wk ${shortDate(m.week_start)}`));
          return w; } },
      { key: 'own', label: 'Your own', align: 'right',
        fmt: (v, r) => {
          if (v == null) return '—';
          const gap = r.today ? Math.round(100 * (v / r.today - 1)) : null;
          const s = el('span', gap > 0 ? 'up' : gap < 0 ? 'down' : null,
                       num(v, 2) + (gap ? ` (${gap > 0 ? '+' : ''}${gap}%)` : ''));
          s.title = 'Average of your last 90 days of observations';
          return s; } },
    ], data.book, { empty: 'No prices — seed the price book first.' })));

  const obs = card('What this farm has actually seen');
  obs.append(table([
    { key: 'observed_at', label: 'When', fmt: shortDate },
    { key: 'crop', label: 'Crop' },
    { key: 'price', label: 'Price', align: 'right',
      fmt: (v, r) => `${num(v, 2)} / ${r.unit}` },
    { key: 'channel', label: 'Sold to' },
    { key: 'source', label: 'Source' },
  ], data.observations, {
    empty: 'Nothing recorded yet. Every real invoice you enter makes the planner less generic.',
  }));
  mount.append(obs);
}

// ── Cape Town Market, week by week ─────────────────────────────────────────
function marketCard() {
  const c = card('Cape Town Market — week by week');
  const last = trends.last_collected;
  c._head.append(el('span', 'pill' + (last ? '' : ' warn'),
    last ? `Collected ${shortDate(String(last).slice(0, 10))}` : 'Not collected yet'));

  const intro = el('div', 'hint mk-intro',
    'Wholesale rand per kg at Cape Town Market, one figure per species, collected by itself every ' +
    'Monday at 13:30 — or now, with Scan. Weighted by the kilos sold where the market reports them; ' +
    'otherwise the median of the day’s class 1 lines, with the low–high spread across grades and packaging under it. ' +
    'Johannesburg beside it, where the market reports kilos sold. ' +
    'Buyers’ prices before the agent’s commission, so for comparison: the planner keeps using the book and your own prices.');
  c.append(intro);

  const rows = (trends.species || []).map(s => ({ ...s }));
  c.append(table([
    { key: 'label', label: 'Species', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        const n = (r.crops || []).length;
        const h = el('div', 'hint', n ? `${n} crop${n === 1 ? '' : 's'}: ${r.crops.slice(0, 2).join(', ')}${n > 2 ? '…' : ''}`
                                      : 'no crop of yours matches');
        h.title = (r.crops || []).join('\n');
        b.append(h);
        return b; } },
    { key: 'this_week', label: 'This week (R/kg)', align: 'right', fmt: w => {
        if (!w) return el('span', 'hint', 'not collected');
        const b = el('div');
        const v = el('b', null, `R ${num(w.price_kg, 2)} /kg`);
        v.title = `${w.source}\n${w.days} trading day${w.days === 1 ? '' : 's'}` +
          (w.kg_sold ? ` · ${num(w.kg_sold)} kg sold` : '');
        b.append(v, el('div', 'hint',
          (w.low_kg != null && w.high_kg != null && w.high_kg !== w.low_kg ? `R ${num(w.low_kg, 0)}–${num(w.high_kg, 0)} · ` : '')
          + `wk ${shortDate(w.week_start)}${w.weighted ? ' · by kg sold' : ' · median'}`));
        return b; } },
    { key: 'previous_week', label: 'Previous week (R/kg)', align: 'right',
      fmt: w => (w ? `R ${num(w.price_kg, 2)} /kg` : '—') },
    // Johannesburg this week, weighted by kilos sold (Farmazone): the other side of the country
    { key: 'joburg', label: 'Joburg (R/kg)', align: 'right', fmt: w => {
        if (!w) return el('span', 'hint', '—');
        const b = el('div');
        const v = el('span', null, `R ${num(w.price_kg, 2)} /kg`);
        v.title = `${w.source}\nweek of ${shortDate(w.week_start)}` + (w.kg_sold ? ` · ${num(w.kg_sold)} kg sold` : '');
        b.append(v, el('div', 'hint', w.kg_sold ? `${num(w.kg_sold)} kg sold` : `wk ${shortDate(w.week_start)}`));
        return b; } },
    { key: 'key', label: 'Change', align: 'right', fmt: (_, r) => {
        const a = r.this_week?.price_kg, b = r.previous_week?.price_kg;
        if (a == null || !b) return '—';
        const pct = Math.round(100 * (Number(a) / Number(b) - 1));
        return el('span', pct > 0 ? 'mk-up' : pct < 0 ? 'mk-down' : null,
                  `${pct > 0 ? '▲ +' : pct < 0 ? '▼ ' : ''}${pct}%`); } },
    { key: 'weeks', label: '12 weeks', fmt: w => sparkline(w || []) },
    { key: 'season', label: 'Season now', align: 'right', fmt: s => seasonCell(s) },
  ], rows, { empty: 'No species set up — apply the market migration.' }));
  return c;
}

function seasonCell(s) {
  if (!s || s.basis === 'none' || s.pct == null) {
    const x = el('span', 'hint', '—');
    if (s) x.title = `${s.weeks || 0} of ${s.weeks_needed || 40} weeks of Cape Town history so far`;
    return x;
  }
  const w = el('div');
  const pct = Number(s.pct);
  const v = el('b', pct > 0 ? 'mk-up' : pct < 0 ? 'mk-down' : null, `${pct > 0 ? '+' : ''}${pct}%`);
  if (s.basis === 'history') {
    v.title = `${MONTHS[(s.month || 1) - 1]} against the yearly average, from ${s.weeks} weeks of Cape Town Market`;
    w.append(v, el('div', 'hint', `${MONTHS[(s.month || 1) - 1]} · Cape Town history`));
  } else {
    v.title = `Estimated from the price book’s ${s.season} factor. It becomes Cape Town’s own pattern ` +
      `once there is a year of weeks: ${s.weeks} of ${s.weeks_needed} so far.`;
    w.append(v, el('div', 'hint', `${s.season} · estimate, ${s.weeks}/${s.weeks_needed} wk`));
  }
  return w;
}

// Twelve weeks as a line: lowest to highest fills the height, the last week is a dot.
function sparkline(points) {
  if (points.length < 2) return el('span', 'hint', points.length ? 'one week so far' : '—');
  const w = 96, h = 26, pad = 3;
  const ys = points.map(p => Number(p.price));
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const xy = ys.map((y, i) => [pad + i * (w - 2 * pad) / (ys.length - 1),
                               h - pad - (y - min) * (h - 2 * pad) / span]);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('class', 'mk-spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `From ${num(ys[0], 2)} to ${num(ys[ys.length - 1], 2)} per kg over ${ys.length} weeks`);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = points.map(p => `${shortDate(p.week)}: ${num(p.price, 2)}`).join('\n');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  const dot = document.createElementNS(SVG_NS, 'circle');
  const [lx, ly] = xy[xy.length - 1];
  dot.setAttribute('cx', lx.toFixed(1)); dot.setAttribute('cy', ly.toFixed(1)); dot.setAttribute('r', '2.4');
  svg.append(title, line, dot);
  return svg;
}

async function scanMarket(button) {
  busy(button, true, 'Scanning…');
  try {
    const r = await fn('market-prices', { farm_id: farm.id });
    const n = (r.collected || []).length;
    toast(n
      ? `Cape Town Market: ${n} species this week` +
        (r.backfilled_weeks ? `, and ${r.backfilled_weeks} earlier weeks from the 30-day trend` : '')
      : 'The market had no prices for these species today', n ? 'ok' : '');
    if (r.problems?.length) setTimeout(() => toast(`Partly: ${r.problems.join(' · ')}`, 'bad'), 3400);
    // information, not a failure (e.g. Farmazone skipped until its API key is set)
    else if (r.notes?.length) setTimeout(() => toast(r.notes.join(' · ')), 3400);
    await load(true);
  } catch (e) {
    busy(button, false, 'Scan Cape Town now');
    toast(e.message, 'bad');
  }
}

function record() {
  const d = drawer('Record a price', 'What you actually sold it for');
  const crop = selectBox(data.book.map(b => [b.crop_id, b.crop]));
  const price = input({ type: 'number', step: '0.01', required: true });
  const unit = selectBox([['kg', 'per kg'], ['piece', 'per piece'], ['punnet', 'per punnet']], 'kg');
  const channel = selectBox([['direct', 'Direct to the consumer'], ['retail', 'To a retailer']],
                            data.channel);
  const when = input({ type: 'date' });
  const source = input({ placeholder: 'invoice number, market, customer' });

  d.body.append(field('Crop', crop));
  d.body.append(field(`Price (${data.currency})`, price));
  d.body.append(field('Per', unit));
  d.body.append(field('Sold to', channel));
  d.body.append(field('When', when, 'Today if left empty.'));
  d.body.append(field('Where it came from', source));
  d.body.append(el('p', 'hint',
    'The crop planner prices a batch at its harvest date and prefers your own ' +
    'numbers over the book, so this changes what it proposes.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Record');
  save.onclick = async () => {
    if (!price.value) { toast('It needs a price', 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      const on = when.value || null;
      await rpc('record_market_price', { p: {
        farm_id: farm.id, crop_id: crop.value, price: Number(price.value),
        unit: unit.value, channel: channel.value, source: source.value.trim(),
        observed_at: on,
        month: on ? Number(on.slice(5, 7)) : null,
        year: on ? Number(on.slice(0, 4)) : null } });
      d.close();
      toast('Recorded', 'ok');
      await load(true);
    } catch (e) { busy(save, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
