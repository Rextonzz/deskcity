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
| @opentelemetry/api | 1.9.1 | Apache-2.0 | runtime |
| @stablelib/base64 | 1.0.1 | MIT | runtime |
| accepts | 2.0.0 | MIT | runtime |
| body-parser | 2.4.0 | MIT | runtime |
| bytes | 3.1.2 | MIT | runtime |
| call-bind-apply-helpers | 1.0.2 | MIT | runtime |
| call-bound | 1.0.4 | MIT | runtime |
| content-disposition | 2.0.1 | MIT | runtime |
| content-type | 2.1.0 | MIT | runtime |
| cookie | 0.7.2 | MIT | runtime |
| cookie-signature | 1.2.2 | MIT | runtime |
| debug | 4.4.3 | MIT | runtime |
| depd | 2.0.0 | MIT | runtime |
| dotenv | 18.0.8 | BSD-2-Clause | runtime |
| dunder-proto | 1.0.1 | MIT | runtime |
| ee-first | 1.1.1 | MIT | runtime |
| encodeurl | 2.0.0 | MIT | runtime |
| es-define-property | 1.0.1 | MIT | runtime |
| es-errors | 1.3.0 | MIT | runtime |
| es-object-atoms | 1.1.2 | MIT | runtime |
| escape-html | 1.0.3 | MIT | runtime |
| etag | 1.8.1 | MIT | runtime |
| express | 5.3.0 | MIT | runtime |
| fast-sha256 | 1.3.0 | Unlicense | runtime |
| finalhandler | 2.1.1 | MIT | runtime |
| forwarded | 0.2.0 | MIT | runtime |
| fresh | 2.0.0 | MIT | runtime |
| function-bind | 1.1.2 | MIT | runtime |
| get-intrinsic | 1.3.0 | MIT | runtime |
| get-proto | 1.0.1 | MIT | runtime |
| gopd | 1.2.0 | MIT | runtime |
| has-symbols | 1.1.0 | MIT | runtime |
| hasown | 2.0.4 | MIT | runtime |
| http-errors | 2.0.1 | MIT | runtime |
| iconv-lite | 0.7.3 | MIT | runtime |
| inherits | 2.0.4 | ISC | runtime |
| ipaddr.js | 1.9.1 | MIT | runtime |
| is-promise | 4.0.0 | MIT | runtime |
| json-schema-to-ts | 3.1.1 | MIT | runtime |
| math-intrinsics | 1.1.0 | MIT | runtime |
| media-typer | 1.1.1 | MIT | runtime |
| merge-descriptors | 2.0.0 | MIT | runtime |
| mime-db | 1.54.0 | MIT | runtime |
| mime-types | 3.0.2 | MIT | runtime |
| ms | 2.1.3 | MIT | runtime |
| negotiator | 1.1.0 | MIT | runtime |
| object-inspect | 1.13.4 | MIT | runtime |
| on-finished | 2.4.1 | MIT | runtime |
| once | 1.4.0 | ISC | runtime |
| parseurl | 1.3.3 | MIT | runtime |
| path-to-regexp | 8.4.2 | MIT | runtime |
| playwright | 1.63.0 | Apache-2.0 | runtime |
| playwright-core | 1.63.0 | Apache-2.0 | runtime |
| proxy-addr | 2.0.8 | MIT | runtime |
| qs | 6.16.1 | BSD-3-Clause | runtime |
| range-parser | 1.3.0 | MIT | runtime |
| raw-body | 3.0.2 | MIT | runtime |
| router | 2.2.0 | MIT | runtime |
| safer-buffer | 2.1.2 | MIT | runtime |
| send | 1.2.1 | MIT | runtime |
| serve-static | 2.2.1 | MIT | runtime |
| setprototypeof | 1.2.0 | ISC | runtime |
| side-channel | 1.1.1 | MIT | runtime |
| side-channel-list | 1.0.1 | MIT | runtime |
| side-channel-map | 1.0.1 | MIT | runtime |
| side-channel-weakmap | 1.0.2 | MIT | runtime |
| standardwebhooks | 1.1.1 | MIT | runtime |
| statuses | 2.0.2 | MIT | runtime |
| toidentifier | 1.0.1 | MIT | runtime |
| ts-algebra | 2.0.0 | MIT | runtime |
| type-is | 2.1.0 | MIT | runtime |
| unpipe | 1.0.0 | MIT | runtime |
| vary | 1.1.2 | MIT | runtime |
| wrappy | 1.0.2 | ISC | runtime |
<!-- npm-table:end -->
