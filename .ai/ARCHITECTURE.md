# ARCHITECTURE.md — Process & data architecture

> Companion to `PROJECT.md`. Focus: how the pieces fit together across Electron processes, how data
> flows, and where the boundaries are. File paths relative to repo root.

## 1. Multi-process model

LX Music runs **4 kinds of execution contexts** that must stay loosely coupled:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Node.js)  —  src/main/index.ts                                 │
│                                                                              │
│  • Electron lifecycle, BrowserWindows, tray, menu, hotkeys, deeplink          │
│  • Feature modules: winMain winLyric userApi sync openApi hotKey tray appMenu │
│  • global.lx / global.envParams  (shared mutable main-process state)          │
│  • HTTP via undici, FS, proxy                                                │
│                                                                              │
│  ┌─────────────────────────────┐   ┌────────────────────────────────────────┐ │
│  │ DB WORKER (worker_threads)  │   │ USER-API hidden BrowserWindow           │ │
│  │ src/main/worker/dbService   │   │ src/main/modules/userApi                │ │
│  │ better-sqlite3 (WAL)        │   │ Runs user JS plugins in isolation       │ │
│  │ exposed via comlink         │   │ (own renderer, no nodeIntegration)      │ │
│  └─────────────────────────────┘   └────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────┬───────────────────────────────┘
               │  ipcMain / ipcRenderer        │ MessagePort (contextBridge)
               ▼                               ▼
