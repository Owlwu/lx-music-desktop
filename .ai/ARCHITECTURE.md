# ARCHITECTURE.md — 进程与数据架构

> 配套 `PROJECT.md`。重点：Electron 各进程如何协作、边界在哪、状态放哪。
> 路径相对仓库根目录。

## 1. 多进程模型

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 主进程 (Node) — src/main/index.ts                                             │
│                                                                              │
│  • Electron 生命周期、BrowserWindow、托盘、菜单、快捷键、单实例               │
│  • 功能模块：winMain winLyric commonRenderers hotKey tray appMenu sync        │
│  • global.lx / global.envParams（主进程共享可变状态）                         │
│  • HTTP（undici，用于同步/代理）、FS、主题、设置                              │
│                                                                              │
│  ┌────────────────────────────┐                                              │
│  │ DB Worker (worker_threads) │  src/main/worker/dbService                   │
│  │ better-sqlite3 (WAL)       │  经 Comlink 暴露给主进程                     │
│  └────────────────────────────┘                                              │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ ipcMain / ipcRenderer
               ▼
┌────────────────────────────────┐   ┌─────────────────────────────────────────┐
│ 主窗口渲染进程 (Vue 3)         │   │ 桌面歌词渲染进程 (Vue 3)                │
│ src/renderer                   │   │ src/renderer-lyric                      │
│ 播放器、本地库、stores、views  │   │ 无边框、置顶、透明的歌词窗口            │
└────────────────────────────────┘   └─────────────────────────────────────────┘
```

### 边界
- **渲染进程 ↔ 主进程**：只能走 IPC。事件名集中在 `src/common/ipcNames.ts`；封装在
  `src/common/mainIpc.ts`（主侧：`mainOn`/`mainHandle`/`sendEvent`）与
  `src/common/rendererIpc.ts`（渲染侧：`rendererSend`/`rendererInvoke`/`rendererOn`/`rendererOff`）。
- **主进程 ↔ DB worker**：只能走 Comlink 代理（`global.lx.worker.dbService.*`）。SQLite 只在 worker 内被触碰。
- **主进程 ↔ 桌面歌词**：两条通道 —— 普通 IPC，以及主进程创建后分发给两个窗口的专用
  `MessagePort`（低延迟歌词/播放状态同步）。渲染侧见 `src/renderer-lyric/core/mainWindowChannel.ts`。
- **主进程 ↔ 渲染进程 Web Worker**：`new Worker(new URL('../main', import.meta.url))` + Comlink，
  暴露为 `window.lx.worker.main`（本地文件解析等 CPU/IO 重活）。

> 已不存在的边界（不要再找）：userApi 隐藏窗口、openApi HTTP/SSE 服务、deeplink 协议处理。

## 2. 共享状态

### 主进程 `global.lx`（`src/main/app.ts:initGlobalData`）
```
global.lx = {
  inited, isSkipTrayQuit,
  event_app, event_list, event_dislike,   // 主进程事件总线
  appSetting,        // LX.AppSetting（来自 store/config_v2）
  worker,            // { dbService } Comlink 代理
  hotKey,            // { enable, config{local,global}, state }
  theme,             // { shouldUseDarkColors, theme{ id,name,isDark,colors } }
  player_status,     // LX.Player.Status 快照（驱动托盘、任务栏进度、桌面歌词）
}
global.envParams = { cmdParams, workAreaSize? }   // 仅 CLI 参数（deeplink 已移除）
global.lxDataPath   // <userData>/LxDatas（DB 与用户文件）
global.lxOldDataPath
global.staticPath   // dev: webpack 注入；prod: dist/static
```
- `global.lx.player_status` 是**主进程侧播放状态的唯一来源**：渲染进程通过 `player_status` IPC 更新，
  托盘与歌词通道消费。

### 渲染进程 —— 响应式 store（非 Pinia）
- `src/renderer/store/index.ts` —— 顶层全局：`proxy`、`sync`、`windowSizeList`、`windowSizeActive`、
  `isShowPact`、`isFullscreen`、`themeShouldUseDarkColors`、`themeId`、`themeInfo`。
- 分域 store（每域 `state.ts` + `action.ts`，部分带 `hook.ts`）：
  `player/`（`state action lyric volume playProgress playbackRate`）、`list/`（含 `listManage/`）、
  `dislikeList/`，以及 `setting.ts`、`soundEffect.ts`、`utils.ts`（主题工具）。
- 约定：store 既导出响应式状态也导出小函数；组件直接读状态、调用 action 改状态；没有集中注册表。

## 3. 事件总线（进程内 pub/sub）

两种机制，别混：

| 机制 | 位置 | 用途 |
| --- | --- | --- |
| **IPC**（`ipcNames.ts`） | 跨进程 | 渲染 ↔ 主，渲染 ↔ 歌词窗口 |
| **事件总线**（`Event`） | 单进程内 | 解耦同一进程里的模块 |

- 渲染进程总线：`src/renderer/event/`（`Event.ts` + `appEvent.ts`），实例是 `window.app_event`。
- 主进程总线：`src/main/event/`（`createAppEvent`/`createListEvent`/`createDislikeEvent`），
  被 `app.ts`、托盘、同步模块订阅。
- 歌词窗口：`src/renderer-lyric/store/` + `core/mainWindowChannel.ts`。

## 4. 数据持久化

### SQLite —— `src/main/worker/dbService/`
- `better-sqlite3`，WAL；文件 `<lxDataPath>/lx.data.db`。
- 初始化/校验：`dbService.init(dataPath)` 返回 `true`（已存在）/`false`（新建）/`null`（结构校验失败
  → 主进程备份旧库并重建，见 `src/main/app.ts`）。
- 活跃 DAO 模块（`dbService/modules/`）：`list`（`my_list` + `my_list_music_info`）、`lyric`（raw + edited）、
  `dislike_list`。三者在 `dbService/index.ts` 合并成一个门面。
- **表结构仍保留** `music_url` / `music_other_source` / `download` 三张历史表（`tables.ts` 未删），
  但没有 DAO、没有写入；保留是为了不触发 `verifyDB` 重建（见 `RISKS.md`）。

### JSON / 文件 —— `src/main/utils/store`
- 设置：`config_v2`（`LX.AppSetting`）；`STORE_NAMES` 见 `src/common/constants.ts`。
- `DATA_KEYS`（经 `save_data`/`get_data` IPC 存取的小 blob）：`viewPrevState`、`playInfo`、
  `searchHistoryList`、`listScrollPosition`、`listPrevSelectId`、`lastStartInfo`。
- 主题、音效预设（EQ/卷积）、快捷键配置、同步状态各自单独文件。

## 5. 播放资源解析架构（已收敛为本地）

`src/renderer/core/music/index.ts` 现在是薄封装，只保留一条路径：

| 文件 | 职责 |
| --- | --- |
| `core/music/index.ts` | 对外的 `getMusicUrl / getPicPath / getLyricInfo`，转调 `local.ts` |
| `core/music/local.ts` | 本地文件路径（`file://`）、内嵌/同名封面、内嵌/同名 `.lrc`/`.krc`、已编辑歌词缓存 |
| `core/music/utils.ts` | 仅歌词工具：`buildLyricInfo`、`getCachedLyricInfo`、`existTimeExp` |

