# RISKS.md — Things that can bite an agent (and the user)

> Practical warnings about fragile areas, external dependencies, and verification gaps. Not a bug list —
> a "what to watch for" list.

## Native / build-time dependencies
- **`better-sqlite3`, `bufferutil`, `utf-8-validate`, and the custom `qrc_decode.node`** are native modules.
  They must be compiled for the installed Electron ABI. `postinstall` runs `electron-builder
  install-app-deps` to do this; a missing C++ toolchain / prebuilt cache, or an Electron/Node version
  mismatch, breaks `npm install` and `npm run dev`.
- `qrc_decode.node` is loaded from `build/Release/` (dev) or a relative path (prod) — see
  `build-config/main/webpack.config.base.js` externals. If it's absent, related decode features fail.
- **Node `>= 22`** is a hard requirement (also required by `undici ^7`). On an older Node the install or
  dev server may misbehave.

## Forked GitHub dependencies (pinned to specific commits)
These come straight from GitHub, not npm, and are pinned to commit hashes in `package.json`:
`needle`, `electron-devtools-installer`, `eslint-formatter-friendly`, `spinnies`, `webpack-hot-middleware`.
- They require **network access to GitHub** at install time and can silently change behavior if the commit
  is updated/replaced. Pin-aware updates are needed for `npm i` to succeed.
- `electron-updater` is pinned to an exact version (`6.8.4`); keep it that way.

## External music-provider fragility (the #1 runtime risk)
- The built-in providers in `src/renderer/utils/musicSdk/` **scrape third-party web services**
  (Kuwu/Kugou/Tencent/Wangyiyun/Migu/Xiami, etc.). Endpoints, cookies/tokens, and response shapes change
  **without notice** upstream. A provider can stop resolving URLs or lyrics with no error in this repo.
- There is no automated contract test for these; failures surface as "no playable audio" / lyric-load
  errors at runtime. When touching a provider, expect its upstream to have drifted.
- `bd` is present but **disabled** in `musicSdk/index.js`; `xm` is excluded from cross-source search. Don't
  assume every folder under `musicSdk/` is live.
- The `api-source.js` `allApi`/`api-source-info.ts` tables are effectively **empty/legacy** — built-in
  providers are called directly via `musicSdk[source]`. `[待确认]` whether these are dead code.

## Verification gaps
- **No test runner and no test suite.** There is no `npm test`, and no `typecheck` script. The only
  automated gates are ESLint (runs in-build) and the webpack build itself.
- Therefore: verify changes by `npm run build` (must pass lint + bundle) and, for behavior, by
  `npm run dev` and exercising the feature manually. Expect to be the de-facto test harness.
- **Except** local music file sync: the desktop repo's `tests/music-file-sync.test.ts` and
  `tests/music-file-fs.test.ts` run under plain node (see `DEVELOPMENT.md`).

## Local music file sync — known tradeoffs
- Content equality between the two devices is decided by **size + a content signature** (mtimes always
  differ across copies, so they are never compared). The signature is `fnv1a32 + djb2_32` over
  `"mf1:<size>:" + first 4096 bytes + last 4096 bytes`, computed while scanning (see `diff.ts`:
  `buildSignature` / `getSignatureRanges`). It exists because a **byte-size-preserving** content change
  (e.g. decrypting an obfuscated audio file in place) is invisible to a size-only rule: both sides keep
  saying "already synced" and the peer never receives the good file.
- Tradeoffs of the signature: only the first/last 4 KB are sampled (a difference confined to the middle
  can still be missed); it is a 64-bit non-cryptographic hash; and if **either** side omits `sig`
  (older build, or sampling failed) that file falls back to the size-only rule — so both ends must be
  updated together to get the new behaviour.
- A sibling `.lrc` is not an independent sync item: it is carried along with its audio file, so adding or
  removing only the `.lrc` is not detected as a change (and `.lrc` content is not part of the signature).
- Conflicts default to direction `pull` (use the peer's copy), which is the wrong default when the local
  copy is the good one; both UIs therefore expose "全部用本地覆盖 / 全部用对端覆盖" bulk buttons for the
  conflict group.
- No resume support: cancelling mid-file leaves a partial file, which shows up as a conflict next time.
- The baseline (`<lxDataPath>/sync/musicFile/baseline.json`) lives only on the device that *started* the
  sync, so each side keeps its own baseline.
- When this device runs as **server** with several clients connected, the driver picks the first ready
  client that supports the feature (no per-device picker yet).
- `diff.ts` is duplicated verbatim in `lx-music-mobile`; a change on one side must be mirrored (the
  repo-root test enforces identity).

## IDE vs build mismatch
- The `tsconfig.json` `paths` (aliases) are **commented out**; the **webpack aliases are authoritative**.
  IDE type navigation for `@main/@renderer/@common/...` may show errors that the build does not. Trust the
  build, not the IDE squiggles, for alias resolution.

## Architecture coupling / gotchas
- **Two separate "worker" systems** that look alike: main's `global.lx.worker.dbService` (SQLite,
  `worker_threads`) vs renderer's `window.lx.worker.{main,download}` (Web Workers). Editing one does not
  affect the other; the renderer reaches the DB only via IPC → main → `dbService`.
- **Two separate event buses** (`window.app_event` renderer vs `global.lx.event_app` main). Crossing the
  process boundary always means IPC, never a shared bus.
- **No state library** — shared renderer state is loose `ref`/`reactive` objects; there's no central store
  to consult for "source of truth". Follow the existing `store/<domain>` pattern rather than inventing a new
  global.
- Renderer code has partial Node access; `window.lx` / `window.lxData` expose app data. Don't assume a
  fully sandboxed renderer.

## Security posture
- The **user-API plugin system runs arbitrary user-provided JS** in a hidden `BrowserWindow`
  (`src/main/modules/userApi/`). Untrusted scripts can make network calls; treat that window as a
  sandbox boundary and avoid widening its privileges.
- The main process applies a security lockdown in `listenerAppEvent()` (`src/main/app.ts`) after init.
  Be careful adding `nodeIntegration`/relaxed CSP or new external-content windows.
- The OpenAPI server binds to `127.0.0.1` by default; it can be switched to LAN (`0.0.0.0`). Any new
  endpoint must not leak paths/secret data, since LAN mode exposes it on the network.

## Platform priorities
- **Windows is the primary target** (most pack/publish scripts, setup/portable/7z, win7 legacy builds).
  macOS and Linux are supported but secondary. Prefer Windows-first behavior; use platform guards
  (`process.platform`) for OS-specific code.

## i18n / copy
- Three locales (`zh-cn`, `en-us`, `zh-tw`) are kept in sync manually; adding a key to only one file leaves
  the others falling back to `zh-cn`. Missing/typo'd keys render the **key string itself** to the user.