┌────────────────────────────────┐   ┌─────────────────────────────────────────┐
│ MAIN-WINDOW RENDERER (Vue 3)   │   │ DESKTOP-LYRIC RENDERER (Vue 3)          │
│ src/renderer                   │   │ src/renderer-lyric                      │
│ player, music, stores, views   │   │ frameless always-on-top lyric window    │
└────────────────────────────────┘   └─────────────────────────────────────────┘
```

### Boundaries
- **Renderer ↔ Main**: only via IPC. Names live in `src/common/ipcNames.ts`; wrappers in
  `src/common/mainIpc.ts` (main side: `mainOn`, `mainHandle`, `sendEvent`) and
  `src/common/rendererIpc.ts` (renderer side: `rendererSend`, `rendererInvoke`, `rendererOn`, `rendererOff`).
- **Main ↔ DB worker**: only via **Comlink** proxy (`global.lx.worker.dbService.*`). SQLite is never
  touched directly outside the worker. See `src/main/worker/utils/worker.ts`.
- **Main ↔ User-API window**: via a hidden `BrowserWindow`; scripts are loaded from user files and
  invoked over IPC. The window is sandboxed (no node integration). See `src/main/modules/userApi/`.
- **Main ↔ Desktop-lyric renderer**: two channels — (a) standard IPC, and (b) a **dedicated `MessagePort`**
  created in main and handed to both windows for low-latency lyric/play status sync. Renderer side:
  `src/renderer-lyric/core/mainWindowChannel.ts`.

## 2. Shared state

### Main process — `global.lx` (built in `src/main/app.ts:16`, `initGlobalData`)
```
global.lx = {
  inited, isSkipTrayQuit,
  event_app,        // app event bus (createAppEvent, src/main/event)
  event_list,       // list/library event bus
  event_dislike,    // dislike-list event bus
  appSetting,       // LX.AppSetting (from store/config_v2)
  worker,           // { dbService } Comlink proxy
  hotKey,           // { enable, config{local,global}, state }
  theme,            // { shouldUseDarkColors, theme{ id,name,isDark,colors } }
  player_status,    // LX.Player.Status snapshot (drives tray, OpenAPI, taskbar)
}
global.envParams = { cmdParams, deeplink, workAreaSize? }   // CLI flags + lxmusic:// links
global.lxDataPath  // <userData>/LxDatas  (DB + user files live here)
global.lxOldDataPath
global.staticPath  // static assets (dev: webpack, prod: dist/static)
```
- `global.lx.player_status` is the **single source of truth for playback state** on the main side.
  It is updated by renderer (`player_status` IPC) and consumed by `openApi`, tray, and the lyric channel.

### Renderer — reactive stores (NOT Pinia)
- `src/renderer/store/index.ts` — top-level reactive globals: `apiSource`, `proxy`, `sync`, `openAPI`,
  `userApi`, `versionInfo`, `themeId`, `themeInfo`, `qualityList`, `windowSizeActive`, `sourceNames`.
- Per-domain stores under `src/renderer/store/` (each is a module of `ref`/`reactive` + actions):
  `player/` (`state.ts action.ts lyric.ts volume.ts playProgress.ts playbackRate.ts`), `search`, `list`,
  `songList`, `download`, `dislikeList`, `hotSearch`, `leaderboard`, `setting`, `soundEffect`.
- Convention: a store exports both the reactive state and small action functions; components read state
  directly and call actions to mutate. There is no central `store.register`.

## 3. Event buses (intra-process pub/sub)

Two distinct mechanisms — do not confuse them:

| Mechanism | Lives in | Used for |
| --- | --- | --- |
| **IPC** (`ipcNames.ts`) | cross-process | renderer ↔ main, renderer ↔ lyric window |
| **Event bus** (`AppEvent`) | single process | decouple modules inside one process |

- **Renderer bus**: `src/renderer/event/` — `Event.ts` (generic `on/off/emit/offAll`) + `appEvent.ts`
  (`AppEvent` with typed helpers like `musicToggled()`, `playerError()`, `lyricUpdated()`). Created via
  `createAppEventHub()`; consumers use `window.lx.appEvent` (see `src/renderer/main.ts`).
- **Main bus**: `src/main/event/` — `createAppEvent()`, `createListEvent()`, `createDislikeEvent()`.
  Subscribed by `app.ts` (`updated_config`, `player_status`, `app_inited`, …) and the feature modules.
- **Lyric window bus**: `src/renderer-lyric/store/` + `core/mainWindowChannel.ts`.

## 4. Data persistence

### SQLite (primary) — `src/main/worker/dbService/`
- Engine `better-sqlite3`, journal mode **WAL**. File `lx.data.db` in `global.lxDataPath`.
- Init/verify: `dbService.init(dataPath)` returns `true` (existed), `false` (created), or `null`
  (structure-verify failed → main backs up and re-inits; `src/main/app.ts:302`).
- Modules under `dbService/modules/` (folders): `list` (covers both `my_list` and `my_list_music_info`),
  `lyric`, `music_url`, `music_other_source`, `download`, `dislike_list`. Merged into one facade in
  `dbService/index.ts`.
- Cache tables (music_url, lyric raw/edited, other-source) can be cleared from UI; they are derived data.

### JSON / files (secondary) — `src/main/utils/`
- Settings: `config_v2` (LX.AppSetting). Named keys in `STORE_NAMES` (`src/common/constants.ts:8`).
- `DATA_KEYS` (constants) for small persisted blobs via `save_data`/`get_data` IPC:
  `viewPrevState`, `playInfo`, `searchHistoryList`, `listScrollPosition`, `listPrevSelectId`,
  `listUpdateInfo`, `ignoreVersion`, `leaderboardSetting`, `songListSetting`, `searchSetting`, `lastStartInfo`.
- Themes, sound-effect presets (EQ/convolution), user-API files, hotkey config, sync state — each in
  its own file under `global.lxDataPath`.

## 5. Music-source resolution architecture

The heart of the app. Two layers:

1. **Built-in provider scrapers** — `src/renderer/utils/musicSdk/`. One module per provider
   (`kw` 酷我, `kg` 酷狗, `tx` QQ音乐, `wy` 网易云, `mg` 咪咕, `xm` 虾米, `bd` 百度[disabled]).
   Aggregated in `musicSdk/index.js` (`sources.sources` = the *enabled* list; `bd` present but commented out).
   Each provider exposes a uniform shape: `musicSearch`, `musicInfo`, `lyric`, `pic`, `songList`,
   `leaderboard`, `hotSearch`, `comment`, `album`, `singer`, `tipSearch` (see `API.md`).
   Some providers need crypto/sign helpers (`tx/utils/crypto.js`, `kg/vendors/infSign.min.js`, `wy/utils/crypto.js`).

2. **User API plugins** — user-supplied JS (in-app or imported file) that implements the same
   provider interface. Loaded/executed in the hidden user-API window (`src/main/modules/userApi/`).
   `src/renderer/core/apiSource.ts` switches between "built-in" and "user" at runtime
   (`store.apiSource`); `musicSdk/api-source.js` (`getApi`) routes each call to the active implementation.

`src/renderer/core/music/index.ts` decides **where** a URL/lyric/pic comes from for a track:
`online.ts` (provider + cache in DB), `local.ts` (imported files), `download.ts` (offline copies).

## 6. Window topology

| Window | Creator | Notes |
| --- | --- | --- |
| Main window | `src/main/modules/winMain/main.ts` | Frameless, resizable, `windowSizeList` presets (`src/common/config.ts`) |
| Desktop lyric | `src/main/modules/winLyric/` | Frameless, always-on-top, transparent, draggable; separate Vue app |
| User API | `src/main/modules/userApi/` | Hidden (`show: false`), isolated JS runtime for plugins |
| Modals | renderer-side | Theme, settings, dialogs are in-window Vue overlays, not separate windows |

## 7. Security posture (Electron)

- Renderer windows run **without node integration**; they reach Node only through typed IPC.
- `listenerAppEvent` (`src/main/app.ts:169`) locks down navigation / `window.open` / `<webview>`:
  external http(s) links go to `shell.openExternal`; `will-attach-webview` strips preloads and disables
  nodeIntegration. (See `RISKS.md`.)
- User API scripts run in a sandboxed hidden window precisely to contain untrusted user code.
