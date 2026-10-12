# PROJECT.md — LX Music Desktop

> Knowledge base entry. Purpose: give a coding agent the 30,000-foot view before it reads code.
> All paths are relative to the repo root. See `AGENT_GUIDE.md` for task-by-task pointers.

## What it is

`lx-music-desktop` is **LX Music**, a free, cross-platform desktop music search & playback app
(Apache-2.0, author `lyswhut`). It aggregates several Chinese music providers, resolves playable
URLs / lyrics / cover art, and provides local library, playlists, download, offline cache, desktop
lyric, cross-device sync, and a local OpenAPI. Version tracked in `package.json` (current `2.12.2`).

## Tech stack (verified from `package.json`)

| Concern | Tech | Notes |
| --- | --- | --- |
| Runtime | **Electron `40.9.2`** | Multi-window desktop app |
| UI | **Vue `~3.3.13`** (Composition API) + **Vue Router `~4.5.1`** | Two Vue apps: main renderer + desktop-lyric renderer |
| Language | **TypeScript `5.9.3`** (`allowJs: true`) + legacy JS (`musicSdk`, deeplink) | Extends `@tsconfig/recommended` |
| DB | **`better-sqlite3` `^12.9.0`** | Runs in a Node worker thread, exposed via **`comlink`** |
| HTTP | **`undici` `^7.25.0`** (main/worker) | Renderer talks to providers via IPC / user-API window |
| Audio | HTMLAudioElement + Web Audio API (BiquadFilter EQ, analyser, pitch) | `src/renderer/plugins/player/` |
| Build | **Webpack `^5`** | Separate bundles: main / renderer / renderer-lyric / renderer-scripts |
| Packaging | **`electron-builder` `^26.9.0`** | Win (primary) / Linux / macOS |
| State | Vue reactivity (`ref`/`reactive`/`computed`) — **no Pinia/Vuex** | `src/renderer/store/` |
| i18n | Custom plugin | `src/renderer/plugins/i18n`, strings in `src/lang/` |
| Node engine | **`node >= 22`**, `npm >= 8.5.2` | `postinstall` runs `electron-builder install-app-deps` |

## Entry points

| Process | Entry | Role |
| --- | --- | --- |
| Main | `src/main/index.ts` | Boots Electron, registers modules, single-instance, deeplink, workers |
| Main global init | `src/main/app.ts` | `global.lx` state, `global.envParams`, data paths, theme, proxy |
| Renderer (main window) | `src/renderer/main.ts` | Vue app bootstrap, mount `App.vue` |
| Renderer (desktop lyric) | `src/renderer-lyric/main.ts` | Small frameless lyric-window Vue app |
| Worker (DB) | `src/main/worker/index.ts` | Creates the DB service worker (Comlink over `worker_threads`) |
| Packaged main | `./dist/main.js` | `package.json` `main` field (webpack output) |

## Top-level layout

```
.
├─ src/
│  ├─ main/            # Electron main process (Node.js)
│  │  ├─ index.ts app.ts
│  │  ├─ modules/      # Feature modules (winMain, winLyric, userApi, sync, openApi, hotKey, tray, appMenu, commonRenderers)
│  │  ├─ worker/       # DB worker (better-sqlite3 via Comlink)
│  │  ├─ event/        # main-process event buses (app/list/dislike)
│  │  ├─ types/ utils/
│  ├─ renderer/        # Main-window Vue 3 app
│  │  ├─ main.ts App.vue router.ts
│  │  ├─ core/         # player, music, useApp (composables), apiSource, lyric
│  │  ├─ store/        # reactive state (player, search, list, download, setting, …)
│  │  ├─ views/        # routes: Search, List, songList, Leaderboard, Download, Setting
│  │  ├─ components/ plugins/ event/ utils/
│  │  ├─ utils/musicSdk/  # per-provider scrapers (kw, kg, tx, wy, mg, xm, bd)
│  ├─ renderer-lyric/  # Desktop-lyric frameless window (own Vue app)
│  ├─ common/          # Shared by main + renderer (types, ipcNames, config, utils, constants)
│  ├─ lang/            # i18n resources
│  └─ static/          # Static assets bundled next to the app
├─ build-config/       # webpack configs + electron-builder pack scripts (Node)
├─ dist/               # webpack output (packaged main entry is dist/main.js)
├─ package.json tsconfig.json
```

## Key features (feature → where)

- **Search / multi-source** — `src/renderer/views/Search/`, `src/renderer/core/music/`, `src/renderer/utils/musicSdk/`
- **Playback** — `src/renderer/core/player/`, `src/renderer/plugins/player/`, `src/renderer/store/player/`
- **Local library & playlists** — `src/renderer/views/List/`, `src/renderer/store/list`, DB `my_list` tables
- **Download & offline cache** — `src/renderer/views/Download/`, `src/renderer/store/download`, DB `download`
- **Music URL / lyric / cover resolution** — `src/renderer/core/music/{online,local,download}.ts`
- **User-defined API plugins** — `src/main/modules/userApi/` (hidden `BrowserWindow` runs user JS)
- **Desktop lyric window** — `src/main/modules/winLyric/` + `src/renderer-lyric/`
- **Cross-device sync** — `src/main/modules/sync/` (server + client); `sync/musicFile/` syncs a chosen
  subset of the local music library (audio + sibling `.lrc`) with the paired Android device
- **Local OpenAPI (HTTP + SSE)** — `src/main/modules/openApi/`
- **Themes** — `src/common/theme/`, `src/renderer/views/Setting/components/ThemeEditModal/`
- **Hotkeys (local + global)** — `src/main/modules/hotKey/`, `src/common/hotKey`
- **Auto-update** — `electron-updater` (`src/renderer/core/useApp/useUpdate.ts`)

## Platforms & packaging

- **Windows** is first-class (setup / portable / 7z "green", `win7` variants, arches `x64 x86 x86_64 arm64`).
- **Linux**: `appImage deb rpm pacman`. **macOS**: `dmg` (`x64`, `arm64`).
- Portable mode: on Windows, if a `portable` folder exists next to the exe, user data is stored inside it
  (`setUserDataPath`, `src/main/app.ts:127`).
- User data dir: `<userData>/LxDatas` (`global.lxDataPath`); SQLite file `lx.data.db` (WAL: `-wal`/`-shm`).
- Deeplink scheme: `lxmusic://` (`URL_SCHEME_RXP`, `src/common/constants.ts:1`).

## Related projects

- Web version (shared provider scrapers' origin): `lyswhut/lx-music` (referenced by `musicSdk` naming `lwlm`/`lxm`).
- Repo: `https://github.com/lyswhut/lx-music-desktop`

## Ground rules for agents

- **Do not modify business code** when producing this knowledge base; only `.ai/*.md` is in scope.
- Prefer small, verifiable changes. Run `npm run lint` (see `DEVELOPMENT.md`) after edits.
- Mark anything not verified in source with `[待确认]` instead of guessing.
- Never commit secrets; this app stores only user settings/DB — no embedded credentials are expected, but user-proxy and OpenAPI bind address are runtime values.
