// ═══════════════════════════════════════════════════════════════════════════
// Weather — a tile, two wide, at the end of the dashboard's tiles
//
// The sky and the wind now, today and tomorrow, and links to a full forecast.
// Wind is given in full — average, gusts and where it comes from — because on
// a farm with tunnels and shade nets it matters as much as rain.
//
// The forecast comes from Open-Meteo: free, no key, no account, and it answers
// a browser directly, so nothing of ours sits in between. The links go to yr.no
// (a day-by-day table any farmer can read) and Windy (wind and rain on a map).
//
// The farm's place is farm.lat / farm.lng. It is set with locationPicker(),
// which is on the tile when nothing is set yet and on Farm setup always. The
// town search is Open-Meteo's geocoder, and the choice is saved on the farm row,
// which the database lets an organisation admin or the farm manager write.
// Nothing is guessed: a wrong town is a wrong forecast.
//
// The last forecast is kept on this device, so the tile still says something
// when the console is offline, and says how old it is.
// ═══════════════════════════════════════════════════════════════════════════
import { select, patch } from './api.js';
import { el, icon, toast, busy, field, parseYmd } from './ui.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const KEEP = id => 'fbc_wx_' + id;
const FARM_FIELDS = 'select=id,name,town,country,country_code,lat,lng,timezone';

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
const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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

