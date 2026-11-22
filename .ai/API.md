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
`HOTKEY_RENDERER_EVENT_NAME`(hotKey)、`MEDIA_MATCH_EVENT_NAME`(media_match，事件名 `media_match_*`)、
`COVER_MATCH_EVENT_NAME`(cover_match，事件名 `cover_match_*`)。**不要硬编码字符串**，import 常量。

### 渲染侧调用清单（`src/renderer/utils/ipc.ts`）
- 设置：`getSetting`、`updateSetting`、`onSettingChanged`
- 启动/环境：`sendInited`、`getEnvParams`
- 播放状态：`sendPlayerStatus`、`onPlayerAction`、`setPlayerAction`
- 数据 blob（`DATA_KEYS`）：`saveLastStartInfo`/`getLastStartInfo`、`savePlayInfo`/`getPlayInfo`、
  `saveSearchHistoryList`/`getSearchHistoryList`、`saveListPositionInfo`/`getListPositionInfo`、
  `saveListPrevSelectId`/`getListPrevSelectId`、`saveViewPrevState`/`getViewPrevState`
- 歌词：`getPlayerLyric`、`getLyricRaw`、`clearLyricRaw`、`getLyricRawCount`、`getLyricEdited`、
  `saveLyric`、`saveLyricEdited`、`removeLyricEdited`、`clearLyric`、`clearLyricEdited`、`getLyricEditedCount`
- 在线歌词匹配（`media_match_*`）：`mediaMatchSearch`、`mediaMatchGetLyric`、`mediaMatchGetWordSync`、`mediaMatchApplyLrc`、
  `mediaMatchRollbackLrc`、`mediaMatchGetLrcState`、`mediaMatchGetFileState`
- 在线封面匹配（`cover_match_*`）：`coverMatchSearch`、`coverMatchApply`、`coverMatchGetState`、`coverMatchRollback`
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
- `getMusicFileLyric(filePath)` — 一次返回 `{ embedded, lrc }` 两种来源（内嵌 `LYRICS`/`USLT`；同名 `.lrc` → `.krc`）
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

## 6. 在线歌词匹配（`src/main/modules/mediaMatch/`）

按歌曲信息向 LRCLIB / QQ 音乐 / 网易云音乐查询候选，用户确认后由主进程写成音频同目录同名 `.lrc`；
渲染进程只做 UI 与列表 `meta.lyricSource` 更新，**不直接写文件**。
网易云源额外提供行级中文翻译（`tlyric`）与罗马音（`romalrc`），应用时写入 `.lrc` 扩展段
`[awlrc:lrc:<b64>,tlrc:<b64>,rlrc:<b64>]`（无翻译/罗马音时不写，输出与旧版一致）。

### IPC（`MEDIA_MATCH_EVENT_NAME`，事件名 `media_match_*`）

| 事件 | 参数 | 返回 |
| --- | --- | --- |
| `media_match_search` | `{ musicInfo, keyword? }` | `{ candidates: LX.MediaMatch.LyricsCandidate[] }` |
| `media_match_get_lyric` | `{ candidate }` | `{ lyric, isSynced, tlyric?, rlyric? } \| null` |
| `media_match_get_word_sync` | `{ candidate }` | `{ lyric, lxlyric } \| null`（仅 QQ QRC；失败返回 null） |
| `media_match_apply_lrc` | `{ musicInfo, candidate }` | `{ lrcPath, backupCreated, hasWordSync, hasTranslation?, hasRomaji? }` |
| `media_match_rollback_lrc` | `{ filePath, musicId? }`（音频路径 + 可选歌曲 id） | `{ restored }` |
| `media_match_get_lrc_state` | `{ filePath }`（音频路径） | `LrcState` |
| `media_match_get_file_state` | `{ filePath }`（音频路径） | `FileState`（见 §8） |

- 错误码以字符串前缀跨 IPC 传递：`MEDIA_MATCH_ERR:<code>`、`MEDIA_MATCH_LRC_ERR:<no_permission|disk_full|unknown>`；
  渲染侧 `renderer/utils/mediaMatch.ts` 负责解析与 i18n 映射。
- 路径安全：主进程 `checkPath` + `lrcFile.isAudioFilePath` 双重校验；只写音频所在目录的同名 `.lrc`。
- 应用/回退成功后清理该曲 DB 歌词覆盖（`raw` + `edited`），保证新 `.lrc` 立刻生效；`apply_lrc` 结果带
  `clearedDbLyric` 标记，渲染侧据此提示「已清除该曲原有的手动编辑/歌词偏移」。
- 文件规则（`lrcFile.ts`）：已有 `.lrc` 且无 `.lrc.bak` 时先备份；临时文件 + rename 原子写；失败自动恢复备份；
  回退 = 删除当前 `.lrc` 并把 `.lrc.bak` 改回。绝不改动音频文件。

