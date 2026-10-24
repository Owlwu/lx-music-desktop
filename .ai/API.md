# API.md — 可以调用的接口与契约

> 本应用有几类「API」：IPC、DB worker 服务、渲染进程 Web Worker、进程内事件总线、同步对端 RPC。
> 本文件给出各自的形状，签名以源码为准；完整类型在 `src/common/types/*.d.ts` 的全局 `LX` 命名空间。

## 1. IPC（渲染 ⇄ 主）

### 封装
主侧 `src/common/mainIpc.ts`：
- `mainOn<T>(name, handler)` — 单向接收，`handler({ params: T })`
- `mainHandle<T, R>(name, handler)` — 接收并返回值，`handler({ params: T }): Promise<R>`
- `sendEvent(name, params?)` — 主 → 渲染推送

渲染侧 `src/common/rendererIpc.ts`：
- `rendererInvoke<T, R>(name, params?)` / `rendererSend<T>(name, params?)`
- `rendererOn(name, listener)` / `rendererOff(name, listener)`

事件名按组定义在 `src/common/ipcNames.ts`：
`CMMON_EVENT_NAME`(common)、`PLAYER_EVENT_NAME`(player)、`DISLIKE_EVENT_NAME`(dislike)、
`WIN_MAIN_RENDERER_EVENT_NAME`(winMain)、`WIN_LYRIC_RENDERER_EVENT_NAME`(winLyric)、
`HOTKEY_RENDERER_EVENT_NAME`(hotKey)。**不要硬编码字符串**，import 常量。

### 渲染侧调用清单（`src/renderer/utils/ipc.ts`）
- 设置：`getSetting`、`updateSetting`、`onSettingChanged`
- 启动/环境：`sendInited`、`getEnvParams`
- 播放状态：`sendPlayerStatus`、`onPlayerAction`、`setPlayerAction`
- 数据 blob（`DATA_KEYS`）：`saveLastStartInfo`/`getLastStartInfo`、`savePlayInfo`/`getPlayInfo`、
  `saveSearchHistoryList`/`getSearchHistoryList`、`saveListPositionInfo`/`getListPositionInfo`、
  `saveListPrevSelectId`/`getListPrevSelectId`、`saveViewPrevState`/`getViewPrevState`
- 歌词：`getPlayerLyric`、`getLyricRaw`、`clearLyricRaw`、`getLyricRawCount`、`getLyricEdited`、
  `saveLyric`、`saveLyricEdited`、`removeLyricEdited`、`clearLyric`、`clearLyricEdited`、`getLyricEditedCount`
- 主题：`getThemes`、`saveTheme`、`removeTheme`、`onThemeChange`
- 音效预设：`getUserSoundEffectEQPresetList`/`save...`、`getUserSoundEffectConvolutionPresetList`/`save...`
- 快捷键：`getHotKeyConfig`、`hotKeySetEnable`、`hotKeySetConfig`、`hotKeyGetStatus`、`onKeyDown`、`onUpdateHotkey`、`allHotKeys`
- 窗口：`minWindow`、`maxWindow`、`minMaxWindowToggle`、`showHideWindowToggle`、`focusWindow`、
  `closeWindow`、`quitApp`、`setFullScreen`、`setWindowSize`、`setIgnoreMouseEvents`、`setPowerSaveBlocker`、`onFocus`
- 文件/系统：`showSelectDialog`、`openSaveDir`、`openDirInExplorer`、`getSystemFonts`、`getCacheSize`、`clearCache`
- 歌词窗口：`onNewDesktopLyricProcess`
- 同步：`sendSyncAction`、`onSyncAction`、`getSyncServerDevices`、`removeSyncServerDevice`
- 本地音乐文件同步（同 `sync_action` 通道）：`musicFileGetConfig`、`musicFileGetFolders`、
  `musicFileCompare`、`musicFileApply`、`musicFileCancel`；进度以 `SyncMainWindowActions` 的
  `musicFile_progress` 变体推送

> 已移除：`getMusicUrl/saveMusicUrl/clearMusicUrl`、`getOtherSource/*`、`downloadTasks*`、
> `importUserApi/setUserApi/removeUserApi/*`、`sendOpenAPIAction`、`checkUpdate/downloadUpdate/*`、
> `onDeeplink/clearEnvParamsDeeplink`。

## 2. 同步特性（`list` + `dislike` + `musicFile`）

设置项：`sync.mode`(`server`/`client`)、`sync.enable`、`sync.server.port`、`sync.client.host`、
`sync.musicFile.root`（本机音乐根目录绝对路径）、`sync.musicFile.scope`（相对子目录数组，空=整根）。

