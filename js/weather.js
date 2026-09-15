// ═══════════════════════════════════════════════════════════════════════════
// Weather — one card at the top of the dashboard
//
// Today in a sentence, the next three days, and a link to a full forecast.
// The forecast comes from Open-Meteo: free, no key, no account, and it answers
// a browser directly, so nothing of ours sits in between. "More" goes to yr.no
// (a day-by-day table any farmer can read) and Windy (wind and rain on a map).
//
// The farm's place is farm.lat / farm.lng. A FarmBox without one gets a town
// search on the card itself — Open-Meteo's geocoder again — and the choice is
// saved on the farm row, which the database lets an organisation admin or the
// farm manager write. Nothing is guessed: a wrong town is a wrong forecast.
//
// The last forecast is kept on this device, so the card still says something
// when the console is offline, and says how old it is.
// ═══════════════════════════════════════════════════════════════════════════
import { select, patch } from './api.js';
import { el, icon, toast, busy, parseYmd } from './ui.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const KEEP = id => 'fbc_wx_' + id;

// WMO weather codes, as Open-Meteo reports them
const WMO = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloudSun'],
  3: ['Overcast', 'cloud'], 45: ['Fog', 'cloudFog'], 48: ['Freezing fog', 'cloudFog'],
  51: ['Light drizzle', 'cloudRain'], 53: ['Drizzle', 'cloudRain'], 55: ['Heavy drizzle', 'cloudRain'],
  56: ['Freezing drizzle', 'cloudRain'], 57: ['Freezing drizzle', 'cloudRain'],
  61: ['Light rain', 'cloudRain'], 63: ['Rain', 'cloudRain'], 65: ['Heavy rain', 'cloudRain'],
  66: ['Freezing rain', 'cloudRain'], 67: ['Freezing rain', 'cloudRain'],
  71: ['Light snow', 'cloudSnow'], 73: ['Snow', 'cloudSnow'], 75: ['Heavy snow', 'cloudSnow'],
  77: ['Snow grains', 'cloudSnow'], 80: ['Rain showers', 'cloudRain'], 81: ['Rain showers', 'cloudRain'],
  82: ['Violent rain showers', 'cloudRain'], 85: ['Snow showers', 'cloudSnow'], 86: ['Snow showers', 'cloudSnow'],
  95: ['Thunderstorm', 'cloudLightning'], 96: ['Thunderstorm with hail', 'cloudLightning'],
  99: ['Thunderstorm with hail', 'cloudLightning'],
};
const wmo = (code, day = 1) => {
  const [words, glyph] = WMO[code] || ['Unknown', 'cloud'];
  return [words, glyph === 'sun' && !day ? 'moon' : glyph];
};

const round = (v, dp = 0) => (v == null ? '—' : Number(v).toFixed(dp));

// ── wind: average, gust, direction ─────────────────────────────────────────
// Direction is where the wind comes FROM, as weather reports say it ("a south-
// easter"). The arrow points where it blows TO, which is what a shade net or a
// tunnel door feels — the words and the arrow together leave no doubt.
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = deg => (deg == null ? '—' : POINTS[Math.round(Number(deg) / 22.5) % 16]);

function arrow(deg) {
  const a = el('span', 'wx-arrow');
  if (deg == null) return a;
  a.append(icon('arrowUp'));
  a.style.transform = `rotate(${(Number(deg) + 180) % 360}deg)`;
  a.title = `From ${compass(deg)} (${Math.round(deg)}°)`;
  return a;
}

// The day's mean of the hourly speeds; null when the forecast has no hourly
// part (a copy saved on this device by the version before wind was added).
function dayAverage(wx, day) {
  const h = wx.hourly;
  if (!h?.time) return null;
  const v = h.time.map((t, i) => (t.startsWith(day) ? h.wind_speed_10m[i] : null)).filter(x => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const weekday = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short' });

// Fetch with a time limit: a Wi-Fi with no internet behind it can hang a minute.
async function getJson(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`weather service answered ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export function weatherCard(farm) {
  const card = el('section', 'card weather');
  card.setAttribute('aria-label', 'Weather');
  card.append(el('div', 'wx-loading', 'Reading the weather…'));
  load(card, farm);
  return card;
}

async function load(card, farm) {
  let row;
  try {
    [row] = await select('farm',
      `select=id,name,town,country,country_code,lat,lng,timezone&id=eq.${farm.id}`);
  } catch (e) {
    return say(card, e.message);
  }
  if (!row) return say(card, 'This FarmBox could not be read.');
  if (row.lat == null || row.lng == null) return ask(card, farm, row);

  const lat = Number(row.lat), lng = Number(row.lng);
  const url = `${FORECAST}?latitude=${lat}&longitude=${lng}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,' +
    'wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,' +
    'wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant' +
    // hourly speed only to average it: the daily figure Open-Meteo gives is the maximum
    '&hourly=wind_speed_10m' +
    `&timezone=${encodeURIComponent(row.timezone || 'auto')}&forecast_days=4&wind_speed_unit=kmh`;

  let wx, savedAt = null;
  try {
    wx = await getJson(url);
    try { localStorage.setItem(KEEP(farm.id), JSON.stringify({ at: Date.now(), lat, lng, wx })); }
    catch { /* private window: no offline copy */ }
  } catch {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(KEEP(farm.id)) || 'null'); } catch { kept = null; }
    if (!kept || kept.lat !== lat || kept.lng !== lng) {
      return say(card, 'No weather: the forecast needs a connection, and none was saved on this device yet.', row, farm);
    }
    wx = kept.wx;
    savedAt = kept.at;
  }
  paint(card, farm, row, wx, savedAt);
}

