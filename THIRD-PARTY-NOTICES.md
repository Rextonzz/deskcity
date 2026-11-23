# Third-party notices

Deskcity is MIT-licensed (see `LICENSE`). It includes or uses the work of others, listed here with the licence each needs.
Where a licence asks for its text or an attribution to travel with copies, it is below or in the file named.

## three.js (MIT)

`public/vendor/three.module.min.js` and `public/vendor/jsm/*` are unchanged copies of three.js **r160** (git tag `r160`, https://github.com/mrdoob/three.js), the build file and files from `examples/jsm`. The only change is a one-line version and licence comment added at the top of each `jsm` file. Which file comes from where is in `public/vendor/README.md`.

`public/vendor/jsm/environments/RoomEnvironment.js` is, in three.js's own words, based on Google's model-viewer scene (https://github.com/google/model-viewer, `EnvironmentScene.ts`), which is licensed under the Apache License 2.0. The licence text is in `public/vendor/LICENSE-Apache-2.0.txt`.

```
The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Tailwind CSS (MIT)

`public/tailwind.css` is generated with Tailwind CSS 3.4.17 (https://tailwindcss.com) from the classes the pages use, and committed as a built file. Nothing of Tailwind is loaded at run time.

```
MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts (SIL Open Font License 1.1)

Served by the hub itself from `public/fonts/` (no font service is contacted). Source: Google Fonts, Latin and Latin-extended subsets, as `.woff2`. No reserved font names are declared. The licence text and copyright lines are in `public/fonts/LICENSES.txt`; the files are used unmodified and are not sold by themselves.

| File | Font | Copyright |
|---|---|---|
| `geist-normal-latin.woff2`, `geist-normal-latin-ext.woff2` | Geist | 2024 The Geist Project Authors (https://github.com/vercel/geist-font) |
| `geist-mono-normal-latin.woff2`, `geist-mono-normal-latin-ext.woff2` | Geist Mono | 2024 The Geist Project Authors |
| `instrument-serif-normal-latin.woff2`, `instrument-serif-normal-latin-ext.woff2` | Instrument Serif | 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) |
| `instrument-serif-italic-latin.woff2`, `instrument-serif-italic-latin-ext.woff2` | Instrument Serif Italic | 2022 The Instrument Serif Project Authors |

## Word list for caption filtering (CC BY 4.0)

`src/pipeline/swears.txt` is **adapted** from the English list of the LDNOOBW project, "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words), © 2012-2020 Shutterstock, Inc., licensed under Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/).

Changes made: only the single-word entries were kept, lower-cased, and a few extra words were added. The repository does not record which commit of the list was copied or which entries are the extras, so neither is stated here. The adapted list is used only to star out words in captions. Deskcity's own licence does not apply to this file: it stays under CC BY 4.0.

## Icons and emoji

The five PNG icons in `public/` (`favicon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable.png`, `apple-touch-icon.png`) were created for this project (their metadata carries Content Credentials from the tool that made them). No icon set is bundled. Emoji in the pages are plain Unicode characters, drawn by your own system's emoji font.

## 3D props (`public/campus/3d/kit.json`)

`kit.json` holds 94 small low-poly props, stored as plain numbers (vertex positions and one colour per triangle), loaded by `public/campus/3d/kit.js`. No image or model file is loaded from a third party.

- **82 props are built by code** (Blender Python scripts in the author's repository): trees, benches, rooftop gear, office furniture, pet-room things and most store items.
- **12 props were generated by the owner with a 3D generation service under a paid plan** (the owner confirmed this on 2026-11-16) and are included as part of this project under its licence. They were then simplified in Blender and baked to flat colours: the six landmarks `lm_fountain`, `lm_bandstand`, `lm_foodtruck`, `lm_balloon`, `lm_bus`, `lm_car`, and the six store items `it_brasshourglass`, `it_miniconstructioncrane`, `it_mechanicaltallycounter`, `it_desktoprockgarden`, `it_ledredalertsiren`, `it_gildedbalancescales`. To leave them out, delete those 12 names from `props` in `kit.json`: the campus then falls back to its code-drawn shapes.

## npm packages

These are installed by `npm ci` from `package-lock.json` and are not copied into this repository. The table is made from the lock file by `tools/third-party-table.mjs` (a test checks that it is current). Every licence listed is a permissive one (MIT, ISC, BSD, Apache-2.0, Unlicense). Each package's own licence text is in its folder under `node_modules` after install.

<!-- npm-table:start (made by tools/third-party-table.mjs from package-lock.json; do not edit by hand) -->
| Package | Version | Licence | Used |
|---|---|---|---|
| @anthropic-ai/sdk | 0.135.0 | MIT | runtime |
| @babel/runtime | 7.29.10 | MIT | runtime |
| @cacheable/memory | 2.2.0 | MIT | development only |
| @cacheable/utils | 2.5.0 | MIT | development only |
| @eslint-community/eslint-utils | 4.10.1 | MIT | development only |
| @eslint-community/regexpp | 4.12.3 | MIT | development only |
| @eslint/config-array | 0.23.6 | Apache-2.0 | development only |
| @eslint/config-helpers | 0.7.0 | Apache-2.0 | development only |
| @eslint/core | 1.2.1 | Apache-2.0 | development only |
| @eslint/js | 10.0.1 | MIT | development only |
| @eslint/object-schema | 3.0.5 | Apache-2.0 | development only |
| @eslint/plugin-kit | 0.7.3 | Apache-2.0 | development only |
| @humanfs/core | 0.19.2 | Apache-2.0 | development only |
| @humanfs/node | 0.16.8 | Apache-2.0 | development only |
| @humanfs/types | 0.15.0 | Apache-2.0 | development only |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 | development only |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 | development only |
| @isaacs/nonrecursive-glob-match | 1.1.0 | BlueOak-1.0.0 | development only |
| @keyv/bigmap | 1.3.1 | MIT | development only |
| @keyv/serialize | 1.1.1 | MIT | development only |
| @opentelemetry/api | 1.9.1 | Apache-2.0 | runtime |
| @stablelib/base64 | 1.0.1 | MIT | runtime |
| @types/esrecurse | 4.3.1 | MIT | development only |
| @types/estree | 1.0.10 | MIT | development only |
| @types/json-schema | 7.0.15 | MIT | development only |
| @types/node | 26.6.6 | MIT | development only |
| @typescript/typescript-aix-ppc64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-darwin-x64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-freebsd-x64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-arm | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-arm64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-loong64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-mips64el | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-ppc64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-riscv64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-s390x | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-linux-x64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-netbsd-x64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-openbsd-x64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-sunos-x64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-win32-arm64 | 7.0.2 | Apache-2.0 | development only |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | development only |
| accepts | 2.0.0 | MIT | runtime |
| acorn | 8.19.0 | MIT | development only |
| acorn-jsx | 5.3.2 | MIT | development only |
| ajv | 6.15.0 | MIT | development only |
| balanced-match | 4.0.4 | MIT | development only |
| body-parser | 2.4.0 | MIT | runtime |
| brace-expansion | 5.0.13 | MIT | development only |
| bytes | 3.1.2 | MIT | runtime |
| cacheable | 2.5.0 | MIT | development only |
| call-bind-apply-helpers | 1.0.2 | MIT | runtime |
| call-bound | 1.0.4 | MIT | runtime |
| content-disposition | 2.0.1 | MIT | runtime |
| content-type | 2.1.0 | MIT | runtime |
| cookie | 0.7.2 | MIT | runtime |
| cookie-signature | 1.2.2 | MIT | runtime |
| cross-spawn | 7.0.6 | MIT | development only |
| debug | 4.4.3 | MIT | runtime |
| deep-is | 0.1.4 | MIT | development only |
| depd | 2.0.0 | MIT | runtime |
| dotenv | 18.0.8 | BSD-2-Clause | runtime |
| dunder-proto | 1.0.1 | MIT | runtime |
| ee-first | 1.1.1 | MIT | runtime |
| encodeurl | 2.0.0 | MIT | runtime |
| es-define-property | 1.0.1 | MIT | runtime |
| es-errors | 1.3.0 | MIT | runtime |
| es-object-atoms | 1.1.2 | MIT | runtime |
| escape-html | 1.0.3 | MIT | runtime |
| escape-string-regexp | 4.0.0 | MIT | development only |
| eslint | 10.15.0 | MIT | development only |
| eslint-scope | 9.1.2 | BSD-2-Clause | development only |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 | development only |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 | development only |
| espree | 11.2.0 | BSD-2-Clause | development only |
| esquery | 1.7.0 | BSD-3-Clause | development only |
| esrecurse | 4.3.0 | BSD-2-Clause | development only |
| estraverse | 5.3.0 | BSD-2-Clause | development only |
| esutils | 2.0.3 | BSD-2-Clause | development only |
| etag | 1.8.1 | MIT | runtime |
| express | 5.3.0 | MIT | runtime |
| fast-deep-equal | 3.1.3 | MIT | development only |
| fast-json-stable-stringify | 2.1.0 | MIT | development only |
| fast-levenshtein | 2.0.6 | MIT | development only |
| fast-sha256 | 1.3.0 | Unlicense | runtime |
| file-entry-cache | 11.1.5 | MIT | development only |
| finalhandler | 2.1.1 | MIT | runtime |
| find-up | 5.0.0 | MIT | development only |
| flat-cache | 6.1.23 | MIT | development only |
| flatted | 3.4.4 | ISC | development only |
| forwarded | 0.2.0 | MIT | runtime |
| fresh | 2.0.0 | MIT | runtime |
| function-bind | 1.1.2 | MIT | runtime |
| get-intrinsic | 1.3.0 | MIT | runtime |
| get-proto | 1.0.1 | MIT | runtime |
| glob-parent | 6.0.2 | ISC | development only |
| globals | 17.14.0 | MIT | development only |
| gopd | 1.2.0 | MIT | runtime |
| has-symbols | 1.1.0 | MIT | runtime |
| hashery | 1.5.1 | MIT | development only |
| hasown | 2.0.4 | MIT | runtime |
| hookified | 1.15.1 | MIT | development only |
| hookified | 2.2.0 | MIT | development only |
| http-errors | 2.0.1 | MIT | runtime |
| iconv-lite | 0.7.3 | MIT | runtime |
| ignore | 5.3.2 | MIT | development only |
| imurmurhash | 0.1.4 | MIT | development only |
| inherits | 2.0.4 | ISC | runtime |
| ipaddr.js | 1.9.1 | MIT | runtime |
| is-extglob | 2.1.1 | MIT | development only |
| is-glob | 4.0.3 | MIT | development only |
| is-promise | 4.0.0 | MIT | runtime |
| isexe | 2.0.0 | ISC | development only |
| json-schema-to-ts | 3.1.1 | MIT | runtime |
| json-schema-traverse | 0.4.1 | MIT | development only |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT | development only |
| keyv | 5.6.0 | MIT | development only |
| levn | 0.4.1 | MIT | development only |
| locate-path | 6.0.0 | MIT | development only |
| math-intrinsics | 1.1.0 | MIT | runtime |
| media-typer | 1.1.1 | MIT | runtime |
| merge-descriptors | 2.0.0 | MIT | runtime |
| mime-db | 1.54.0 | MIT | runtime |
| mime-types | 3.0.2 | MIT | runtime |
| minimatch | 11.0.9 | BlueOak-1.0.0 | development only |
| ms | 2.1.3 | MIT | runtime |
| natural-compare | 1.4.0 | MIT | development only |
| negotiator | 1.1.0 | MIT | runtime |
| object-inspect | 1.13.4 | MIT | runtime |
| on-finished | 2.4.1 | MIT | runtime |
| once | 1.4.0 | ISC | runtime |
| optionator | 0.9.4 | MIT | development only |
| p-limit | 3.1.0 | MIT | development only |
| p-locate | 5.0.0 | MIT | development only |
| parseurl | 1.3.3 | MIT | runtime |
| path-exists | 4.0.0 | MIT | development only |
| path-key | 3.1.1 | MIT | development only |
| path-to-regexp | 8.4.2 | MIT | runtime |
| prelude-ls | 1.2.1 | MIT | development only |
| proxy-addr | 2.0.8 | MIT | runtime |
| punycode | 2.3.1 | MIT | development only |
| qified | 0.10.1 | MIT | development only |
| qs | 6.16.1 | BSD-3-Clause | runtime |
| range-parser | 1.3.0 | MIT | runtime |
| raw-body | 3.0.2 | MIT | runtime |
| router | 2.2.0 | MIT | runtime |
| safer-buffer | 2.1.2 | MIT | runtime |
| send | 1.2.1 | MIT | runtime |
| serve-static | 2.2.1 | MIT | runtime |
| setprototypeof | 1.2.0 | ISC | runtime |
| shebang-command | 2.0.0 | MIT | development only |
| shebang-regex | 3.0.0 | MIT | development only |
| side-channel | 1.1.1 | MIT | runtime |
| side-channel-list | 1.0.1 | MIT | runtime |
| side-channel-map | 1.0.1 | MIT | runtime |
| side-channel-weakmap | 1.0.2 | MIT | runtime |
| standardwebhooks | 1.1.1 | MIT | runtime |
| statuses | 2.0.2 | MIT | runtime |
| toidentifier | 1.0.1 | MIT | runtime |
| ts-algebra | 2.0.0 | MIT | runtime |
| type-check | 0.4.0 | MIT | development only |
| type-is | 2.1.0 | MIT | runtime |
| typescript | 7.0.2 | Apache-2.0 | development only |
| undici-types | 8.9.0 | MIT | development only |
| unpipe | 1.0.0 | MIT | runtime |
| uri-js | 4.4.1 | BSD-2-Clause | development only |
| vary | 1.1.2 | MIT | runtime |
| which | 2.0.2 | ISC | development only |
| word-wrap | 1.2.5 | MIT | development only |
| wrappy | 1.0.2 | ISC | runtime |
| yocto-queue | 0.1.0 | MIT | development only |
<!-- npm-table:end -->

## Add-on: browser

These are installed by `npm run addons:install` from `addons/browser/package-lock.json` (npm ci in that folder), not by the core install, and only when the browser add-on is on or the YouTube or cards part needs it. They are not copied into this repository.

| Package | Version | Licence | Used |
|---|---|---|---|
| playwright | 1.63.0 | Apache-2.0 | runtime (add-on) |
| playwright-core | 1.63.0 | Apache-2.0 | runtime (add-on) |