### `musicFile` 对端 RPC（加密 WebSocket + `message2call`）
两端互相暴露同一组方法；握手只协商能力（`featureVersion.musicFile = 1`），传输由用户手动触发。

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `musicFile_get_root` | – | `string`（对端音乐目录） |
| `musicFile_get_index` | `scope: string[]` | `LX.Sync.MusicFile.FileIndex` |
| `musicFile_read_file` | `path, offset, size` | `{ data: base64, eof }` |
| `musicFile_write_file` | `path, offset, data, isLast` | `void` |
| `musicFile_delete_file` | `path, withLyric` | `void` |
| `musicFile_sync_finished` | – | `void`（客户端握手） |

跨端路径一律相对各自 `sync.musicFile.root`、以 `/` 分隔，两端都过 `assertSafeRelPath`；
分块大小 `MUSIC_FILE_CHUNK_SIZE`（192 KiB）。diff/plan 规则见 `doc/music-file-sync/本地音乐文件同步-设计.md`。

## 3. Workers（两个系统，别混）

### 3a. 主进程 DB worker — `global.lx.worker.dbService`
`worker_threads.Worker`（`src/main/worker/`）+ `better-sqlite3`，经 `Comlink.expose` 暴露给主进程；
**SQLite 只在这里被访问**。调用方式像本地异步对象：
- `init(dataPath)` → `true`（已存在）/`false`（新建）/`null`（结构校验失败）
- 合并门面：`list`（`my_list` + `my_list_music_info`）、`lyric`（raw + edited）、`dislike_list`
- 表结构（`DB_VERSION = '3'`）：`db_info`、`my_list`、`my_list_music_info`、`my_list_music_info_order`、
  `lyric`、`dislike_list`；历史表已在 v3 迁移中删除。
- 桥：`src/main/worker/utils/worker.ts`（`Comlink.expose`/`wrap`）
- **渲染进程从不直接调用 `dbService`**，一律 IPC → 主进程 → `dbService`

### 3b. 渲染进程 Web Worker — `window.lx.worker.main`
`src/renderer/worker/main/`，Comlink 包装（`src/renderer/worker/utils/index.ts`）：
- `createLocalMusicInfos(filePaths)` — 批量解析本地文件元数据（`utils/music.ts`）
- `getMusicFilePic(filePath)` — 内嵌/同名封面
- `getMusicFileLyric(filePath)` — 内嵌/同名 `.lrc`/`.krc` 歌词
- 列表工具：排序、过滤、查重、导入导出、列表内搜索等（`worker/main/list.ts`）
- `proxyCallback(fn)`（`Comlink.proxy`）把回调传回渲染进程

> 原 `window.lx.worker.download` 已删除。

## 4. 进程内事件总线

渲染进程 `window.app_event`（`src/renderer/event/appEvent.ts`，`createAppEventHub()`）：
- 播放：`play pause stop error`
- 底层播放器：`playerPlaying playerPause playerStop playerEnded playerError playerLoadeddata
  playerLoadstart playerCanplay playerEmptied playerWaiting playerDeviceChanged`
- 传输状态：`musicToggled setProgress setVolume setPlaybackRate setVolumeIsMute
  activePlayProgressTransition`
- 媒体：`picUpdated lyricUpdated lyricOffsetUpdate lyricLinePlay`
- 列表：`myListUpdate(ids)`
- 杂项：`focus setting dragStart dragEnd keyDown`

主进程 `global.lx.event_app`（`src/main/event/`）是**另一套**：`updated_config`、`player_status`、
`app_inited`、`main_window_close`、`system_theme_change` 等。不要混用。

## 5. 播放器 store / 引擎（渲染进程）

`src/renderer/store/player/`：
- `state.ts` — `isPlay`、`playMusicInfo`、`musicInfo`、`playedList`、`tempPlayList`、`playInfo`，以及音量/进度/倍速子 store
- `action.ts` — `setPlayMusicInfo`、`setMusicInfo`、`setAllStatus`、`getList`、`addPlayedList`、
  `clearPlayedList`、`clearTempPlayeList`、`removePlayedList`、`setPlayListId`

播放动作：`src/renderer/core/player/action.ts`（`playList/playListById/play/playNext/playPrev/
togglePlay/pause/stop/collectMusic/uncollectMusic/dislikeMusic/setMusicUrl`）。
音频引擎：`src/renderer/plugins/player/`（`setPlay/setPause/setStop/setResource/isEmpty` + Web Audio 图）。

## 6. 后续联网功能的预留接口（尚未实现）

规划中的「在线匹配歌词 / 封面」应作为独立小模块实现，复用：
- `common/utils/request.ts`（undici + 重试 + 代理；主进程侧 `main/utils/request.ts` 封装 `httpFetch`）
- 歌词写回：IPC `save_lyric_raw` / `save_lyric_edited`（已有）
- 封面写回：`musicInfo.meta.picUrl` + `store/list/action.updateListMusics`（已有）
- 代理配置：`network.proxy.*` + `views/Setting/components/SettingNetwork.vue`

不要复活 `core/music/online.ts` 那套「抓音源 + 换源」结构。