// The day's mean of the hourly speeds (Open-Meteo's daily figure is the
// maximum); null when a forecast saved by an older version has no hourly part.
function dayAverage(wx, day) {
  const h = wx.hourly;
  if (!h?.time) return null;
  const v = h.time.map((t, i) => (t.startsWith(day) ? h.wind_speed_10m[i] : null)).filter(x => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

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

const readFarm = async id => (await select('farm', `${FARM_FIELDS}&id=eq.${id}`))[0];

// ── the tile ───────────────────────────────────────────────────────────────
export function weatherTile(farm) {
  const tile = el('div', 'tile wx-tile');
  tile.setAttribute('aria-label', 'Weather');
  tile.append(el('div', 'tile-sub', 'Reading the weather…'));
  load(tile, farm);
  return tile;
}

async function load(tile, farm) {
  let row;
  try { row = await readFarm(farm.id); }
  catch (e) { return note(tile, e.message); }
  if (!row) return note(tile, 'This FarmBox could not be read.');
  if (row.lat == null || row.lng == null) return noPlace(tile, farm, row);

  const lat = Number(row.lat), lng = Number(row.lng);
  const url = `${FORECAST}?latitude=${lat}&longitude=${lng}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,' +
    'wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,' +
    'wind_gusts_10m_max,wind_direction_10m_dominant' +
    '&hourly=wind_speed_10m' +
    `&timezone=${encodeURIComponent(row.timezone || 'auto')}&forecast_days=2&wind_speed_unit=kmh`;

  let wx, savedAt = null;
  try {
    wx = await getJson(url);
    try { localStorage.setItem(KEEP(farm.id), JSON.stringify({ at: Date.now(), lat, lng, wx })); }
    catch { /* private window: no offline copy */ }
  } catch {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(KEEP(farm.id)) || 'null'); } catch { kept = null; }
    if (!kept || kept.lat !== lat || kept.lng !== lng) {
      return note(tile, 'The forecast needs a connection, and none was saved on this device yet.', row);
    }
    wx = kept.wx;
    savedAt = kept.at;
  }
  paint(tile, farm, row, wx, savedAt);
}

function badge(glyph) {
  const b = el('div', 'tile-icon');
  b.append(icon(glyph));
  return b;
}

function note(tile, message, row) {
  tile.textContent = '';
  tile.className = 'tile wx-tile is-note';
  const body = el('div', 'tile-body');
  body.append(el('div', 'tile-label', 'Weather'), el('div', 'tile-sub', message));
  if (row) body.append(forecastLinks(row));
  tile.append(badge('cloud'), body);
}

function noPlace(tile, farm, row) {
  tile.textContent = '';
  tile.className = 'tile wx-tile is-note';
  const body = el('div', 'tile-body');
  body.append(el('div', 'tile-label', `Weather — where is ${row.name}?`));
  body.append(el('div', 'tile-sub', 'The forecast is read for the farm’s location, and none is set yet.'));
  const actions = el('div', 'wx-actions');
  const set = el('button', 'btn btn-sm btn-primary', 'Set the location');
  set.type = 'button';
  set.onclick = () => pick(tile, farm, row, () => noPlace(tile, farm, row));
  const setup = el('a', 'btn btn-sm btn-ghost', 'Farm setup');
  setup.href = '#/farm';
  actions.append(set, setup);
  body.append(actions);
  tile.append(badge('pin'), body);
}

function pick(tile, farm, row, back) {
  tile.textContent = '';
  tile.className = 'tile wx-tile is-note';
  const body = el('div', 'tile-body');
  body.append(el('div', 'tile-label', row.lat == null ? `Where is ${row.name}?` : `Move ${row.name}`));
  body.append(locationPicker(row, { onSaved: () => load(tile, farm), onCancel: back }));
  tile.append(badge('pin'), body);
}

function paint(tile, farm, row, wx, savedAt) {
  tile.textContent = '';
  tile.className = 'tile wx-tile';
  const c = wx.current, d = wx.daily;
  const [words, glyph] = wmo(c.weather_code, c.is_day);

  // now: the sky, then the wind in full
  const now = el('div', 'wx-now');
  const body = el('div', 'tile-body');
  body.append(el('div', 'tile-value', `${round(c.temperature_2m)}°`));
  body.append(el('div', 'tile-label', words));
  const wind = el('div', 'wx-wind');
  wind.title = 'Wind now: average speed, gusts, and the direction it comes from';
  wind.append(arrow(c.wind_direction_10m),
    el('span', null, `${round(c.wind_speed_10m)} km/h · gusts ${round(c.wind_gusts_10m)} · from ${compass(c.wind_direction_10m)}`));
  body.append(wind);
  body.append(el('div', 'tile-sub',
    `Feels ${round(c.apparent_temperature)}° · humidity ${round(c.relative_humidity_2m)} %`));
  now.append(badge(glyph), body);

  // today and tomorrow
  const days = el('div', 'wx-days');
  d.time.slice(0, 2).forEach((t, i) => {
    const [w, g] = wmo(d.weather_code[i]);
    const avg = dayAverage(wx, t), gust = d.wind_gusts_10m_max?.[i], dir = d.wind_direction_10m_dominant?.[i];
    const mm = Number(d.precipitation_sum[i] || 0), pct = d.precipitation_probability_max?.[i];
    const day = el('div', 'wx-day');
    day.title = `${w} · ${round(mm, 1)} mm` + (pct != null ? ` (${pct} %)` : '') +
      ` · wind from ${compass(dir)}, average ${round(avg)} km/h, gusts ${round(gust)} km/h`;
    const top = el('div', 'wx-day-top');
    top.append(el('span', null, i === 0 ? 'Today' : 'Tomorrow'), icon(g));
    day.append(top);
    const temps = el('div');
    temps.append(el('b', null, `${round(d.temperature_2m_max[i])}°`),
                 document.createTextNode(` ${round(d.temperature_2m_min[i])}°`));
    day.append(temps);
    day.append(el('div', 'wx-rain', mm >= 0.1 ? `${round(mm, 1)} mm` + (pct != null ? ` · ${pct} %` : '') : 'no rain'));
    const dw = el('div', 'wx-dw');
    dw.append(arrow(dir), el('span', null, `${round(avg)}/${round(gust)}`), el('small', null, compass(dir)));
    day.append(dw);
    days.append(day);
  });

  // where, when, and more
  const foot = el('div', 'wx-foot');
  const place = el('button', 'wx-place');
  place.type = 'button';
  place.title = 'Change the farm’s location';
  place.append(icon('pin'), el('span', null, row.town || `${round(row.lat, 2)}, ${round(row.lng, 2)}`));
  place.onclick = () => pick(tile, farm, row, () => paint(tile, farm, row, wx, savedAt));
  const when = el('span', 'wx-when' + (savedAt ? ' is-old' : ''),
    savedAt ? `Offline — saved ${clock(savedAt)}` : `Updated ${clock(Date.now())}`);
  foot.append(place, when, forecastLinks(row));

  tile.append(now, days, foot);
}

export function forecastLinks(row) {
  const lat = Number(row.lat), lng = Number(row.lng);
  const wrap = el('span', 'wx-links');
  const link = (href, text, title) => {
    const a = el('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = title;
    a.append(el('span', null, text), icon('external'));
    wrap.append(a);
  };
  link(`https://www.yr.no/en/forecast/daily-table/${lat.toFixed(4)},${lng.toFixed(4)}`,
    'yr.no', 'Full day-by-day forecast for the farm on yr.no');
  link(`https://www.windy.com/?${lat.toFixed(3)},${lng.toFixed(3)},10`,
    'Windy', 'Wind, gusts and rain around the farm on a map (Windy)');
  return wrap;
}

// ── setting the farm's place ───────────────────────────────────────────────
// A town search that saves town, lat and lng on the farm. On the tile and on
// Farm setup; onSaved gets the updated farm row.
export function locationPicker(row, { onSaved, onCancel } = {}) {
  const wrap = el('div', 'wx-picker');
  const form = el('form', 'wx-form');
  const box = el('input');
  box.type = 'search';
  box.id = 'wx-town-' + row.id + (onCancel ? '-tile' : '');
  box.placeholder = 'Town, e.g. Stellenbosch';
  box.value = row.town || '';
  box.autocomplete = 'off';
  const go = el('button', 'btn btn-sm btn-primary', 'Search');
  go.type = 'submit';
  form.append(field('Nearest town', box), go);
  if (onCancel) {
    const no = el('button', 'btn btn-sm btn-ghost', 'Cancel');
    no.type = 'button';
    no.onclick = onCancel;
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
      if (!found?.length) { results.append(el('span', 'tile-sub', `No place called “${q}”.`)); return; }
      found.forEach(p => {
        const b = el('button', 'btn btn-sm');
        b.type = 'button';
        b.append(document.createTextNode(p.name),
          el('small', null, [p.admin1, p.country].filter(Boolean).join(', ')));
        b.onclick = () => save(row, p, b, onSaved);
        results.append(b);
      });
    } catch {
      results.append(el('span', 'tile-sub', 'The town search needs a connection.'));
    } finally {
      busy(go, false, 'Search');
    }
  };

  wrap.append(form, results);
  if (onCancel) setTimeout(() => box.focus(), 0);   // opened on purpose, so start typing
  return wrap;
}

async function save(row, place, button, onSaved) {
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
    onSaved?.(updated[0]);
  } catch (e) {
    toast(e.message, 'bad');
    busy(button, false, place.name);
  }
}

// Farm setup reads the same row the tile does.
export { readFarm };
