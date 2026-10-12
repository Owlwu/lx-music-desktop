# DATA_FLOW.md — How data moves through the app

> Step-by-step flows. Read after `ARCHITECTURE.md`. Names reference real functions/files; see `API.md`
> for signatures. Paths relative to repo root.

## 1. Playback (the core flow)

Triggered by UI (double-click a row), a hotkey, tray/OpenAPI button, or auto-advance.

```
UI / hotkey / openAPI / next()
        │
        ▼
core/player/action.ts   playList() / playListById() / playNext() / playPrev() / play() / togglePlay()
        │  setPlayMusicInfo(listId, musicInfo, isTempPlay?)   (store/player/action)
        ▼
handlePlay()                                                   (action.ts:188)
  ├─ resetRandomNextMusicInfo()
  ├─ setStop(); window.app_event.pause()
  ├─ setMusicUrl(musicInfo)      ──────────────┐
  ├─ getPicPath({musicInfo})  → setMusicInfo({pic}) → window.app_event.picUpdated()
  └─ getLyricInfo({musicInfo})→ setMusicInfo({lrc,tlrc,lxlrc,rlrc,rawlrc}) → window.app_event.lyricUpdated()
        │
        ▼
setMusicUrl()  →  getMusicPlayUrl(musicInfo)                    (action.ts:88)
        │  try toggleMusicInfo first (user-pinned source), else the music's own source
        ▼
core/music/index.ts  getMusicUrl({musicInfo, quality, isRefresh, onToggleSource, allowToggleSource})
        │  dispatch by track kind:
        │    'progress' in musicInfo  → download.ts   (offline copy)
        │    musicInfo.source=='local'→ local.ts      (imported file)
        │    else                     → online.ts     (provider + DB cache)
        ▼
online.ts  getMusicUrl()
        │  1. check DB cache (store via ipc getMusicUrl)  2. miss → musicSdk provider (getApi)
        │  3. store result back to DB (saveMusicUrl)      4. on failure → toggle source / retry
        ▼
returns a playable URL
        │
        ▼
setResource(url)   (plugins/player)   →  HTMLAudioElement.src = url  →  audio.play()
        │
        ▼
plugins/player audio events  →  core/useApp/usePlayer/* composables  →  update store/player
        │
        ▼
window.app_event.player* events  →  UI (play-bar, lyric, statusbar)
        │
        ▼
sendPlayerStatus(partial)  →  IPC `player_status`  →  main updates global.lx.player_status
        │                                                            │
        └────────────► openApi SSE / tray / desktop-lyric channel ◄──┘
```

Key behaviors in `getMusicPlayUrl` (`action.ts:88`):
- **Pinned source first**: uses `meta.toggleMusicInfo` if present (`allowToggleSource:false`), so a
  user-forced source is honored before falling back to auto.
- **Auto skip / retry**: on error it may `delayRetry` (2–6 s random, on `tooManyRequests`) or re-call with
  `isRetryed`; `player.autoSkipOnError` schedules `playNext` after 5 s.
- **Staleness guard**: `diffCurrentMusicInfo()` bails if the user switched tracks mid-fetch
  (`gettingUrlId` token).

Next/prev logic lives in `getNextPlayMusicInfo` / `playNext` / `playPrev` (`action.ts:285/377/491`),
honoring `appSetting['player.togglePlayMethod']` (`listLoop | random | list | singleLoop | none`), the
temp ("play later") queue, and the `playedList` (recently played) ring, with `filterList` (action.ts
util) skipping played/invalid entries.

## 2. Music / lyric / cover URL resolution (online)

`core/music/online.ts` is the provider + cache layer for online tracks:

1. **Cache read** — IPC `getMusicUrl` / lyric getters hit the DB (`music_url`, lyric tables) via the
   renderer IPC facade (`src/renderer/utils/ipc.ts` → `WIN_MAIN_RENDERER_EVENT_NAME.get_music_url` →
   main → `dbService`). Key is `${musicInfo.id}_${quality}`.
2. **Provider fetch** — on miss, call the active provider via `musicSdk` (`getApi(...)` from
   `api-source.js`), which is either the built-in scraper or a user-API implementation (see §5).