function say(card, message, row, farm) {
  card.textContent = '';
  card.className = 'card weather is-note';
  const wrap = el('div', 'wx-note');
  const badge = el('div', 'wx-icon');
  badge.append(icon('cloud'));
  wrap.append(badge, el('p', null, message));
  if (row && farm) wrap.append(links(row));
  card.append(wrap);
}

function paint(card, farm, row, wx, savedAt) {
  card.textContent = '';
  card.className = 'card weather';
  const c = wx.current, d = wx.daily;
  const [words, glyph] = wmo(c.weather_code, c.is_day);

  // now
  const now = el('div', 'wx-now');
  const badge = el('div', 'wx-icon');
  badge.append(icon(glyph));
  const big = el('div');
  big.append(el('div', 'wx-temp', `${round(c.temperature_2m)}°`));
  big.append(el('div', 'wx-cond', words));
  const wind = el('div', 'wx-wind');
  wind.append(arrow(c.wind_direction_10m),
    el('span', null, `${round(c.wind_speed_10m)} km/h · gusts ${round(c.wind_gusts_10m)} · from ${compass(c.wind_direction_10m)}`));
  wind.title = 'Wind now: average speed, gusts, and the direction it comes from';
  big.append(wind);
  now.append(badge, big);

  // today in one sentence, then the next days
  const mid = el('div', 'wx-mid');
  const rainMm = Number(d.precipitation_sum[0] || 0), rainPct = d.precipitation_probability_max[0];
  const [todayWords] = wmo(d.weather_code[0]);
  mid.append(el('p', 'wx-sum',
    `Today: ${todayWords.toLowerCase()}, ${round(d.temperature_2m_min[0])}–${round(d.temperature_2m_max[0])} °C, ` +
    (rainMm >= 0.1 ? `${round(rainMm, 1)} mm of rain` + (rainPct != null ? ` (${rainPct} %)` : '')
                   : 'no rain expected') +
    `, wind from ${compass(d.wind_direction_10m_dominant?.[0])} averaging ${round(dayAverage(wx, d.time[0]) ?? d.wind_speed_10m_max[0])} km/h` +
    ` with gusts up to ${round(d.wind_gusts_10m_max?.[0])} km/h. ` +
    `Feels like ${round(c.apparent_temperature)}°, humidity ${round(c.relative_humidity_2m)} %.`));

  const days = el('div', 'wx-days');
  d.time.forEach((t, i) => {
    const [w, g] = wmo(d.weather_code[i]);
    const day = el('div', 'wx-day');
    const avg = dayAverage(wx, t), gust = d.wind_gusts_10m_max?.[i], dir = d.wind_direction_10m_dominant?.[i];
    day.title = `${w} · ${round(d.precipitation_sum[i], 1)} mm · wind from ${compass(dir)}, ` +
      `average ${round(avg)} km/h, gusts ${round(gust)} km/h`;
    day.append(el('span', null, i === 0 ? 'Today' : weekday(t)), icon(g));
    const temps = el('span');
    temps.append(el('b', null, `${round(d.temperature_2m_max[i])}°`), document.createTextNode(` ${round(d.temperature_2m_min[i])}°`));
    day.append(temps);
    const mm = Number(d.precipitation_sum[i] || 0);
    day.append(el('span', 'wx-rain', mm >= 0.1 ? `${round(mm, 1)} mm` : '—'));
    // average / gust, km/h, and where from
    const dw = el('span', 'wx-dw');
    dw.append(arrow(dir), el('span', null, `${round(avg)}/${round(gust)}`), el('small', null, compass(dir)));
    day.append(dw);
    days.append(day);
  });
  mid.append(days);

  // where, when, and more
  const side = el('div', 'wx-side');
  const place = el('button', 'wx-place');
  place.type = 'button';
  place.title = 'Change the farm’s location';
  place.append(icon('pin'), el('span', null, row.town || `${round(row.lat, 2)}, ${round(row.lng, 2)}`));
  place.onclick = () => ask(card, farm, row, () => paint(card, farm, row, wx, savedAt));
  side.append(place);
  side.append(el('div', 'wx-when' + (savedAt ? ' is-old' : ''),
    savedAt ? `Offline — forecast saved at ${clock(savedAt)}` : `Updated ${clock(Date.now())} · Open-Meteo`));
  side.append(links(row));

  card.append(now, mid, side);
}

