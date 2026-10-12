# AGENT_GUIDE.md — How to work effectively in this codebase

> A practical field guide. Start here, then jump to the linked files for depth.

## Read order for orientation
1. `PROJECT.md` — what the app is, tech stack, entry points.
2. `ARCHITECTURE.md` — processes, boundaries (IPC/Comlink/MessagePort), shared state, window topology.
3. `MODULES.md` — where each feature lives.
4. `DATA_FLOW.md` — how a request/playback/persist flows end to end.
5. `API.md` — the concrete interfaces to call.
6. `CONVENTIONS.md` + `RISKS.md` before you start editing.
7. `DEVELOPMENT.md` to build/run/verify.

## Where things live (cheat sheet)
| Concern | Location |
| --- | --- |
| App bootstrap (main) | `src/main/index.ts` → `app.ts` (`initGlobalData`, `initAppSetting`) |
| Main feature modules + registration | `src/main/modules/index.ts` (order: userApi→commonRenderers→winMain→hotKey→tray→appMenu→winLyric) |
| Main IPC handlers | `src/main/modules/*/rendererEvent*.ts` (winMain has `rendererEvent/` folder) |
| Shared IPC names & wrappers | `src/common/ipcNames.ts`, `src/common/mainIpc.ts`, `src/common/rendererIpc.ts` |
| Shared types (global `LX` namespace) | `src/common/types/*.d.ts` |
| Shared constants / defaults | `src/common/constants.ts`, `src/common/defaultSetting.ts`, `src/common/config.ts` |
| Renderer bootstrap | `src/renderer/main.ts`, `core/globalData.ts` (builds `window.lx`) |
| Routes | `src/renderer/router.ts` (hash history, `require` lazy-loads views) |
| Views | `src/renderer/views/<Feature>/` (Search, List, songList, Leaderboard, Download, Setting, …) |
| State (no Pinia/Vuex) | `src/renderer/store/` (`player/`, `list/`, `download/`, `search/`, `songList/`, `leaderboard/`, `index.ts`, `setting.ts`) |
| Playback engine | `src/renderer/core/player/action.ts` + `src/renderer/plugins/player/` |
| Music URL/lyric/pic dispatch | `src/renderer/core/music/index.ts` → `online.ts`/`local.ts`/`download.ts` (+ `utils.ts`) |
| Providers (scrapers) | `src/renderer/utils/musicSdk/<source>/` (kw,kg,tx,wy,mg,xm,bd) |
| Renderer IPC facade | `src/renderer/utils/ipc.ts` |
| In-process event bus | `src/renderer/event/appEvent.ts` → `window.app_event` |
| Renderer Web Workers | `src/renderer/worker/{main,download}` → `window.lx.worker` |
| Main DB worker (SQLite) | `src/main/worker/` → `global.lx.worker.dbService` |
| Desktop-lyric window | `src/renderer-lyric/` (MessagePort: `core/mainWindowChannel.ts`) |
| i18n | `src/lang/*.json` + `src/lang/i18n.ts` → `window.i18n` |
| Build config (webpack) | `build-config/{main,renderer,renderer-lyric,renderer-scripts}/` + `runner-dev.js`, `pack.js`, `build-pack.js` |

## Common tasks

### Add a new music provider (source)
1. Create `src/renderer/utils/musicSdk/<id>/index.js` default-exporting an object with
   `getMusicUrl/getPic/getLyric/musicSearch/...` (copy `kw/` as a template; use `httpFetch`).
2. Import & register it in `src/renderer/utils/musicSdk/index.js` (add to `sources`, enable in the list).
3. Add the `<id>` to the `LX.Source` / `LX.OnlineSource` union in `src/common/types/` if not present.
4. Add source display-name i18n keys (`source` prefix, see `store/index.ts` `sourceNames`).
5. If it should appear in cross-source "toggle", make sure it's in `sources.sources` (not commented out).
- Verify with `npm run dev`; confirm search + play + lyric for that source.

### Add an IPC handler (renderer calls main)
1. Add an event name to `src/common/ipcNames.ts` (appropriate group).
2. Renderer: add a wrapper in `src/renderer/utils/ipc.ts` using `rendererInvoke`/`rendererSend`.
3. Main: register `mainHandle`/`mainOn` in the relevant `modules/<name>/rendererEvent.ts`, returning a value
   for `mainHandle`.
- Verify the round-trip in `npm run dev`.

### Add a new setting
1. Add the default value in `src/common/defaultSetting.ts` (and the `LX.AppSetting` type in
   `src/common/types/`).
2. Read via `appSetting['<group>.<key>']` (`src/renderer/store/setting.ts`); write via
   `updateSetting({ '<group>.<key>': value })` (goes through IPC to persist).
3. Add UI in `src/renderer/views/Setting/components/`.
4. If main needs the value at runtime, it reads it from its own `global.lx.appSetting` (synced via the
   `updated_config` event on change).

### Add a new view / route
1. Create `src/renderer/views/<Feature>/index.vue`.
2. Add a route in `src/renderer/router.ts` (hash history; component via `require('...').default`).
3. Add the nav entry to the layout/sidebar component.
4. Add any i18n keys (all three locales).

### Add a new main-process module
1. Create `src/main/modules/<name>/index.ts` (default `registerX()`) + `rendererEvent.ts`
   (default export registering IPC handlers).
2. Register it in `src/main/modules/index.ts` (mind the fixed order; idempotent).

### Add user-facing text
Add the key to `src/lang/zh-cn.json`, `en-us.json`, `zh-tw.json`; use `window.i18n.t('key')` (TS) or
`$t('key')` (templates). A missing key renders the key string itself.

## Verification (no test suite)
- **Always** run `npm run build` — it runs ESLint + webpack for all bundles; a lint or type error fails it.
- Run `npm run dev` to exercise the change in the real app (renderer HMR on ports 9080/9081, main restarts).
- For provider changes, test against live sources (they're flaky; see `RISKS.md`).
- For DB changes, watch for migration needs (`src/main/worker/dbService/migrate.ts`) — schema changes need a
  migration/verify path, otherwise `init` returns `null` and the DB is backed up + re-created (data loss).

## Gotchas (short list — see RISKS.md for detail)
- **Aliases are defined in webpack, not tsconfig** (`paths` commented out) → trust the build over IDE.
- **Two worker systems** (`global.lx.worker.dbService` vs `window.lx.worker.{main,download}`) and **two event
  buses** (renderer vs main) — crossing processes always means IPC.
- **No state library**; follow the `store/<domain>` ref/action pattern.
- Providers **scrape third-party sites** and drift; there's no test guarding them.
- **Windows-first** platform; keep OS-specific code behind `process.platform` guards.
- `tsconfig` `allowJs` is on — providers are JS; don't expect full typing there.

## Style reminders (see CONVENTIONS.md)
No `var`; 2-space indent; single quotes; no space before function parens; trailing commas on multiline;
use `@-` aliases; put shared types in `src/common/types` (global `LX`); import IPC name constants (never
hard-code); keep i18n in sync across the three locale files.
