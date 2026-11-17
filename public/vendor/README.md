# Vendored libraries

## three.js r160
- Version: r160 (git tag `r160`, commit d04539a76736ff500cae883d6a38b3dd8643c548), from https://github.com/mrdoob/three.js
- Licence: MIT, Copyright 2010-2023 three.js authors (https://github.com/mrdoob/three.js/blob/r160/LICENSE)
- Unchanged copies of these files, except that each `jsm` file has one comment line added at the top with the version, the copyright line and the licence (public/vendor/jsm/environments/RoomEnvironment.js also names the Apache-2.0 model-viewer code it is based on; the text is in LICENSE-Apache-2.0.txt). The notices for the whole kit are in THIRD-PARTY-NOTICES.md:

| Here | From the r160 tag |
|---|---|
| `three.module.min.js` | `build/three.module.min.js` |
| `jsm/controls/OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` |
| `jsm/controls/MapControls.js` | `examples/jsm/controls/MapControls.js` (in r160 MapControls is its own file that extends OrbitControls; OrbitControls.js does not export it) |
| `jsm/renderers/CSS2DRenderer.js` | `examples/jsm/renderers/CSS2DRenderer.js` |
| `jsm/utils/BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` |
| `jsm/environments/RoomEnvironment.js` | `examples/jsm/environments/RoomEnvironment.js` (soft room light, polish pass) |
| `jsm/geometries/RoundedBoxGeometry.js` | `examples/jsm/geometries/RoundedBoxGeometry.js` (rounded edges, polish pass) |

Pages load them through an import map: `"three": "./vendor/three.module.min.js"` (or `/vendor/...`) and
`"three/addons/": "./vendor/jsm/"`. The addons import `three` by name, so the import map is required.

Check every API against these files, not newer online docs (for example: `mergeGeometries`, not the old
`mergeBufferGeometries`; `zoomToCursor` exists on OrbitControls/MapControls in r160).

To update: clone the new tag (`git clone --depth 1 --branch rNNN --filter=blob:none --sparse https://github.com/mrdoob/three.js.git`,
then `git sparse-checkout set build examples/jsm/controls examples/jsm/renderers examples/jsm/utils examples/jsm/environments examples/jsm/geometries`), copy the same
files over, keep all of them on the same version, and re-check `public/campus3d-lab.html`.
