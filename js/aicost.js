// ═══════════════════════════════════════════════════════════════════════════
// What the AI costs (console 0.7.192, migration 0191, owner 2 Oct 2026: "log and show
// the real cost"). Every call the platform makes to Claude — a plant photo read, a trap
// identified, the position on a card, a zone's opinion, the assistant — is logged by
// the edge function that made it, with the tokens the API counted; ai_cost(farm, days)
// adds them up.
//   aiSpendLine(farmId) — under the Anthropic key in Settings › Integrations (0.7.193): this month's total, Spend by day.
//   openAiCost(farmId) — the window: today · 7 days · 30 days · this month, a photo on
//     average, the days as bars, by kind, the last calls, the prices used.
// Dollars are what Anthropic bills; the farm's currency is that × the price book's
// rate, which is indicative and dated. Calls made before 0191 were not logged (the
// zone opinions were: they kept their own tokens).
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, drawer, num } from './ui.js';

const KIND = { 'scout-photo': 'Plant photo read by the AI', 'trap-species': 'Trap photo: the species', 'zone-opinion': 'A zone\'s AI opinion',
               assistant: 'The assistant', 'photo-note': 'AI note on the phone' };
const SUB = { health: 'plant health', growth: 'growth', trap: 'trap', code: 'the position on a card' };
const kindName = r => r.fn === 'photo-note' ? `AI note on the phone · ${SUB[r.kind] || r.kind || ''}` : (KIND[r.fn] || r.fn);
const usd = (v, dp = 2) => v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const shortDay = s => new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const hhmm = ts => new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
// the farm's money beside the dollars, when the price book has a rate
const local = (j, v, dp = 2) => (j.fx_per_usd && j.currency && j.currency !== 'USD' && v != null)
  ? ` · ${j.currency} ${Number(v * j.fx_per_usd).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}` : '';
const both = (j, v, dp = 2) => usd(v, dp) + local(j, v, dp);

