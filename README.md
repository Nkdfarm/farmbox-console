# Naked Heart

The desktop console of the **FarmBox Operations Platform** (called FarmBox Console
until 25 Sept 2026) — the screens a franchisee and the office use to run a FarmBox:
dashboard, farm setup, crops and the crop plan, people and the weekly labour plan,
scouting, purchasing, orders, money, cameras and sensors.

Live: **https://heart.nkd.farm/** (the old address
https://nkdfarm.github.io/farmbox-console/ redirects there)

The phone app for the floor is **Naked Brain**: https://brain.nkd.farm/
(repository `Nkdfarm/naked-brain`).

This repository is the published copy. The source is `console/` in the private
repository `Nkdfarm/FarmBox-Platform`, and it is published here only by the
owner's script `scripts/deploy-console.ps1` — do not edit these files directly.

It installs: open it in Chrome or Edge and use *Install app*, or *Add to Home
Screen* on a phone.

## What this repository is

Static files, no build step: `index.html`, `styles.css`, ES modules under `js/`,
an icon set and a service worker. Open `index.html` behind any web server and
it runs — `python -m http.server` is enough.

It is deliberately only the front end. The database, its row-level security,
the migrations, the edge functions and every farm's data live in a private
repository and in Supabase.

## About the key in `js/api.js`

That is a Supabase **anon** key. It is public by design: it identifies the
project, not a person. Everything behind it needs a signed-in account, and
row-level security decides what that account may read and write — a farm
manager sees one FarmBox, the franchisor sees all of them. There is no service
key here and there never will be; anything needing one runs in an edge
function.

## The service worker

Network first, cache second. The console changes weekly, so being installed
must never mean running last week's code; the cache is there for the walk
between the office and the container, where the signal drops. Bump `CACHE` in
`sw.js` when the shell changes.
