# DATA_FLOW.md — 数据怎么走

> 按场景的分步流程。先读 `ARCHITECTURE.md`。文中函数/文件名为真实实现。

## 1. 本地歌曲导入（我的列表）

```
views/List/MyList/useMenu.js  (菜单：local_file / local_folder)
  → views/List/MyList/actions.ts
      · addLocalFile  : showSelectDialog(openFile, multiSelections, 音频白名单)
      · addLocalFolder: 递归扫描目录，过滤 .mp3/.flac/.ogg/.oga/.wav/.m4a
  → 分批（每批 200 条）调用 window.lx.worker.main.createLocalMusicInfos(paths)
      → renderer/worker/main/list.ts → utils/music.ts createLocalMusicInfo()
          · music-metadata 解析 title/artists/album/duration
          · 生成 MusicInfoLocal：{ id: filePath, source: 'local', meta: { filePath, albumName, ext, ... } }
  → store/list/action addListMusics(listId, infos)
  → IPC → main → dbService.list 写入 my_list_music_info
```

要点：
- **本地歌曲的 `id` 就是文件绝对路径**；文件移动/改名会导致播放失败（见 `RISKS.md`）。
- 导入后列表 UI 可按名称/歌手/专辑/时长排序、查重、导出 `.lxmc`。

## 2. 播放一首歌（核心链路）

```
UI（双击/播放按钮/快捷键/托盘） / 自动切歌
        │
        ▼
core/player/action.ts  playList() / playListById() / playNext() / playPrev() / play() / togglePlay()
        │  setPlayMusicInfo(listId, musicInfo, isTempPlay?)   (store/player/action)
        ▼
handlePlay()
  ├─ resetRandomNextMusicInfo()
  ├─ setStop(); window.app_event.pause()
  ├─ setMusicUrl(musicInfo)                    → getMusicPlayUrl()
  ├─ getPicPath({ musicInfo, listId })         → picUpdated 事件
  └─ getLyricInfo({ musicInfo })               → lyricUpdated 事件
        │
        ▼
core/music/index.ts getMusicUrl({ musicInfo, isRefresh })
        ▼
core/music/local.ts getMusicUrl()
  ├─ getLocalFilePath() 命中 → encodePath(path) → file://
  └─ 文件不存在 → throw '本地文件不存在'
        │
        ▼
setResource(url) (plugins/player) → HTMLAudioElement.src → play()
        │
        ▼
plugins/player 音频事件 → core/useApp/usePlayer/* → store/player 更新
        │
        ▼
window.app_event.player* → UI（播放栏 / 播放详情 / 状态栏歌词）
        │
        ▼
sendPlayerStatus(partial) → IPC `player_status` → main 更新 global.lx.player_status
                                                        │
                             托盘 / 任务栏进度 / 桌面歌词通道 ◄
```

`getMusicPlayUrl`（`core/player/action.ts`）已去掉换源与在线重试，只保留：
- 5s「延迟自动下一首」与 100s「加载超时」两个看门狗（`createDelayNextTimeout`）；
- `diffCurrentMusicInfo()` 防止用户切歌后旧请求覆盖新状态；
- 失败时按 `player.autoSkipOnError` 决定是否自动跳过。

切歌顺序：`getNextPlayMusicInfo()` / `playNext()` / `playPrev()`，遵循
`player.togglePlayMethod`（`listLoop | random | list | singleLoop | none`）、
「稍后播放」临时队列与 `playedList`（最近播放）环形表，`filterList()` 过滤已播/失效项。

## 3. 封面与歌词解析（本地）

`core/music/local.ts`：

| 资源 | 取法 |
| --- | --- |
| 封面 | 优先 `renderer/worker/main/music.ts getMusicFilePic(filePath)`（内嵌封面 `selectCover`；先找同名 `.jpg`/`.png`）；其次 `musicInfo.meta.picUrl`（历史缓存/未来匹配结果） |
| 歌词 | `getCachedLyricInfo(musicInfo)`（DB `lyric` 的 raw/edited）与 `getMusicFileLyric(filePath)` 并行取：优先内嵌（ID3 `USLT`/`LYRICS`、FLAC `LYRICS`），再同名 `.lrc`（`jschardet` 探测编码 + `iconv-lite` 解码）与同名 `.krc`（`decodeKrc`）；若已编辑歌词与文件歌词不一致，用已编辑歌词并保留文件原词作 `rawlrcInfo` |
| 显示转换 | `buildLyricInfo()` 处理繁简转换（`player.isS2t`）并补齐 `rawlrcInfo` |

## 4. IPC 通用往返

```
renderer:  rendererInvoke(name, params)   等待返回值
           rendererSend(name, params)     单向
           rendererOn(name, listener) / rendererOff(...)
main:      mainHandle(name, handler)      可返回值
           mainOn(name, handler)          单向
           sendEvent(name, params)        主 → 渲染推送
```

- 渲染侧调用清单：`src/renderer/utils/ipc.ts`（设置、歌词、列表数据、同步、窗口、快捷键、主题、音效预设、播放状态）。
- 主侧处理器：`src/main/modules/winMain/rendererEvent/*`（+ `winLyric/rendererEvent.ts`、`commonRenderers/*`）。
- `save_data`/`get_data` 承担小型 blob 持久化（键见 `DATA_KEYS`）。

