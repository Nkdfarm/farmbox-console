# FarmBox Console

The desktop front end of the **FarmBox Operations Platform** — the screens a
franchisee uses to run a FarmBox: farm setup, crops and the crop plan, people,
and the weekly labour plan.

Live: **https://nkdfarm.github.io/farmbox-console/**

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
