# Contributing

Thanks for wanting to help. Deskcity is licensed under MIT, and contributions are accepted under the same licence.

An honest note first: most of the code was written by AI and reviewed by tests and one human. Please keep that in mind when you read it, and tell us if something looks wrong.

## Report problems and ideas

Use the issue templates: a bug report (what you did, what you expected, your OS, Node version, hub version, view and preset) or feedback (what is confusing, what is missing). For a security problem, do not open an issue: see SECURITY.md.

## Run the tests

You need Node.js 20 or newer. In the hub folder:

```
npm install
npm test
```

The tests run with Node's built-in test runner on `test/**/*.test.mjs` (`tools/run-tests.mjs` lists the files, so Node 20 works). They use a stand-in for AI and GitHub and a throwaway data folder, so they need no keys and no network. They never touch your `data/` folder.

Check the syntax of a server file you changed:

```
node --check <file>
```

Please add a test for any change to `src/`. Tests for the hub are in `test/hub/`.

## Zero build step

There is no bundler, no transpiler and no framework build. The hub is Node and Express on the server and plain scripts in the browser. What you edit is what runs.

One rule follows from that. The campus (`public/campus.html` and `public/campus/*.js`) is plain scripts in one shared scope. They load in order. If two files declare the same top-level name, the later one replaces the earlier and can break the whole page. `boot.js` also puts a few helpers (`esc`, `api`, `ago`, `ageText`, `money`, `spend`, `confirmBox`) on `window`, so a campus file must not declare those names at the top level. The tests check this. If a test about names fails, rename yours or wrap it in a function.

Server changes (`server.js`, `src/`) need a restart of the hub. Page changes (`public/`) only need a reload.

## Code style

- Plain JavaScript modules on the server. Match the style of the file you are in.
- Comments explain why, in plain English, not what.
- No new packages unless there is no sensible way without. Keep the install small.
- Escape every outside or AI-written string before it goes into a page (`esc()` in `public/lib.js`) and use `safeUrl()` for links built from data.
- Anything that spends money or writes outside the hub must ask for the dashboard password.
- Never commit `.env`, `data/` or anything from `data/agents/token.txt`.
- No personal details, names or other projects' names in code, comments or docs: the kit is generic.

## Add a part

A part is an optional switch. Add an entry to the list in `src/hub/modules.js` with its `id`, `name`, `group`, `about`, and what it owns: `pages` (`public/<name>.html`), `routes` (server routes under `/api/pipeline`), `timers` and `needs`. One switch then turns all of it off. Add it to a preset only if it should be on by default there. `node tools/setup.mjs --parts` lists the result.

## Add a page block

A page block is a hub page that works both as its own page and inside the campus. Put its working part in `public/parts/<page>.js` (see `public/parts/todo.js` and the shared helpers in `public/parts/kit.js`), list it in `public/parts/registry.js`, and give it a building in `public/campus/panels.js`. A block belongs to a part, so switching the part off hides the block. The tests in `test/hub/page-blocks.test.mjs` check the registry, the doors and the parts.

## Send a change

1. Open an issue for anything big, so we can agree before you spend time.
2. Make a branch, make the change, add or update tests, run `npm test`.
3. Open a pull request that says what changed and why, and what you did not check.
