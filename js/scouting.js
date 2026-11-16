// ═══════════════════════════════════════════════════════════════════════════
// Pest & diseases — one page (console 0.7.101, migration 0099)
//
// The owner asked for one compact page instead of five tabs:
//   the dashboard at the top (open diseases, pests, treatments, traps over the
//   threshold, photos to look at, the pressure, the waits before harvest);
//   the open cases as a strip — each opens the case window;
//   a crop filter — the "by crop" view without a second layout;
//   the scouting reports by date, newest first — a date opens its zones, a
//   zone its traps (6–7, each with its count, its curve by date and its
//   photo) and its plant photos; any photo opens the viewer (zoom, tags, the
//   AI on request, compare, add to a case).
// A dot says the worst thing inside and climbs photo → zone → date → the side
// menu: red a severe case or a trap over the threshold, orange a case open or a
// trap on watch, green a case improving under treatment or resolved in 14 days.
// The trap setup (add, move, thresholds) is behind "Traps…".
// Since 0141 (console 0.7.153) the phone's scouting has sections: a plant photo
// is Plant health or Growth, carries its position (3B8) or its GPS and, for
// growth, the sizes measured on the printed scale card; the day ends OK or Not
// OK with a note. Since 0172 (console 0.7.168) the scouting is one task a zone: each zone band carries its
// own task (who, when, OK / not OK, the sections) from its zone line, and there is no GPS placing any more —
// a photo's zone is its task's (photos once placed by GPS alone are no longer listed).
// Since 0170 (console 0.7.166, owner: "the zones to select, to generate 5 reports") the unit's zones sit at
// the top: a chosen zone turns the page into that zone's report — its pressure, cases, crops, and each date
// with that zone's traps and photos only (scouting_dates.zone_counts). Remembered per unit.
// Since 0171 (console 0.7.167, owner: "split zone 4 in 4.1 and 4.2 report") the chips are report units: a zone,
// or each table of a zone reported by table (FarmLab Zone 4.1 and 4.2) — pest_overview.pressure_units,
// scouting_dates.unit_counts, scouting_day.units. A card or photo of the zone that names no table is in both.
// Since 0.7.177: under Plant health, Growth then Traps, each a full-width line that opens (Traps is seldom opened).
// Since 0.7.176: the zones of today's and yesterday's reports start with a compact AI opinion (Open, Ask again); Growth | Traps under Plant health,
// in the same two thirds / one third; no Trap map block on top of All zones.
// Since 0.7.175: Plant health is photos on two thirds, the zone's average insects a day and its trap map on the last
// third, the day's trap photos behind the map (no Traps block), Growth underneath.
// Since 0180 (console 0.7.174, owner 30 Sept 2026): today's and yesterday's reports open by themselves; each zone of a
// day starts with its Plant health section open — the 30 days' insects a day per trap and the cases' severity
// (zone_health), the zone's trap map as it stands, the plant-health photos — then two tiles, Traps and Growth, that
// open their photos. A zone's report starts with the AI's opinion (edge function zone-opinion, pressed only, kept in
// zone_opinion). There is no Traps page any more: the map of every zone is in the All zones report, a trap's
// window and history open from the report, Traps and limits… and Map size… sit in the page's head (trapKit).
// A scouting done before its day counts on the day it was done (app.work_day).
// Since 0.7.184 (0188): what the robot sent is in the day too — a line that opens beside Growth and Traps in the zone it
// named, or under the day's zones when it named none; a day only the robot worked gets its own date line.
// Since 0190 (console 0.7.187, owner 2 Oct 2026): on the right of Plant health, above Insects a day, the sump that
// feeds the zone — EC, pH and water temperature over 30 days, a click opens its window (js/sump.js). Growth is no
// longer a line that opens: its photos sit under the plant-health ones, with the sizes of 30 days as a curve
// (zone_growth). Every photo has a ✕ in its corner: it leaves the reports and is kept (remove_photo — the person who
// took it the same day, a manager any day); "Removed photos…" in the head puts one back within 30 days.
// Since 0197 (console 0.7.199, owner 2 Oct 2026): on the right of Plant health, first, the zone's treatments — a flag
// when an IPM program runs there, eight weeks as a small calendar (applied and to come, a colour per product) and
// Apply… to start a program of the library on the tables chosen (js/treatments.js).
// ═══════════════════════════════════════════════════════════════════════════
export { renderScouting } from './scouting/index.js';
