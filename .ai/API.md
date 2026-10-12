# API.md — Interfaces to call (and their contracts)

> The app has several distinct "APIs": IPC, the provider (musicSdk) surface, user-API plugins, the DB
> worker service, the local OpenAPI (HTTP/SSE), and the in-process event bus. This file documents the
> shape of each so an agent can call the right thing. Signatures below are from source; full types are
> in `src/common/types/*.d.ts` under the global `LX` namespace.

## 1. IPC (renderer ⇄ main)

### Wrappers
Main side (`src/common/mainIpc.ts`):
- `mainOn<T>(name, handler)` — receive a one-way message; `handler({ params: T })`.
- `mainHandle<T, R>(name, handler)` — receive and **return** a value; `handler({ params: T }): Promise<R>`.
- `sendEvent(name, params?)` — push from main to renderer.

Renderer side (`src/common/rendererIpc.ts`):
- `rendererInvoke<T, R>(name, params?)` — call and await main's return value.
- `rendererSend<T>(name, params?)` — one-way to main.
- `rendererOn(name, listener)` / `rendererOff(name, listener)` — subscribe to main pushes.

Event names are grouped in `src/common/ipcNames.ts`: `CMMON_EVENT_NAME`, `WIN_MAIN_RENDERER_EVENT_NAME`,
`WIN_LYRIC_RENDERER_EVENT_NAME`, `USER_API_*`, `HOTKEY_RENDERER_EVENT_NAME`, etc. **Never hard-code a
string** — import the constant.

### Canonical renderer-side calls — `src/renderer/utils/ipc.ts`
Sync / local music file sync: see §1.1.
Settings: `getSetting()`, `updateSetting(partial)`, `onSettingChanged(fn)`.
Data blobs: `saveData`/`getData` via `WIN_MAIN_RENDERER_EVENT_NAME.save_data/get_data` + `DATA_KEYS`
(e.g. `savePlayInfo`, `getSearchHistoryList`, `saveListPositionInfo`, `getLeaderboardSetting`).
Music cache: `getMusicUrl(musicInfo, type)`, `saveMusicUrl(...)`, `clearMusicUrl()`, `getMusicUrlCount()`.
Lyric: `getPlayerLyric`, `getLyricRaw`, `saveLyric`, `saveLyricEdited`, `removeLyricEdited`, `clearLyric*`.
Other source: `getOtherSource`, `saveOtherSource`, `clearOtherSource`.
Download: `downloadTasksGet/Create/Update/Remove`, `downloadListClear`.
User API: `importUserApi`, `setUserApi`, `removeUserApi`, `getUserApiList`, `sendUserApiRequest`,
`userApiRequestCancel`, `onUserApiStatus`.
Sync: `sendSyncAction`, `onSyncAction`, `getSyncServerDevices`, `removeSyncServerDevice`.
Local music file sync (same `sync_action` channel): `musicFileGetConfig`, `musicFileGetFolders`,
`musicFileCompare`, `musicFileApply`, `musicFileCancel`; progress is pushed as the
`musicFile_progress` variant of `SyncMainWindowActions`.
OpenAPI: `sendOpenAPIAction(action)`.
Window: `minWindow/maxWindow/minMaxWindowToggle/showHideWindowToggle/focusWindow/setFullScreen/quitApp/closeWindow`.
Hotkeys: `hotKeySetEnable/Config/GetStatus`, `onKeyDown`, `onUpdateHotkey`.
Themes: `getThemes/saveTheme/removeTheme`.
Audio presets: `getUserSoundEffectEQPresetList/save...`, convolution variants.
Player status (to main): `sendPlayerStatus(partial)`, `onPlayerAction(fn)`.
Update: `checkUpdate/downloadUpdate/quitUpdate`, `onUpdateAvailable/Error/Progress/Downloaded/NotAvailable`.