（原 `online.ts`（provider + DB 缓存 + 换源）与 `download.ts` 已删除；`LX.Download.ListItem` 类型仍保留，
历史数据里可能还有此类记录，播放链路会把它当普通 `MusicInfo` 处理。）

## 6. 窗口拓扑

| 窗口 | 创建者 | 说明 |
| --- | --- | --- |
| 主窗口 | `src/main/modules/winMain/main.ts` | 无边框可缩放，尺寸档位见 `src/common/config.ts` |
| 桌面歌词 | `src/main/modules/winLyric/` | 无边框、置顶、透明、可拖拽；独立 Vue 应用 |
| 弹窗 | 渲染进程内 | 主题、设置、对话框都是窗口内 Vue 覆盖层，不是独立窗口 |

## 7. 安全姿态

- 主窗口 `webPreferences`：`contextIsolation: false`、`nodeIntegration: true`、`nodeIntegrationInWorker: true`
  （渲染进程需要 Node 能力做本地文件解析与 Worker）。
- `listenerAppEvent`（`src/main/app.ts`）在启动后锁定导航：外部 http(s) 链接走 `shell.openExternal`，
  `will-attach-webview` 剥离 preload 并禁用 nodeIntegration。
- 已移除 userApi 沙箱窗口与 OpenAPI 服务 —— 当前没有运行用户脚本或监听端口的模块。

## 8. 与上游的关系

本仓库已 fork 出独立分支（`master`），`master_up` 仅作历史/对照保留；**不再定期 merge 上游**。
新增代码不要为了「与上游一致」而保留无用分支逻辑。