## 5. 持久化流程

- **设置**：`getSetting()`（主进程读 `config_v2`）→ 渲染 `initSetting()` 合并进 `appSetting`；
  `updateSetting(partial)` 写回；主进程 `on_config_change` → 自身总线 `updated_config`
  （`app.ts` 据此重设代理/音量/主题等）。
- **列表**：`store/list` action → IPC → `dbService.list`（`my_list`、`my_list_music_info`）；
  变更同时广播主进程 `event_list` 与渲染进程 `myListUpdate`，各视图刷新。
- **不喜欢列表**：`core/dislikeList.ts` + `dbService.dislike_list`；用于播放过滤（同步特性保留）。
- **DB 初始化与迁移**：`initAppSetting()`：`dbService.init()` → 结构校验失败（`null`）时备份
  `lx.data.db*` 并重建 → `initSetting()` → `migrateDBData()`（一次性旧 JSON 数据迁移）。

## 6. 跨端同步

`src/main/modules/sync/`，由 `appSetting['sync.mode']` 决定角色：

- **Server**（`server/`）：`startServer/stopServer`、`generateCode`、设备列表、鉴权。
- **Client**（`client/`）：`connectServer/disconnectServer`、AES+RSA 握手、`message2call` RPC。
- 动作走 `sendSyncAction`/`onSyncAction` IPC（`sync_action`），列表/不喜欢子事件
  （`listEvent.ts`、`dislikeEvent.ts`）与 `migrate.ts`。UI：`views/Setting/components/SettingSync/`。
- **特性协商**（`FeaturesList`，`common/constants_sync.ts`）：`list`、`dislike`、`musicFile`。
  `list`/`dislike` 认证后自动双向同步；`musicFile` 只协商能力，传输由用户手动触发。

### 6.1 本地音乐文件同步（`musicFile`）

目标：在 PC 与 Android 之间同步本地音乐库的**一个子集**（含同名 `.lrc`），并让用户决定
新增/删除如何应用。

```
设置页 SettingSync/MusicFileSync.vue
  → IPC：musicFileGetConfig / GetFolders / Compare / Apply / Cancel（sync_action）
  → main: modules/sync/musicFile/service.ts（驱动）
       ├─ localFs.ts  扫描目录、分块读写、删除（含 .lrc）
       ├─ diff.ts     纯函数：变更分类与执行计划（与 lx-music-mobile 1:1 镜像）
       ├─ baseline.ts <lxDataPath>/sync/musicFile/baseline.json（上次同步认同的路径）
       └─ peer.ts     对端 socket（server 角色取首个就绪 client；client 角色用自己的连接）
  → 对端 RPC：musicFile_get_index / read_file / write_file / delete_file
  → 进度回推：`musicFile_progress`
```

要点：
- 所有跨端路径都是**相对各自 `sync.musicFile.root`** 的 `/` 分隔路径，两端用 `assertSafeRelPath` 校验。
- 变更分类依赖每台设备的 baseline；删除默认不勾选。完整规则见 `doc/music-file-sync/本地音乐文件同步-设计.md`。
- `diff.ts` 不依赖任何运行时，可直接用 node 单测（`tests/music-file-*.test.ts`）。

## 7. 桌面歌词窗口

```
主窗口播放 → 通过 (a) 普通 IPC 与 (b) 专用 MessagePort 推送
        ▼
renderer-lyric/core/mainWindowChannel.ts handleDesktopLyricMessage(action):
  set_info / set_lyric / set_status / set_offset / set_playbackRate / set_pause / set_play / set_stop
        ▼
renderer-lyric/store + core/lyric → 滚动歌词（可选音频可视化）
```

主进程侧：`winLyric/main.ts` 创建窗口、`rendererEvent.ts` 处理启用/锁定/置顶等操作；窗口会回请求
`get_info` / `get_status` / analyser 数据（同一 MessagePort）。

## 8. 启动流程（主进程）

`src/main/index.ts` → `initGlobalData()`（构建 `global.lx`、`global.envParams`、`global.staticPath`）→
`applyElectronEnvParams()`（CLI：`dha` 关硬件加速、`proxy-server` 等）→ 单实例锁 →
`setUserDataPath()`（portable 探测）→ `listenerAppEvent()` → 注册模块 →
`app.whenReady` → `initAppSetting()`（DB + 设置 + 主题）→ 创建主窗口。
渲染进程完成后 `sendInited()`，主进程置 `global.lx.inited`。

## 9. 渲染进程启动流程

`src/renderer/main.ts`：
`getSetting()` → 语言初始化 → `initSetting()` → 创建 Vue app（router / i18n / 组件注册）→ 挂载 `#root`。

`App.vue` 中 `useApp()`（`core/useApp/index.ts`）：
代理/主题/全屏恢复 → `useEventListener` → `usePlayer` → `getEnvParams` → `getViewPrevState` 恢复路由 →
`useDataInit()`（用户列表、远端不喜欢事件、上次播放）→ `useSync` → `useStatusbarLyric` → `sendInited()`。