3. **Cache write** — store the resolved URL/lyric back (IPC `save_music_url`, lyric save).
4. **Fallback / toggle** — `onToggleSource` + `allowToggleSource` let the caller swap to another provider
   for the same track when one fails (drives the "toggle source" UI and the `music_other_source` table).

The `LX.Music.MusicInfoOnline` record carries `source`, `sourceId`, and per-quality URLs; `musicSdk/index.js`
`findMusic()` scores cross-source matches (name/singer/album/duration) to build the toggle list.

## 3. IPC round-trip (generic)

All renderer→main calls go through the two wrapper modules; names come from `ipcNames.ts`.

```
renderer:  rendererInvoke(name, params)   (await → returns main's return value)
           rendererSend(name, params)     (fire-and-forget)
           rendererOn(name, listener) / rendererOff(...)
main:      mainHandle(name, handler)      (await; handler returns a value)
           mainOn(name, handler)          (one-way)
           sendEvent(name, params)        (main → renderer push)
```
- The **canonical renderer-side list of calls** is `src/renderer/utils/ipc.ts` (getSetting, updateSetting,
  getMusicUrl, saveLyric, downloadTasks*, sync*, openAPI*, userApi*, hotKey*, lyric*, themes*).
- The **main-side handlers** are registered in `src/main/modules/winMain/rendererEvent/*` (and per-module
  `rendererEvent.ts` for lyric, `commonRenderers` for shared).
- `save_data`/`get_data` (data.ts) persist small blobs keyed by `DATA_KEYS`.

## 4. Persistence flows

- **Settings** — `getSetting()` (main reads `config_v2` JSON) → renderer `initSetting()` (store/setting)
  merges into `appSetting`. `updateSetting(partial)` writes back; main emits `on_config_change`, and its
  own bus fires `updated_config` (used by `app.ts` to re-apply proxy/volume/theme).
- **Library / playlists** — renderer `store/list` actions → main IPC → `dbService` `list` module (tables
  `my_list`, `my_list_music_info`). Mutations broadcast `event_list` in main
  and `myListUpdate` in the renderer bus so all views refresh.
- **Download** — `store/download` → main `download.ts` handlers → `dbService` `download` module; the
  actual file fetch runs in main (undici) writing to `appSetting['download.savePath']`, with status
  transitions `waiting → run → completed/error` (`DOWNLOAD_STATUS`).
- **Dislike list** — `core/dislikeList.ts` + `dbService` `dislike_list`; used to filter playback/search.
- **DB init & migrate** — `initAppSetting()` (`app.ts:302`): `dbService.init()` → on structure-verify fail
  (`null`) back up `lx.data.db*` and re-init; then `initSetting()`; then `migrateDBData()` (one-time).

## 5. User-API plugin flow

User JS plugins implement the same provider interface as `musicSdk` scrapers.

```
Settings UI (UserApiModal)  →  importUserApi(fileText) / setUserApi / removeUserApi   (ipc.ts)
        │
        ▼
main userApi module: write/load script files under global.lxDataPath, (re)load into hidden BrowserWindow
        │
        ▼  status via IPC `user_api_status`; renderer store.userApi updated
        │
Play/search time:  apiSource.ts switches to 'user'  →  musicSdk getApi(...) routes the call
        │
        ▼
renderer sendUserApiRequest({requestKey, data})  →  IPC `request_user_api`
        ▼
main userApi window evaluates the plugin function, returns result (or error) → renderer Promise
        (cancel via `request_user_api_cancel`)
```
- `store.apiSource` (renderer) is the runtime switch; `src/renderer/core/apiSource.ts` exposes helpers.
- Bundled default user-API scripts are compiled by the `renderer-scripts` webpack target.

## 6. Desktop-lyric window flow

