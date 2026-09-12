// ═══════════════════════════════════════════════════════════════════════════
// Prices & market — what a kilo is worth here (spec §7.9, §10.4)
//
// Two columns matter and they are next to each other: what the book says,
// and what this farm actually sold for. The book is derived — a base price
// in USD, a country index, a season factor, a channel factor — so it is
// never wrong so much as generic. An observation from a real invoice beats
// it everywhere, including inside the crop planner.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, card, drawer, field, input, selectBox,
         toast, busy, num, shortDate } from './ui.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

let farm = null, data = null, mount = null;

export async function renderPrices(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the price book…'));
  try { data = await rpc('price_table', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const ci = data.country_index || {};
  const rec = el('button', 'btn btn-primary', 'Record a price');
  rec.onclick = () => record();

  mount.append(pageHead('Prices & market',
    `${data.currency} per kg in ${ci.name || data.country}, sold ` +
    `${data.channel === 'direct' ? 'direct to the consumer' : 'to a retailer'}. ` +
    `It is ${data.season_now} here now.`,
    data.may_edit ? rec : null));

  mount.append(el('div', 'note',
    `The book is derived, not quoted: a base price in USD × a country index of ` +
    `${ci.index ?? '—'} × the season × the channel, converted at ` +
    `${num(ci.fx, 2)} ${data.currency} to the dollar` +
    `${ci.fx_as_of ? ` as of ${shortDate(ci.fx_as_of)}` : ''}. ` +
    'Indicative, and dated. Your own observations win wherever you have them.'));

  const seasonCol = s => ({
    key: s, label: s, align: 'right',
    fmt: (v, r) => {
      const cell = el('span', s === data.season_now ? 'now' : null,
                      v == null ? '—' : num(v, 2));
      return cell;
    },
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
      await load();
    } catch (e) { busy(save, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