export function aiSpendLine(farmId) {
  const r = el('div', 'set-row ac-line');
  const hint = el('small', null, 'Reading…');
  const text = el('div', 'set-text');
  const title = el('b', null, 'Spent this month');
  text.append(title, hint);
  r.append(text);
  if (!farmId) { hint.textContent = 'No FarmBox open.'; return r; }
  const open = el('button', 'btn btn-sm', 'Spend by day');
  open.title = 'Every day, by kind of call, the last calls and what a photo costs';
  open.onclick = () => openAiCost(farmId);
  r.append(open);
  rpc('ai_cost', { p_farm: farmId, p_days: 31 }).then(j => {
    const m = j.this_month || {};
    const month = new Date(String(j.today).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long' });
    title.textContent = `Spent in ${month}: ${both(j, m.usd)}`;
    hint.textContent = j.since
      ? `${m.calls || 0} call${m.calls === 1 ? '' : 's'} to Claude, ${m.photos || 0} photo${m.photos === 1 ? '' : 's'} · today ${usd(j.day?.usd)}` +
        (j.per_photo_usd != null ? ` · a photo ${usd(j.per_photo_usd, 3)} on average` : '') + ' · counted from the tokens Anthropic billed'
      : 'Nothing logged yet: every AI call from now on is counted here, with the tokens Anthropic billed.';
  }).catch(e => { hint.textContent = /ai_cost/.test(e.message) ? 'Not available on this database yet.' : e.message; });
  return r;
}

export function openAiCost(farmId) {
  let days = 30;
  const d = drawer('What the AI costs', 'Every call to Claude, with the tokens the API counted');
  d.box.classList.add('sump-drawer');
  const read = async () => {
    d.body.textContent = ''; d.body.append(el('div', 'hint', 'Reading…'));
    try { paint(await rpc('ai_cost', { p_farm: farmId, p_days: days })); }
    catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); }
  };
  const paint = j => {
    const body = d.body; body.textContent = '';
    if (!j.since) { body.append(el('div', 'empty', 'Nothing logged yet. Ask the AI about a photo, a trap or a zone: the call appears here with its cost.')); return; }
    const tiles = el('div', 'ac-tiles');
    [['Today', j.day], ['7 days', j.week], ['30 days', j.month30], ['This month', j.this_month]].forEach(([label, s]) => {
      const t = el('div', 'ac-tile');
      t.append(el('span', 'pd-hlabel', label), el('b', null, usd(s?.usd)),
        el('span', 'hint', `${s?.calls || 0} call${s?.calls === 1 ? '' : 's'} · ${s?.photos || 0} photo${s?.photos === 1 ? '' : 's'}${local(j, s?.usd)}`));
      tiles.append(t);
    });
    const pp = el('div', 'ac-tile');
    pp.append(el('span', 'pd-hlabel', 'A photo, on average'), el('b', null, usd(j.per_photo_usd, 3)),
      el('span', 'hint', j.per_photo_usd != null ? `40 photos ≈ ${both(j, j.per_photo_usd * 40)}` : 'no photo call logged yet'));
    tiles.append(pp);
    body.append(tiles);

    // the days as bars
    const bar = el('div', 'sp-bar');
    bar.append(el('span', 'pd-hlabel', 'Day by day'), el('span', 'spacer'));
    [30, 90, 365].forEach(n => { const b = el('button', 'pd-cropchip' + (n === days ? ' on' : ''), `${n} days`); b.onclick = () => { days = n; read(); }; bar.append(b); });
    body.append(bar);
    const max = Math.max(...j.days.map(x => Number(x.usd) || 0), 0.0001);
    const bars = el('div', 'ac-bars');
    j.days.forEach(x => {
      const col = el('div', 'ac-bar');
      const fill = el('span'); fill.style.height = Math.max(2, Math.round((Number(x.usd) || 0) / max * 100)) + '%';
      col.append(fill);
      col.title = `${shortDay(x.day)}: ${both(j, x.usd, 3)} — ${x.calls} call${x.calls === 1 ? '' : 's'}, ${x.photos} photo${x.photos === 1 ? '' : 's'}, ${num(x.input_tokens)} tokens in, ${num(x.output_tokens)} out`;
      bars.append(col);
    });
    body.append(bars);
    if (j.days.length) {
      const ax = el('div', 'sp-foot hint');
      ax.append(el('span', null, shortDay(j.days[0].day)), el('span', null, `highest day ${usd(max)}`), el('span', null, shortDay(j.days[j.days.length - 1].day)));
      body.append(ax);
    }

    const table = (heads, rows) => {
      const t = el('table', 'sp-table');
      const hr = el('tr'); heads.forEach(h => hr.append(el('th', null, h))); t.append(hr);
      rows.forEach(cells => { const tr = el('tr'); cells.forEach((c, i) => tr.append(el('td', i ? 'num' : null, c))); t.append(tr); });
      return t;
    };
    body.append(el('div', 'pd-hlabel ac-h', `By kind · ${j.days_asked} days`),
      table(['What', 'Calls', 'Each', 'Tokens in / out, each', 'Total'],
        j.by_kind.map(r => [`${kindName(r)}${r.model ? ' · ' + r.model.replace(/^claude-/, '') : ''}`, num(r.calls), usd(r.avg_usd, 3),
                            `${num(r.avg_in)} / ${num(r.avg_out)}`, both(j, r.usd)])));
    body.append(el('div', 'pd-hlabel ac-h', 'The last calls'),
      table(['When', 'What', 'By', 'Tokens in / out', 'Cost'],
        j.recent.map(r => [`${shortDay(r.at)} ${hhmm(r.at)}`, kindName(r), r.by || '—', `${num(r.input_tokens)} / ${num(r.output_tokens)}`, usd(r.usd, 4)])));
    const used = new Set(j.by_kind.map(r => r.model).filter(Boolean));
    const prices = (j.prices || []).filter(p => [...used].some(m => m.startsWith(p.model)));
    body.append(el('div', 'hint ac-foot',
      (prices.length ? 'Prices used, per million tokens in / out: ' + prices.map(p => `${p.note || p.model} $${num(p.input_usd, 2)} / $${num(p.output_usd, 2)}`).join(' · ') + '. ' : '') +
      (j.fx_per_usd && j.currency !== 'USD' ? `${j.currency} at ${num(j.fx_per_usd, 2)} to the dollar${j.fx_as_of ? ' (' + shortDay(j.fx_as_of) + ', indicative)' : ''}. ` : '') +
      (j.no_price ? `${j.no_price} call${j.no_price === 1 ? '' : 's'} on a model with no price: counted in the calls, not in the money. ` : '') +
      `Counted since ${shortDay(j.since)}; what Anthropic bills is on its own Console. Voice notes written down by Groq are not counted here.`));
  };
  read();
}