### 数据源与纯逻辑

- `providers/lrclib.ts`：搜索（结构化 → `q=` 回退）、`/api/get/{id}` 按需取词；进程内 LRU（≤50）缓存搜索内联歌词；
  UA、串行 ≥260ms、10s 超时、2MB 上限、429/503 `Retry-After` + 抖动退避（≤2 次）。
- `providers/qq.ts`：`client_search_cp` 搜索 + `fcg_query_lyric_new.fcg` 取词（`nobase64=1`，**必须**带
  `Referer: https://y.qq.com/`）；业务码 `-1310/-1901/1101` 记 debug 并降级；不发送任何登录 Cookie。
- `providers/netease.ts`：第三方非官方、无 key。
  - 搜索 `GET https://music.163.com/api/search/get/web?csrf_token=&s=<kw>&type=1&offset=0&limit=10`；
  - 取词 `GET https://music.163.com/api/song/lyric?id=<id>&lv=-1&kv=-1&tv=-1&rv=-1`；
  - `tlyric.lyric` → 中文翻译、`romalrc.lyric`（回退 `yromalrc`）→ 罗马音，均做行级清洗（只留时间轴行，去 `//`/元信息）；
  - 必须带桌面 UA + `Referer: https://music.163.com/`，不发送 Cookie；串行 ≥300ms、10s 超时、4MB 上限；
    业务 `code!==200` / `nolyric` / `uncollected` / 无主歌词 → 降级；日志只记 source/cost/count/code。
- `matcher.ts`：`lrclib -> qq -> netease` 三源并行 + **单源预算 6s**（`searchSource`，到点只 abort 该源，
  总耗时不再由最慢源决定）、聚合 → 打分 → 去重 → 排序（≤30）；有候选即返回，候选为空且 ≥1 个源失败/超时 →
  抛 `MEDIA_MATCH_ERR:search_failed`（前缀常量在 `errors.ts`）。
- 纯逻辑在 `src/common/utils/mediaMatch/`：`normalize`（全角/清洗/伴奏标记）、`score`（0.5/0.3/0.2 + 伴奏减半）、
  `query`（查询变体）、`lrcText`（LRC 生成 + 取词有效性校验 + `sanitizeExtendedLyric` / `buildExtendedLrcText` /
  `getLyricPreviewEntries`）、`source`（内嵌/LRC 来源回退）、`qqParse`（QQ 响应解析）、
  `qrcLyric`（QRC → 行级 LRC + lxlyric，见下）。
- 逐字（QQ QRC）：`providers/qq.getWordSync` POST `https://u.y.qq.com/cgi-bin/musicu.fcg`
  （`music.musichallSong.PlayLyricInfo / GetPlayLyricInfo`，`qrc:1` + `crypt:1` 必须同时给；外层 `code` 与 `req.code` 两级判定）。
  hex → `common/utils/lyricUtils/qrc.js decodeQrc`（非标准 S-box 3DES + zlib，取自历史提交 `cb2798cb`）→ XML `LyricContent`
  → `qrcLyric.parseQrcLyric`。转换铁律：行标签 `[mm:ss.xxx]` **3 位小数**；词级 `<start,dur>` 的 start **相对行首**；
  `[kana:]` 等非时间轴行丢弃；无词级标签的行只进行级（保证 lxlyric 首行有词标签）。
- 逐字写入：`buildAwlrcLrcText` 生成 `正文 + "\n\n" + [awlrc:lrc:<b64>,awlrc:<b64-lxlyric>] + "\n"`；标签独占一行、
  `lrc:` 段与正文同源（桌面 `worker/main/music.ts parseLyric` 会用 `lrc:` 段覆盖正文）；无逐字时完全走一期行级逻辑。
- 取词有效性（provider 层）：长度 <20 或命中 `未经许可|不得翻唱|纯音乐|暂无歌词` → 视为无歌词；
  有 ≥1 个 `[mm:ss]` 才算 `isSynced`。`LyricsCandidate.instrumental` 仅作 UI 提示，不参与硬过滤。

## 7. 在线封面匹配（`src/main/modules/coverMatch/`）

按歌曲信息向 QQ 音乐（主源）/ iTunes（回退）搜索封面候选，用户确认后由主进程下载并写成音频同目录同名
`.jpg` / `.png`（**不内嵌、不改音频**）；渲染进程只做 UI，`worker/main/music.ts` 对同名图返回带 `?v=<mtimeMs>`
的路径以击穿图片缓存。

### IPC（`COVER_MATCH_EVENT_NAME`，事件名 `cover_match_*`）

