# addons/

Drop-in add-ons live here, one folder each: `addons/<id>/`. This folder ships with one add-on, `browser` (below). Every add-on is off until it is switched on, and nothing in an add-on's folder is run before that.

Each add-on has an `addon.json`:

```json
{
  "id": "my-addon",
  "name": "My add-on",
  "hubApi": 1,
  "entry": "index.js",
  "clientPanel": "panel.js",
  "pages": [{ "label": "My page", "href": "/addons/my-addon/page.html" }],
  "timers": ["My timer"]
}
```

- `id` matches `[a-z0-9-]{1,40}` and equals the folder name (`client` and `kill` are reserved).
- `hubApi` must be `1`. `entry` (default `index.js`) and `clientPanel` must stay inside the add-on's folder.
- The entry's default export may offer `routes(router, helpers)` (mounted only under `/api/addons/<id>/`) and `start({ every, timerOn })` (timers; not started when jobs are disabled). `helpers.dataDir` is `data/addons/<id>/` unless `addonFolders.dataDirs.<id>` in `data/hub-settings.json` names another folder, which is how an add-on keeps files that already exist.
- `clientPanel` is served at `/addons/<id>/panel.js` and loaded by the pages while the add-on is on. `pages` become doors in the campus Control building.

Switching on and off: `addonFolders: { "on": ["my-addon"], "killSwitch": false }` in `data/hub-settings.json`, or `POST /api/addons/<id>` with `{ "on": true }` (needs the dashboard password). `POST /api/addons/kill` with `{ "killSwitch": true }` turns every add-on off. Changes apply after a restart.

Add-ons run with full access to the hub's Node process: enable only ones you trust (`docs/kit/SECURITY.md`). An add-on's own dependencies go in `addons/<id>/node_modules/`, which git ignores. Install them with `npm run addons:install` (it runs `npm ci` in each add-on folder that has a `package.json` and is switched on; `--dry-run` shows the plan). The installer and `npm run update` do this for you.

The `browser` add-on is the one that ships: it holds the browser-automation package that the YouTube and cards parts use to drive a browser. It is installed while it is switched on or one of those parts is on. Code reaches it through `src/addons/playwright.js`, which also still finds the package in the core `node_modules` of an older install.
