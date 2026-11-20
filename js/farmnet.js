// ═══════════════════════════════════════════════════════════════════════════
// FarmNet — the farm's FarmNet controller, live, on a page of its own
// (migration 0272, edge function `farmnet`; owner, 5 Nov 2026: "start building
// the page to manage the Farmnet information and control", then "a dedicated
// page dashboard in naked heart where control and read all main information of
// farmnet software"; who may send a command: "farm manager and admin").
//
// Everything is asked of FarmNet itself through the function, which signs each
// call (the controller's key never reaches the browser). Seven tabs:
//   Overview    alarms, irrigation, the mixer, the day tank, today's runs, the
//               chosen sensors live and over 24 h, the climate zones, the last
//               commands — read again every minute while it is on screen
//   Irrigation  the water's way (tanks drawn to their level), today's programs on a clock, the recipes
//               drawn and, for the Admin and Farm manager, changed (20 Nov 2026); runs
//   Mixing      each mixer live; its programs, its runs, the recipes in a list
//   Climate     each zone's devices and their state; its setpoints
//   Sensors     every signal source FarmNet has: choose up to 8 for the
//               Overview, live values and history
//   Alarms      now, and the past ones
//   Commands    the log of every command, sent or refused (0272)
// The farm's Admin and Farm manager also get the commands: start an irrigation
// or a mixing program by hand, pause, resume, stop the current run, change a
// zone's setpoints. Each one is confirmed here, checked again in the function
// (no deleting, no device settings, no shutting the system down) and logged.
// Connections › FarmNet & sensors keeps what comes in through `ingest`.
// ═══════════════════════════════════════════════════════════════════════════
export { renderFnOverview } from './farmnet/overview.js';
export { renderFnMixing, renderFnClimate } from './farmnet/control.js';
export { renderFnIrrigation } from './farmnet/irrigation.js';
export { renderFnSensors, renderFnAlarms, renderFnCommands } from './farmnet/sensors.js';
export { forgetFarmnet } from './farmnet/shell.js';   // the answers kept for opening a page at once (shell.js): gone at sign-out
