// npm run lint: catches real mistakes (a name that doesn't exist, a duplicate key, unreachable code, a typo in a
// comparison), not style. Added 2026-11-20 after the outside code reviews: several AI sessions edit this repo, and
// node --check plus the tests miss a misspelt variable in a branch no test reaches.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "data/**", "output/**", "inbox/**", ".claude/**", ".wt/**", "References/**", "reference/**", "linux/**", "python/**", "docs/**", "public/vendor/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    // browser names too: Playwright page.evaluate() callbacks in src/ and tools/ run in the page
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    rules: {
      // style and leftovers: not what this gate is for
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "no-cond-assign": "off",
      "no-constant-condition": "off",
      "no-unused-private-class-members": "off",
      "preserve-caught-error": "off",
      "no-useless-assignment": "off",
      "no-case-declarations": "off",
      "no-regex-spaces": "off",
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }],
    },
  },
  {
    // the dashboard pages run in the browser
    files: ["public/**/*.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.browser, timing: "readonly", runLog: "readonly", __THREE_DEVTOOLS__: "readonly" } },
  },
  {
    // the campus parts are classic scripts sharing one global scope in load order (campus.html), so a name from
    // another part looks undefined here; campus-globals.test.mjs checks those instead
    files: ["public/campus/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
    rules: { "no-undef": "off", "no-redeclare": "off" },
  },
  {
    // the 3D campus and its boot script are ES modules
    files: ["public/campus/3d/**/*.js", "public/campus/boot.js"],
    languageOptions: { sourceType: "module" },
  },
  {
    // scripts that drive the campus page in a browser and use its globals inside page.evaluate()
    files: ["tools/campus-check.mjs", "tools/campus-lifecheck.mjs", "tools/trailer/**"],
    rules: { "no-undef": "off" },
  },
];