| 事件 | 参数 | 返回 |
| --- | --- | --- |
| `cover_match_search` | `{ musicInfo, keyword? }` | `{ candidates: LX.CoverMatch.CoverCandidate[] }`（≤20） |
| `cover_match_apply` | `{ musicInfo, candidate }` | `{ imagePath, format: 'jpg'\|'png', backupCreated }` |
| `cover_match_get_state` | `{ filePath }`（音频路径） | `CoverState` |
| `cover_match_rollback` | `{ filePath }`（音频路径） | `{ restored }` |

- 错误码：`COVER_MATCH_ERR:<invalid_music|file_not_found|invalid_candidate|download_failed|image_invalid|image_too_large|no_permission|disk_full|unknown>`；
  渲染侧 `renderer/utils/coverMatch.ts` 解析并映射 i18n。
- 源：QQ `client_search_cp` 取 `albummid` → `T002R500x500M000<albummid>.jpg`（缩略图 R150；下载 `Accept: image/jpeg,image/png`，
  防 WebP）；iTunes `search?entity=song`（CJK 用 `country=jp`，否则 `us`，0 结果换 store；`100x100bb`→`600x600bb`）。
  MusicBrainz/Deezer 二期不接（CAA 取图超时 / 本机不可达）。
- 纯逻辑 `src/common/utils/coverMatch/score.ts`：0.5 标题 + 0.3 歌手 + 0.2 时长 + 专辑 `+0.05`（封顶 1）、伴奏 `*0.5`、
  专辑维度去重（`source:id`）、≤20 条。
- 文件规则（`coverMatch/coverFile.ts`）：只接受 JPEG/PNG magic、200–4000px、≤8MB；已有同名 jpg/png 先备份为 `.bak`
  （只保留第一次备份），`.tmp` + rename 原子写，失败恢复；回退 = `.bak` 原子写回并删除备份。绝不改音频。

不要复活 `core/music/online.ts` 那套「抓音源 + 换源」结构。

## 8. 一键补全缺失歌词/封面（批次）

对**当前列表**逐首检查「内嵌歌词/封面 + 同目录同名文件」，只对两项都缺失的歌曲自动匹配并写入第一个可用结果；
串行、每首约 200ms、可取消、有进度与结束汇总。

### IPC

| 事件 | 参数 | 返回 |
| --- | --- | --- |
| `media_match_get_file_state` | `{ filePath }`（音频绝对路径） | `{ fileExists, hasEmbeddedLyric, hasSidecarLyric, hasEmbeddedCover, hasSidecarCover }` |

- 主进程实现 `main/modules/mediaMatch/fileState.ts`：一次 `music-metadata` 解析同时判定内嵌歌词/封面；
  同目录 `.lrc/.LRC/.krc/.KRC`、`.jpg/.png` 用 `fs.stat` 判存在且 **>0 字节**。
- 性能：同目录歌词与封面都已存在时**不调用** `parseFile`（`common/utils/mediaMatch/fileState.shouldParseAudioMetadata`）。
- 健壮性：文件不存在/损坏/无权限一律返回「无内嵌」且不抛错；渲染层按 `fileExists=false` 计 `skipped`。
- 内嵌歌词口径：`common.lyrics`（含 `syncText`，覆盖 M4A `©lyr`）trim 非空，或 native `LYRICS`/`USLT` >10 字符；
  内嵌封面：`common.picture` 非空。

### 纯逻辑 / 渲染接线

- `common/utils/mediaMatch/fileState.ts`：同目录路径推导、内嵌判定、`getMissingFlags` 真值表、`getFileState`。
- `common/utils/mediaMatch/batch.ts`：`createBatchMatcher(deps)` 批次编排（扫描 → 补全 → 汇总）与自动选择顺序：
  - 歌词：`[0, ...(start+1..start+4 中 !instrumental && score>=0.6 的下标)]`，第一个 `lyric.trim()` 非空且写入成功即采用；
  - 封面：`[0,1,2]`，第一个下载+写入成功即采用；
  - 同时提供 `toPlainMusicInfo` / `toPlainLyricCandidate` / `toPlainCoverCandidate`（Vue Proxy 跨 IPC structured clone 会抛错）。
- `renderer/views/List/MusicList/useBatchMatch.js`：注入 IPC/`refreshPlayLyric`/`refreshPlayCover`/`setMusicLyricSource(...,'lrc')`；
  `components/common/BatchMatchModal.vue` 显示扫描/补全阶段、进度、歌曲名、计数与取消；`MusicList/index.vue` 顶部工具条按钮
  （`batch_match__btn`）→ `dialog.confirm(batch_match__confirm)` → 开始。
- i18n key 前缀 `batch_match__`（§8 契约表 + 弹窗计数/取消中文案），四语齐全。
