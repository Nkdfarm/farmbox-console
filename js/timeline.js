// ═══════════════════════════════════════════════════════════════════════════
// Crop planner — the timeline (console 0.7.113, migration 0105)
//
// One row per growing position, grouped by zone; time runs left to right. Each
// batch is a bar over the days it holds its position: growing, then the
// harvest (darker), then the cleanup (grey); its nursery is a hatched strip
// before it, off the row, because seedlings do not hold a position.
//
// A manager (or the agronomist) plans by hand:
//   · drag a crop from the palette onto a row — a proposal lands there, its
//     length the crop's own cycle; a row it does not fit, or a slot that is
//     taken, shows red while dragging;
//   · drag a bar to another day or another row (move_batch), its right edge to
//     lengthen or shorten the harvest (resize_batch);
//   · click a bar for the batch, click an empty day to plan one there;
//   · Shift-click bars to validate or remove several at once.
// The database checks every drop again; the colours only say it in advance.
// ═══════════════════════════════════════════════════════════════════════════
export { timelineRange, renderTimeline } from './timeline/index.js';
