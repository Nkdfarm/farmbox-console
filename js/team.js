// ═════════════════════════════════════════════════════════════════════
// Tasks › Team (migration 0216, console 0.7.222)
//
// One page for the people, what each of them is responsible for, and who comes
// first — it replaces Farm setup › People and Tasks › Hours.
//
// For every family or sub-family the people responsible for it are numbered
// 1…k ("Crop care 1", "Crop care 2"): the plan gives the work to number 1
// until their day is full, then to number 2. The numbers come from the job
// (what the job is responsible for) and the person's place among the people
// with the same job; a chip is clicked to set one number by hand. A number is
// never held twice: choosing one that is taken shows who holds it and both
// ways out (swap, or insert and move the others down) before anything changes.
// ═════════════════════════════════════════════════════════════════════
export { renderTeam } from './team/index.js';
export { teamWeek } from './team/state.js';
