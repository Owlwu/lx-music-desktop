# DEVELOPMENT.md — Setup, run, build, package

> Everything an agent needs to build and run the project locally. Commands are from `package.json`
> (v2.12.2). **Node `>= 22` and npm `>= 8.5.2` are required.**

## Environment

- **Node.js `>= 22`** (hard `engines` requirement), npm `>= 8.5.2`.
- `postinstall` runs `electron-builder install-app-deps` — it rebuilds the **native** deps
  (`better-sqlite3`, `bufferutil`, `utf-8-validate`, and the custom `qrc_decode.node`) for the installed
  Electron ABI. Keep a working C++ toolchain / prebuilt cache available, or install will fail.
- Forked GitHub deps (see `package.json`) are pinned to specific commits — use an environment with GitHub
  access for `npm install`.
- Target renderer browserslist: `Electron 22.3.0` (transpilation target; the runtime Electron is `40.9.2`).

## Install

```
npm install          # installs deps AND runs postinstall (native rebuild for Electron)
```

## Run in development

```
npm run dev
```
- `build-config/runner-dev.js` starts **four** webpack builds in parallel, then launches Electron:
  - `main` — webpack (`target: electron-main`), watched; Electron restarts on main changes
    (inspector on `--inspect=5858`).
  - `renderer` — `webpack-dev-server` on **port 9080** with HMR (`src/renderer/main.ts`).
  - `renderer-lyric` — `webpack-dev-server` on **port 9081** (desktop-lyric window, `src/renderer-lyric/main.ts`).
  - `renderer-scripts` — bundled user-API default scripts, watched.
- It also calls `replaceLib` (`build-before-pack.js`) to wire native libs.
- Free ports 9080/9081 before running.

## Build (bundle only, no installer)

```
npm run build               # = node build-config/pack.js  (builds all bundles into dist/)
npm run build:main          # webpack main  → dist/main.js
npm run build:renderer      # webpack renderer → dist/renderer.js + index.html
npm run build:renderer-lyric
npm run build:renderer-scripts
```
`npm run build` (pack.js) is what the `pack:*`/`publish:*` scripts call before packaging.

## Package (installers / portable)

`build-config/build-pack.js` reads `target= arch= type= [publish=]` query args and invokes
`electron-builder` with the matching config in `build-config/lib/`.

```
npm run pack                    # win x64 setup (build + pack:win:setup:x64)
npm run pack:win                # all win targets: setup x86_64/x64/x86/arm64 + 7z
npm run pack:win:portable       # portable (green) variants
npm run pack:linux              # deb (amd64/arm64/armv7l) + appImage + rpm + pacman
npm run pack:mac                # dmg x64 + arm64
npm run pack:dir                # unpacked dir build
```
`publish:*` variants add `publish=always` (uploads to the release). `win7_*` targets build for legacy
Windows 7.

## Lint

```
npm run lint        # eslint (ts/js/vue) with friendly formatter, over src/
npm run lint:fix    # auto-fix
```
Lint also runs **inside** each webpack build via `eslint-webpack-plugin`, so a build fails on lint errors.

## Other scripts
- `npm run build:theme` — `node src/common/theme/createThemes.js` regenerates theme files.
- `npm run dp` / `npm run up` — install/pack through an HTTP(S) proxy at `127.0.0.1:2081`.
- `npm run publish` — `node publish` (release flow).

## Bundles & outputs (webpack)

| Target | Entry | Output | Config |
| --- | --- | --- | --- |
| main | `src/main/index.ts` | `dist/main.js` | `build-config/main/webpack.config.{base,dev,prod}.js` |
| renderer | `src/renderer/main.ts` | `dist/renderer.js`, `dist/index.html` | `build-config/renderer/...` |
| renderer-lyric | `src/renderer-lyric/main.ts` | `dist/renderer-lyric.js` | `build-config/renderer-lyric/...` |
| renderer-scripts | bundled user-API scripts | `dist/...` | `build-config/renderer-scripts/...` |

`main` uses `target: electron-main` + `commonjs2` lib; renderer targets `electron-renderer` and uses
`vue-loader`, `pug-plain-loader`, `less-loader`, `svg-sprite-loader` (for `src/renderer/assets/svgs`),
and `postcss-pxtorem` (rem-based responsive sizing via `css-loader.config.js`).

## Path aliases (webpack `resolve.alias`)

Defined in each webpack base config (and referenced by TS; the tsconfig `paths` are commented out, so the
**webpack aliases are authoritative** for bundling):

| Alias | Points to |
| --- | --- |
| `@root` | `src/` |
| `@main` | `src/main/` |
| `@renderer` | `src/renderer/` |
| `@lyric` | `src/renderer-lyric/` |
| `@common` | `src/common/` |
| `@static` | `src/static/` (renderer/lyric bundles only) |

Use these aliases in imports instead of relative paths.

## TypeScript

- `tsconfig.json` extends `@tsconfig/recommended`; `allowJs: true` (the `musicSdk` providers are plain JS),
  module resolution `bundler`. Global `LX` namespace types are declared in `src/common/types/*.d.ts`
  (ambient, no import needed).
- There is **no separate `npm run typecheck`** script — type errors surface via `ts-loader` during the
  webpack build (and ESLint).

## Lint configuration
Root `.eslintrc.cjs` extends `.eslintrc.base.cjs` (`standard` / `standard-with-typescript` / `plugin:vue/vue3-recommended`
+ `vue-pug`). Per-directory overrides exist for `main/`, `renderer/`, `renderer-lyric/`, `common/`, `lang/`.
Key rules: no `var`, camelcase off, 2-space indent, `comma-dangle: always-multiline`, no space before
function parens, `space-before-function-paren: never`.

## Testing
There is **no test runner / test suite** configured in `package.json` or the webpack configs. Verify
changes by building (`npm run build`) and running (`npm run dev`); lint is the only automated gate inside
this repo.

**Exception — local music file sync.** Its pure logic (`src/main/modules/sync/musicFile/diff.ts`) is
deliberately dependency-free so it can be exercised outside the bundle. Node `>= 22` strips TS types
natively, so the tests under `tests/` run without any runner (run from the repo root):

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/music-file-sync.test.ts   # pure diff/plan rules
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/music-file-fs.test.ts     # scan/chunked transfer/delete on real temp dirs
```

`tests/music-file-fs.test.ts` also asserts that `lx-music-mobile/.../musicFile/diff.ts` is byte-identical
to the desktop copy — keep them in sync when changing the rules. `tests/` is intentionally outside
`src/`, so it is neither bundled nor linted as app code; the design contract lives in
`doc/music-file-sync/本地音乐文件同步-设计.md`.