### 1.1 Sync features (`list` + `dislike` + `musicFile`)
Settings keys: `sync.mode` (`server`/`client`), `sync.enable`, `sync.server.port`, `sync.client.host`,
plus the local-music-file-sync keys `sync.musicFile.root` (absolute music folder on this device) and
`sync.musicFile.scope` (`string[]` of relative subfolders; empty = whole root).

### `musicFile` feature RPC (encrypted WebSocket + `message2call`)
Both roles expose the same methods to the peer; the handshake only negotiates the feature
(`featureVersion.musicFile = 1`), transfers are started manually by the user on either side.

| Method | Args | Returns |
| --- | --- | --- |
| `musicFile_get_root` | – | `string` (peer's music folder) |
| `musicFile_get_index` | `scope: string[]` | `LX.Sync.MusicFile.FileIndex` |
| `musicFile_read_file` | `path, offset, size` | `{ data: base64, eof }` |
| `musicFile_write_file` | `path, offset, data, isLast` | `void` |
| `musicFile_delete_file` | `path, withLyric` | `void` |
| `musicFile_sync_finished` | – | `void` (client-side handshake) |

All paths are **relative to each device's `sync.musicFile.root`**, `/`-separated, and validated by
`assertSafeRelPath` on both ends. Chunk size is `MUSIC_FILE_CHUNK_SIZE` (192 KiB). The diff/plan rules
and the on-disk protocol contract are documented in `doc/music-file-sync/本地音乐文件同步-设计.md`.

## 2. Provider (musicSdk) surface

Aggregated in `src/renderer/utils/musicSdk/index.js` (`default export`, also `musicSdk`). Providers are
keyed by source id: `kw kg tx wy mg xm bd`. **Enabled** list is `musicSdk.sources.sources` (`bd` is
present but commented out; `xm` excluded from cross-source search).

### Top-level methods
- `musicSdk.init()` — `Promise.all` of each provider's `init()` (token warm-up).
- `musicSdk.searchMusic({ name, singer, source, limit })` — query the other enabled sources in parallel.
- `musicSdk.findMusic({ name, singer, albumName, interval, source })` — cross-source match + scoring
  (returns ordered `LX.Music.MusicInfoOnline[]`); powers "toggle source".
- `musicSdk.supportQuality[source]` — qualities a source supports.

### Per-provider object (e.g. `src/renderer/utils/musicSdk/kw/index.js`)
Each provider exposes (methods may be omitted if unsupported):
- `getMusicUrl(songInfo, quality) → { promise }` — resolve a playable audio URL.
- `getPic(songInfo) → { promise }` — cover URL.
- `getLyric(songInfo, isGetLyricx?) → { promise }` — `LX.Music.LyricInfo`.
- `musicSearch.search(keyword, page, limit)` — search results.
- `songList.*`, `leaderboard.*`, `hotSearch.*`, `comment.*`, `album.*`, `singer.*`, `tipSearch.*`.
- `handleMusicInfo(songInfo)` — enrich (name/singer/img/album).
- `getMusicInfo(songInfo)`, `getMusicDetailPageUrl(songInfo)`.
- `init()` — optional warm-up (e.g. tokens).

Callers go through `core/music/utils.ts` (`handleGetOnlineMusicUrl/PicUrl/LyricInfo`) which call
`musicSdk[source].getMusicUrl(toOldMusicInfo(musicInfo), quality).promise`, etc. The `toOldMusicInfo` /
`toNewMusicInfo` helpers convert between the legacy flat object (what scrapers expect) and the typed
`LX.Music.MusicInfoOnline`.

### Source dispatch / user-API switching — `api-source.js`
- `apis(source)` returns the **active** implementation for a source: if the runtime `apiSource` (store)
  begins with `user_api`, it returns `userApi.apis[source]`; otherwise the built-in (via `allApi`/`getAPI`).
- `supportQuality` is keyed per `apiSourceInfo` entry (`api-source-info.ts`). Note: the built-in `allApi`
  table is currently empty — built-in providers are called directly via `musicSdk[source]` (see above);
  `apis()`/`allApi` is the extension hook for pluggable named API sets. `[待确认]` the exact intended
  role of the empty `allApi`/`api-source-info` tables (appears to be a legacy/unused extension point).

### Request helper (renderer)
Providers use `httpFetch` from `src/renderer/utils/request.ts`, returning `{ promise, cancelHttp() }`
(an `AbortController`-based fetch wrapper). Cancellation is used to supersede stale fetches.

## 3. User-API plugin contract

A user plugin is a JS file (`LX.UserApi.UserApiInfoFull`, `src/common/types/user_api.d.ts`) with:
- `id, name, description, script, allowShowUpdateAlert, author?, homepage?, version?`
- `sources?: Record<LX.Source, UserApiSourceInfo>` where `UserApiSourceInfo = { name, type: 'music',
  actions: ('musicUrl'|'lyric'|'pic')[], qualitys: LX.Quality[] }`.

The `script` defines functions the app invokes through `sendUserApiRequest({ requestKey, data })`
(IPC `request_user_api`) → executed in the hidden user-API window → returns a result. The returned
implementation is stored in `store.userApi.apis` and consumed via `apis(source)`. Manage via
`importUserApi(fileText)` / `setUserApi(source)` / `removeUserApi(ids)`; status via `onUserApiStatus`.
UI: `views/Setting/components/UserApiModal.vue`, `UserApiOnlineImportModal.vue`. Runtime switch:
`src/renderer/core/apiSource.ts` + `store.apiSource`.

## 4. Workers (there are TWO — do not confuse them)

### 4a. Main DB worker — `global.lx.worker.dbService`
Runs in a `worker_threads.Worker` (`src/main/worker/`), wraps `better-sqlite3`, and is exposed to **main**
process code as `global.lx.worker.dbService` (via `Comlink.expose`). This is the **only** place SQLite is
touched. Call like a local object (all methods `async`):
- `dbService.init(dataPath)` → `true` (existed) | `false` (created) | `null` (structure verify failed).
- Module objects are merged onto one facade (`dbService/index.ts`): `list` (covers `my_list` +
  `my_list_music_info`), `lyric` (raw + edited), `music_url`, `music_other_source`, `download`,
  `dislike_list` (see `dbService/modules/`).
- Tables (SQLite, WAL, file `lx.data.db` in `global.lxDataPath`): `my_list`, `my_list_music_info`,
  `lyric`, `music_url`, `music_other_source`, `download`, `dislike_list`.
- Bridge: `src/main/worker/utils/worker.ts` (`Comlink.expose` / `comlink.wrap` over a Node `Worker`).
- **The renderer never calls `dbService` directly** — it goes through IPC (`utils/ipc.ts` → main handlers
  in `modules/*/rendererEvent.ts` → `global.lx.worker.dbService`).
- Migration/repair: `src/main/worker/dbService/migrate.ts` + `src/main/utils/migrate.ts` + backup logic
  in `app.ts:302`.

### 4b. Renderer Web Workers — `window.lx.worker.{main, download}`
Separate Comlink-wrapped **Web Workers** created in `src/renderer/worker/utils/index.ts` and exposed on
`window.lx.worker` (declared in `src/renderer/types/app.d.ts`). Used to keep heavy work off the UI thread:
- `window.lx.worker.main` (`WorkerMainTypes`, `src/renderer/worker/main/`) — CPU/IO helpers:
  `createLocalMusicInfos`, `sortListMusicInfo`, `filterMusicList`, `filterDuplicateMusic`,
  `getMusicFilePic`, `getMusicFileLyric`, `langS2t`, `readLxConfigFile`, `saveLxConfigFile`,
  `exportPlayListToText`, `exportPlayListToCSV`, `searchListMusic`, `createSortedList`.
- `window.lx.worker.download` (`WorkerDownloadTypes`, `src/renderer/worker/download/`) — performs the
  actual file downloads in a Web Worker: `createDownloadTasks`, `startTask`, `pauseTask`, `removeTask`,
  `updateUrl`, `writeMeta`, `saveLrc`. (Task metadata is persisted separately via the main DB worker.)
- `proxyCallback(fn)` (`Comlink.proxy`) is used to pass event callbacks back into the renderer from a worker.

## 5. Local OpenAPI (HTTP + SSE) — `src/main/modules/openApi/index.ts`

Bound to `127.0.0.1` (or `0.0.0.0` when LAN is enabled). `Access-Control-Allow-Origin: *`.

| Endpoint | Method | Effect |
| --- | --- | --- |
| `/status?filter=k1,k2` | GET | JSON snapshot of `global.lx.player_status` (default keys: status,name,singer,albumName,lyricLineText,duration,progress,playbackRate) |
| `/lyric` | GET | current `lyric` text |
| `/lyric-all` | GET | `{ lyric, tlyric, rlyric, lxlyric }` |
| `/subscribe-player-status?filter=` | GET | **SSE stream** of `player_status` changes (`event: <key>\ndata: <json>`) |
| `/play` `/pause` | GET | transport control |
| `/skip-next` `/skip-prev` | GET | next/prev |
| `/seek?offset=<s>` | GET | seek (400 if out of range) |
| `/collect` `/uncollect` | GET | love/unlove |
| `/volume?volume=0..100` | GET | set volume |
| `/mute?mute=true|false` | GET | mute toggle |

Controls call `sendTaskbarButtonClick(action, data)` → renderer `player_action_on_button_click`.
Lifecycle: `startServer(port, bindLan)` / `stopServer()` / `getStatus()`; toggled from
`views/Setting/components/SettingOpenAPI.vue` via `sendOpenAPIAction`.

## 6. In-process event bus (renderer `AppEvent`)

Created by `createAppEventHub()` (`src/renderer/event/appEvent.ts`), consumed as `window.app_event`.
Typed helpers (each is an `emit` wrapper; subscribe with `.on('<name>', fn)` / `.off`):
- Playback: `play pause stop error(code)`.
- Raw player: `playerPlaying playerPause playerStop playerEnded playerError playerLoadeddata
  playerLoadstart playerCanplay playerEmptied playerWaiting playerDeviceChanged`.
- Transport state: `musicToggled setProgress(progress,maxPlayTime?) setVolume setPlaybackRate
  setVolumeIsMute activePlayProgressTransition`.
- Media: `picUpdated lyricUpdated lyricOffsetUpdate lyricLinePlay(text,line)`.
- Library: `myListUpdate(ids) downloadListUpdate()`.
- Misc: `configUpdate setting focus dragStart dragEnd keyDown(event)`.

The **main-process** bus (`src/main/event/`) is a separate `createAppEvent()` (events: `updated_config`,
`player_status`, `app_inited`, `main_window_close`, `deeplink`, `system_theme_change`, …) — do not mix the two.

## 7. Player store (renderer)

`src/renderer/store/player/`:
- `state.ts` — `isPlay`, `playMusicInfo`, `musicInfo` (current track meta), `playedList`, `tempPlayList`,
  `playInfo`, plus volume/playProgress/playbackRate sub-stores.
- `action.ts` — `setPlayMusicInfo`, `setMusicInfo`, `setAllStatus`, `getList`, `addPlayedList`,
  `clearPlayedList`, `clearTempPlayeList`, `removePlayedList`, `setPlayListId`, `addDislikeInfo` (via core).
- Actions used by the player: `src/renderer/core/player/action.ts` (`playList/playListById/play/playNext/
  playPrev/togglePlay/pause/stop/collectMusic/uncollectMusic/dislikeMusic/setMusicUrl`).
- Audio engine: `src/renderer/plugins/player/` (`setPlay/setPause/setStop/setResource/isEmpty` + Web Audio graph).