function links(row) {
  const lat = Number(row.lat), lng = Number(row.lng);
  const wrap = el('div', 'wx-links');
  const link = (href, text, title) => {
    const a = el('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = title;
    a.append(el('span', null, text), icon('external'));
    wrap.append(a);
  };
  link(`https://www.yr.no/en/forecast/daily-table/${lat.toFixed(4)},${lng.toFixed(4)}`,
    'Full forecast · yr.no', 'Day-by-day forecast for the farm on yr.no');
  link(`https://www.windy.com/?${lat.toFixed(3)},${lng.toFixed(3)},10`,
    'Wind & rain map · Windy', 'Wind, rain and clouds around the farm on Windy');
  return wrap;
}

// ── setting the farm's place ───────────────────────────────────────────────
function ask(card, farm, row, cancel) {
  card.textContent = '';
  card.className = 'card weather is-ask';

  const head = el('div', 'wx-now');
  const badge = el('div', 'wx-icon');
  badge.append(icon('pin'));
  const text = el('div');
  text.append(el('div', 'wx-cond', row.lat == null ? `Where is ${row.name}?` : `Move ${row.name}`));
  text.append(el('p', 'wx-sum', 'The weather is read for the farm’s location. Type the nearest town and pick it from the list.'));
  head.append(badge, text);

  const form = el('form', 'wx-form');
  const box = el('input');
  box.type = 'search';
  box.placeholder = 'Town, e.g. Stellenbosch';
  box.setAttribute('aria-label', 'Nearest town');
  box.value = row.town || '';
  const go = el('button', 'btn btn-sm btn-primary', 'Search');
  go.type = 'submit';
  form.append(box, go);
  if (cancel) {
    const no = el('button', 'btn btn-sm btn-ghost', 'Cancel');
    no.type = 'button';
    no.onclick = cancel;
    form.append(no);
  }

  const results = el('div', 'wx-results');
  form.onsubmit = async e => {
    e.preventDefault();
    const q = box.value.trim();
    if (q.length < 2) { box.focus(); return; }
    busy(go, true, 'Searching…');
    results.textContent = '';
    try {
      const base = `${GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
      let found = row.country_code ? (await getJson(`${base}&countryCode=${row.country_code}`)).results : null;
      if (!found?.length) found = (await getJson(base)).results;   // the farm's country first, then anywhere
      if (!found?.length) { results.append(el('p', 'wx-sum', `No place called “${q}”.`)); return; }
      found.forEach(p => {
        const b = el('button', 'btn btn-sm');
        b.type = 'button';
        b.append(document.createTextNode(p.name),
          el('small', null, [p.admin1, p.country].filter(Boolean).join(', ')));
        b.onclick = () => save(card, farm, row, p, b);
        results.append(b);
      });
    } catch (err) {
      results.append(el('p', 'wx-sum', 'The town search needs a connection.'));
    } finally {
      busy(go, false, 'Search');
    }
  };

  card.append(head, form, results);
  box.focus();
}

async function save(card, farm, row, place, button) {
  busy(button, true, 'Saving…');
  try {
    const lat = Math.round(place.latitude * 1e6) / 1e6, lng = Math.round(place.longitude * 1e6) / 1e6;
    const updated = await patch('farm', `id=eq.${row.id}`, { town: place.name, lat, lng });
    // Row-level security answers a refused update with no rows, not an error.
    if (!updated?.length) {
      toast('Only an organisation admin or this farm’s manager can set its location', 'bad');
      busy(button, false, place.name);
      return;
    }
    toast(`${row.name} is at ${place.name}`, 'ok');
    load(card, farm);
  } catch (e) {
    toast(e.message, 'bad');
    busy(button, false, place.name);
  }
}
