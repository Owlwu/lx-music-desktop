# MODULES.md — Where everything lives

> Directory / module map with responsibilities and key files. Use with `ARCHITECTURE.md` (how it
> connects) and `DATA_FLOW.md` (how it moves). Paths relative to repo root.

## 1. Main-process modules — `src/main/modules/`

Registration order is fixed in `src/main/modules/index.ts` (guarded by `isRegistered`):
`userApi → commonRenderers → winMain → hotKey → tray → appMenu → winLyric`. Each default export is a
`register*()` function that wires IPC handlers and Electron lifecycle.

| Module | Path | Responsibility |
| --- | --- | --- |
| **winMain** | `winMain/` | The main `BrowserWindow` lifecycle + **all** primary business IPC. |
| **winLyric** | `winLyric/` | Desktop lyric window (frameless, always-on-top) + its IPC (`rendererEvent.ts`). |
| **userApi** | `userApi/` | Hidden `BrowserWindow` that loads & runs user-defined JS API plugins. |
| **commonRenderers** | `commonRenderers/` | Cross-renderer concerns: settings get/set, env params, theme, system fonts. |
| **hotKey** | `hotKey/` | Local + global (system-wide) hotkeys → forward as app events. |
| **tray** | `tray.ts` | System tray icon + menu (playback controls, show/quit). |
| **appMenu** | `appMenu.ts` | Application menu bar. |
| **sync** | `sync/` | Cross-device sync: `server/` (host) + `client/` (connect), list/dislike events, `musicFile/` (local music **file** sync), migrate. |
| **openApi** | `openApi/index.ts` | Local HTTP + SSE server exposing playback status & controls. |

### winMain internals (the biggest module)
- `main.ts` — create/show/destroy the main window, resize, bounds, fullscreen, transparency, cache.
- `autoUpdate.ts` — `electron-updater` wiring (check/download/progress events).
- `utils.ts` — helpers.
- `rendererEvent/index.ts` — **registers every `WIN_MAIN_RENDERER_EVENT_NAME` handler**. Splits into:
  - `app.ts` — window controls, dialogs, theme, player-status reporting, dev tools.
  - `music.ts` — music URL / lyric get-save / other-source cache.
  - `data.ts` — generic `save_data`/`get_data` (DATA_KEYS).
  - `download.ts` — download task list CRUD (backed by DB `download`).
  - `hotKey.ts` — hotkey config/status.
  - `soundEffect.ts` — EQ / convolution preset persistence.
  - `sync.ts`, `openAPI.ts`, `userApi.ts`, `process.ts` — module bridges.
  - `kw_decodeLyric.ts`, `tx_decodeLyric.ts` — provider-specific lyric decoding (encrypted LRC).

## 2. Main-process support — `src/main/`

| Path | Role |
| --- | --- |
| `index.ts` | Process entry: `initGlobalData` → env params → single-instance → modules → `app.whenReady`. |
| `app.ts` | `initGlobalData`, `initAppSetting` (DB init + migrate), `registerDeeplink`, `listenerAppEvent`, `setUserDataPath`, `quitApp`. |
| `worker/` | DB worker: `index.ts` (createWorkers), `dbService/` (see §5), `utils/worker.ts` (Comlink + `worker_threads`). |
| `event/` | Main event buses: `createAppEvent`, `createListEvent`, `createDislikeEvent`. |
| `utils/` | `request.ts` (undici wrapper + proxy), `setting.ts`, `theme.ts`, `hotKey.ts`, `migrate.ts`, `nodejs.ts`, etc. |
| `types/` | Main-side TS declarations. |

## 3. Shared — `src/common/`

Imported by both main and renderer. This is the contract layer.

| Path | Role |
| --- | --- |
| `ipcNames.ts` | **All IPC event names** grouped: `CMMON_EVENT_NAME`, `WIN_MAIN_RENDERER_EVENT_NAME`, `WIN_LYRIC_RENDERER_EVENT_NAME`, `USER_API_*`, `HOTKEY_*`, etc. |
| `mainIpc.ts` / `rendererIpc.ts` | Thin typed wrappers over `ipcMain` / `ipcRenderer` (`mainOn`, `mainHandle`, `sendEvent` / `rendererSend`, `rendererInvoke`, `rendererOn`, `rendererOff`). |
| `types/` | **The `LX.*` global namespace** as `.d.ts`: `app_setting`, `music`, `player`, `list`, `download_list`, `dislike_list`, `sync`, `user_api`, `open_api`, `theme`, `sound_effect`, `desktop_lyric`, `music_metadata`, `ipc_main`, `ipc_renderer`, `utils`, … |
| `constants.ts` | `STORE_NAMES`, `DATA_KEYS`, `LIST_IDS`, `APP_EVENT_NAMES`, `QUALITYS`, `DOWNLOAD_STATUS`, `URL_SCHEME_RXP`, `DEFAULT_SETTING`. |
| `config.ts` | `windowSizeList`, `navigationUrlWhiteList`. |
| `defaultSetting/` | Default `LX.AppSetting` (deep-merged with stored values). |
| `hotKey/` | Hotkey name/action constants (`HOTKEY_PLAYER`, `HOTKEY_COMMON`, `HOTKEY_DESKTOP_LYRIC`). |
| `theme/` | Theme definitions + `createThemes.js` (build script). |
| `error/` | Shared error definitions/codes. |
| `utils/` | `request.ts` (undici), `common.ts`, `vueTools.ts` (re-exports Vue APIs), `electron.ts`, `nodejs.ts`. |