```
main window plays  →  sends lyric/status to lyric window via:
  (a) IPC (create/show window, basic control) and
  (b) a dedicated MessagePort (mainWindowChannel) for low-latency sync
        │
        ▼
renderer-lyric/core/mainWindowChannel.ts  handleDesktopLyricMessage(action):
  set_info / set_lyric / set_status / set_offset / set_playbackRate / set_pause / set_play / set_stop
        │
        ▼
renderer-lyric/store + core/lyric.ts  →  animated floating lyric (Web Audio analyser optional)
```
Main side: `src/main/modules/winLyric/rendererEvent.ts` + `main.ts` create/manage the window; the
`get_info`/`get_status`/`get_analyser_data_array` requests flow back over the same port.

## 7. OpenAPI (local HTTP + SSE)

`src/main/modules/openApi/index.ts` exposes an HTTP server (bound to `127.0.0.1` or `0.0.0.0` for LAN):
- `/status` — JSON snapshot of `global.lx.player_status` (filterable).
- `/lyric`, `/lyric-all` — current lyric / all lyric channels.
- `/play /pause /skip-next /skip-prev /seek?offset= /collect /uncollect /volume?volume= /mute?mute=` —
  call `sendTaskbarButtonClick(action, data)` → renderer `player_action_on_button_click` → player actions.
- `/subscribe-player-status` — **Server-Sent Events**; main pushes `event: <key>\ndata: <json>` for each
  changed `player_status` key it subscribes to (driven by the main `player_status` bus event).

## 8. Cross-device sync

`src/main/modules/sync/`: two roles chosen by `appSetting['sync.mode']`.
- **Server** (`server/`) — hosts a sync endpoint, `startServer/stopServer`, `generateCode`, device list.
- **Client** (`client/`) — `connectServer/disconnectServer` to a remote host.
- Actions routed via `sendSyncAction`/`onSyncAction` IPC (`sync_action`), with list & dislike sub-events
  (`listEvent.ts`, `dislikeEvent.ts`) and `migrate.ts`. UI: `views/Setting/components/SettingSync/`.
- **Features** are negotiated on connect (`FeaturesList` in `common/constants_sync.ts`): `list`,
  `dislike`, `musicFile`. Feature handshakes run server→client; data transfer for `list`/`dislike`
  happens automatically, `musicFile` only negotiates and then waits for a manual trigger.

### 8.1 Local music file sync (`musicFile`)
Goal: sync a *subset* of the local music library (folders) between PC and Android, including the
sibling `.lrc` files, and let the user decide which additions/deletions to apply.

```
Settings UI (SettingSync/MusicFileSync.vue)
  → ipc: musicFileGetFolders / musicFileCompare / musicFileApply / musicFileCancel   (sync_action)
  → main: modules/sync/musicFile/service.ts  (driver)
       ├─ localFs.ts   scan folders, chunked read/write, delete (+ .lrc)
       ├─ diff.ts      pure plan/actions logic (mirrored 1:1 in lx-music-mobile)
       ├─ baseline.ts  <lxDataPath>/sync/musicFile/baseline.json (paths agreed last sync)
       └─ peer.ts      socket to talk to (server role: first ready client; client role: own socket)
  → peer calls: musicFile_get_index / read_file / write_file / delete_file
  → progress pushed back as `musicFile_progress`
```

Key points:
- Every path crossing the wire is **relative to each device's `sync.musicFile.root`** and validated by
  `assertSafeRelPath`, so the differing absolute paths on PC/Android are irrelevant.
- Change classification (add/delete/conflict) needs the per-device **baseline**; deletes are unchecked by
  default in the UI. Full rules: `doc/music-file-sync/本地音乐文件同步-设计.md`.
- `diff.ts` is dependency-free so it can be unit-tested directly with node.

## 9. App startup (main)

`src/main/index.ts` → `initGlobalData()` (builds `global.lx`, `global.envParams`, `global.staticPath`) →
`applyElectronEnvParams()` (CLI flags: `dha` disable HW accel, `proxy-server`, …) → single-instance lock →
`setUserDataPath()` (portable detection) → `registerDeeplink()` (`lxmusic://`) → `listenerAppEvent()` →
register modules (`modules/index.ts`) → `app.whenReady` → `initAppSetting()` (DB init + settings + theme) →
create main window. Renderer then signals `inited`; main sets `global.lx.inited` and can finalize startup.
