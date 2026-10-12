# CONVENTIONS.md — House rules & patterns to follow

> Follow these so new code matches the codebase. ESLint runs **inside every build**, so style/lint
> errors break the build. The linter config is `.eslintrc.base.cjs` (+ per-dir overrides).

## Language & file style
- **ESM** (`import`/`export`), bundled by webpack. No `require` in app source.
- TypeScript **and** plain JS coexist (`tsconfig` has `allowJs: true`). The `musicSdk` providers are JS;
  core/store/main are mostly TS.
- **No `var`** (`no-var: error`). `const`/`let`.
- 2-space indent, single quotes, **no space before function parens** (`space-before-function-paren: never`
  → `function foo()` / `const foo = () => {}` with no space before `(` for arrow: `(x) =>`).
- `comma-dangle: always-multiline` (trailing comma on the last line of a multi-line structure).
- camelCase off; mixed casing is common (e.g. `musicSdk`, `musicInfo`, `listDetailInfo`). Match neighbors.
- Prefer **no comments**; when one is needed it's short and often Chinese (project language is zh-CN).

## Imports & path aliases (authoritative = webpack)
Use aliases, not deep relative paths:
- `@root` → `src/`, `@main` → `src/main/`, `@renderer` → `src/renderer/`, `@lyric` → `src/renderer-lyric/`,
  `@common` → `src/common/`, `@static` → `src/static/`.
- `@static` is only aliased in the renderer/lyric bundles (not in `main`/`common` bundles).

## Types & the `LX` namespace
- Shared shapes live in **ambient** declaration files under `src/common/types/*.d.ts` (e.g. `music.d.ts`,
  `player.d.ts`, `setting.d.ts`, `user_api.d.ts`, `download.d.ts`). They declare a **global `LX`
  namespace** — use `LX.Music.MusicInfoOnline`, `LX.Player.LyricInfo`, etc. **without imports**.
- `src/common/types/` also declares the global `Window` (`window.lx`, `window.app_event`,
  `window.key_event`, `window.i18n`) and `NodeJS.ProcessVersions.app`.
- If you add a new shared type, add it to a file in `src/common/types/` inside `declare namespace LX`.

## Vue (renderer)
- **Vue 3 Composition API**, `@vue/reactivity` `ref`/`reactive`/`computed`, script setup or `setup()`.
- `.vue` SFCs use `<template lang="pug">` **or** `<script lang="ts">`; styles are `less`.
- Responsive sizing uses **rem** — `postcss-pxtorem` converts `px` in CSS to `rem`, so write `px` values
  and the base font-size scaling handles responsiveness. Do not hand-write `rem`.
- SVG icons live in `src/renderer/assets/svgs` and are bundled as a sprite (`svg-sprite-loader`), used via
  `<use href="#icon-...">`.

## State (no Pinia/Vuex)
- State is plain Vue reactivity in `src/renderer/store/` (subdirs: `player/`, `list/`, `download/`,
  `search/`, `songList/`, `leaderboard/`, plus `store/index.ts` globals like `apiSource`, `proxy`, `sync`,
  `openAPI`, `qualityList`).
- Pattern: a `state.ts` (refs) + `action.ts` (functions that mutate refs) per domain, exported and imported
  where used. Mutations are plain function calls, not "mutations".
- Main-process shared state is `global.lx` (see `ARCHITECTURE.md`); it is **not** reactive.

## Event system
- **Renderer in-process bus**: `window.app_event` (typed `AppEventTypes`), created by
  `createAppEventHub()` (`src/renderer/event/appEvent.ts`). Emit with the typed helper
  (`window.app_event.play()`) and subscribe with `.on('<name>', fn)` / `.off(...)`. Key events on
  `window.key_event`.
- **Main in-process bus**: `global.lx.event_app` etc. (`src/main/event/`), a separate `createAppEvent()` —
  events like `updated_config`, `player_status`. **Do not mix** the renderer and main buses.
- Cross-process: use IPC (below), not the buses.

## IPC (renderer ⇄ main)
- **Never hard-code event-name strings.** Import constants from `src/common/ipcNames.ts`
  (`CMMON_EVENT_NAME`, `WIN_MAIN_RENDERER_EVENT_NAME`, `WIN_LYRIC_RENDERER_EVENT_NAME`, `USER_API_*`, …).
- Renderer calls main via the facade `src/renderer/utils/ipc.ts` (uses `rendererInvoke`/`rendererSend`/
  `rendererOn` from `@common/rendererIpc`). Add new renderer-side calls there.
- Main registers handlers with `mainHandle`/`mainOn` from `@common/mainIpc` and pushes with `sendEvent`.
- Main-side handlers are grouped per module in `modules/*/rendererEvent/*.ts` (winMain has a
  `rendererEvent/` folder with one file per concern: `app.ts`, `music.ts`, `data.ts`, `download.ts`, …).

## Main-process module structure
Each feature under `src/main/modules/<name>/` follows:
- `index.ts` — default-export `registerX()` (idempotent), sets up its `rendererEvent`.
- `rendererEvent.ts` (or `rendererEvent/` folder) — default-export that registers `mainHandle`/`mainOn`.
- Optional `main.ts`, `utils.ts`, etc.
Register order is fixed in `src/main/modules/index.ts`:
`userApi → commonRenderers → winMain → hotKey → tray → appMenu → winLyric`. A new module must be added
there.

## Music providers (musicSdk)
- Providers are **plain JS** in `src/renderer/utils/musicSdk/<source>/` (`kw kg tx wy mg xm bd`), each a
  default-export object exposing `getMusicUrl/getPic/getLyric/musicSearch/...` (see `API.md` §2).
- Aggregation is in `musicSdk/index.js`; cross-source matching/scoring is `findMusic`.
- Network fetches use `httpFetch` (`src/renderer/utils/request.ts`) returning `{ promise, cancelHttp() }`
  (AbortController-based). Callers read `.promise`.
- Convert between the legacy flat object and typed `LX.Music.MusicInfoOnline` with
  `toOldMusicInfo`/`toNewMusicInfo` (`src/renderer/utils/index.ts`).

## i18n
- Three locales: `src/lang/zh-cn.json`, `en-us.json`, `zh-tw.json` (keys flat, `prefix__name`).
- Renderer: `window.i18n.t('key', { val })` in TS; `$t('key')` in templates (global prop).
- When adding UI text, add the key to **all three** locale files (fallback is `zh-cn`).
- Dynamic keys are common (e.g. `theme_' + id`, `prefix + source`) — keep key naming predictable.

## Errors / messages
- Shared request-failure messages come from `src/renderer/utils/message.ts` (`requestMsg.tooManyRequests`,
  …). `core/music` retries/skips based on these.
- User-facing error text goes through i18n; throw `new Error(window.i18n.t('...'))` for toggle-failure cases.

## Naming
- Provider folders under `musicSdk/`: `kw kg tx wy mg xm bd`. The **typed** union
  `LX.OnlineSource` is `kw | kg | tx | wy | mg` (in `src/common/types/common.d.ts`); `xm` (Xiami) is in
  the runtime `sources.sources` list but excluded from cross-source search, and `bd` (Baidu) is present
  but disabled (commented out). `LX.Source = OnlineSource | 'local'`; local tracks use `source: 'local'`,
  and download copies carry a `progress` field.
- Qualities: `'128k' | '320k' | 'flac' | 'flac24bit' | 'wav'` (`LX.Quality`, `QUALITYS` in `constants.ts`).
- File names are lowerCamel; views/components are PascalCase `.vue`.