## 4. Renderer (main window) — `src/renderer/`

| Path | Role |
| --- | --- |
| `main.ts` | Vue bootstrap: i18n, plugins, router, global props, mount. |
| `App.vue` | Root layout: sidebar, toolbar, routed view, play-bar, modals. |
| `router.ts` | Routes: `/search`, `/songList/list`, `/songList/detail`, `/leaderboard`, `/list`, `/download`, `/setting`. |
| `core/player/` | `action.ts` (play/next/prev/seek/toggle), `index.ts`, `timeoutStop.ts`, `utils.ts`. |
| `core/music/` | `index.ts` (dispatcher), `online.ts` (provider + DB cache), `local.ts`, `download.ts`, `utils.ts`. |
| `core/lyric.ts` | LRC parse/format/offset for the main window. |
| `core/apiSource.ts` | Switch built-in vs user API source. |
| `core/globalData.ts` / `dislikeList.ts` | Cross-cutting renderer state. |
| `core/useApp/` | **Composables** (`use*`): `usePlayer/*` (play events, status, progress, lyric, volume, sound effect, media session/device, preload next), `useSync`, `useOpenAPI`, `useUpdate`, `useInitUserApi`, `useDeeplink/*`, `useEventListener`, `useDataInit`, `listAutoUpdate`, … |
| `store/` | Reactive stores (see `ARCHITECTURE.md` §2). |
| `views/` | Route components: `Search`, `List` (MyList/MusicList), `songList` (List/Detail), `Leaderboard`, `Download`, `Setting` (many `Setting*` components + modals). |
| `components/` | Reusable UI (lists, modals, player bar, lyric view, etc.). |
| `plugins/player/` | Audio engine: `HTMLAudioElement` + Web Audio graph (analyser, BiquadFilter EQ chain, convolution, pitch-shifter). |
| `event/` | Renderer event bus (`Event.ts`, `appEvent.ts`, `keyEvent.ts`). |
| `utils/` | `ipc.ts` (renderer-side IPC facade — **the canonical list of IPC calls**), `musicSdk/` (provider scrapers), theme, download, etc. |

### `utils/musicSdk/` (provider scrapers)
- `index.js` — `sources.sources` (enabled list), `init()`, `searchMusic()`, `findMusic()` (cross-source
  matching/scoring), `supportQuality`.
- `api-source.js` — `getApi(...)` resolves the active implementation (built-in or user) per method;
  `api-source-info.ts` — source metadata.
- Per provider dirs: `kw/` (most complete: musicSearch, musicInfo, lyric, pic, songList, leaderboard,
  hotSearch, comment, album, tipSearch, util), `kg/` (+ `vendors/infSign.min.js`, `temp/`),
  `tx/` (+ `utils/crypto.js`), `wy/` (+ `utils/crypto.js`), `mg/` (+ `utils/mrc.js`), `xm.js` (single file),
  `bd/` (present, disabled).
- `options.js`, `utils.js` — shared scraper helpers.

## 5. DB worker — `src/main/worker/dbService/`

| Path | Role |
| --- | --- |
| `db.ts` | Open `better-sqlite3`, WAL, table creation/verification, migrations. |
| `tables.ts` | Table DDL. |
| `modules/index.ts` | Aggregates table modules into the `dbService` API surface. |
| `modules/{list,lyric,music_url,music_other_source,download,dislike_list}/` | Per-table CRUD (folders; `list` covers both `my_list` and `my_list_music_info`). |

`worker/utils/worker.ts` starts a `worker_threads.Worker` and wraps it with `comlink.wrap`, so callers
use `await global.lx.worker.dbService.<method>(...)` as if it were a local object.

## 6. Desktop-lyric renderer — `src/renderer-lyric/`

A minimal standalone Vue app: `main.ts`, `App.vue`, `core/` (`lyric.ts` animation, `mainWindowChannel.ts`
MessagePort bridge), `store/` (`action.ts`, `lyric`), `components/`, `plugins/i18n`, `utils/ipc.ts`.
Receives play/lyric status from main (via IPC + MessagePort) and renders the floating lyric.

## 7. Build & packaging — `build-config/`

| Path | Role |
| --- | --- |
| `pack.js` | Top-level build orchestrator (runs `npm run build`). |
| `build-pack.js` | electron-builder packer (target/arch/type from argv). |
| `main/webpack.config.{base,dev,prod}.js` | Main bundle (target Node). |
| `renderer/webpack.config.*.js` | Main-window renderer bundle. |
| `renderer-lyric/webpack.config.*.js` | Lyric-window bundle. |
| `renderer-scripts/webpack.config.*.js` | Bundles user-API default scripts. |
| `runner-dev.js` | Dev server (webpack-dev-server + hot-middleware) + launches Electron. |
| `vue-loader.config.js`, `css-loader.config.js`, `utils.js` | Shared loader/tooling config. |
| `build-{before,after}-pack.js`, `post-install.js`, `dependencies-patch.js`, `lib-update.js` | Packaging hooks & dep maintenance. |
| `lib/` | Vendored build helpers. |

## 8. Other top-level

- `src/lang/` — i18n string bundles.
- `src/static/` — static assets copied next to the packaged app (`global.staticPath`).
- `dist/` — webpack output; `dist/main.js` is the packaged entry.
