// ═══════════════════════════════════════════════════════════════════════════
// Tasks — the week as a board (console 0.7.67; before that "Weekly plan")
//
// The owner wanted it to read like Tend's Tasks: a calendar of the week, one
// chip per task coloured by what kind of work it is, the people on it, a
// menu; filters across the top; a day and a month view; a list for those who
// prefer rows. The Friday plan (spec §9.3) is still here — the roster, the
// load, what the planner could not settle, Draft and Validate — behind one
// button, because it is a decision made once a week, not the thing you look
// at every day.
//
// The data is still app.labour_week(farm, monday): a month is its weeks read
// together. Colour is the sub-family's hue (ui.js subFamilyHue), the same as
// on Procedures and People, so Irrigation is the same blue everywhere.
// ═══════════════════════════════════════════════════════════════════════════
export { renderWeek, defaultWeek, nextWeek } from './week/index.js';
