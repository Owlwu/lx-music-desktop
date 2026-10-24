# MODULES.md — 文件都在哪

> 目录/模块地图，含职责与关键文件。配合 `ARCHITECTURE.md`（怎么连起来）与 `DATA_FLOW.md`（怎么流动）。

## 1. 主进程模块 — `src/main/modules/`

注册顺序固定于 `src/main/modules/index.ts`（`isRegistered` 守卫）：
`commonRenderers → winMain → hotKey → tray → appMenu → winLyric`。
每个模块默认导出 `registerX()`，内部完成 IPC 与 Electron 生命周期接线。
（`sync` 不在这个注册表里：它的启停通过 `winMain` 的 `sync_action` IPC 调用；模块自身的默认导出目前未被调用，属上游遗留。）

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| **winMain** | `winMain/` | 主窗口生命周期 + 绝大多数业务 IPC |
| **winLyric** | `winLyric/` | 桌面歌词窗口（无边框置顶）及其 IPC |
| **commonRenderers** | `commonRenderers/` | 跨渲染进程公共能力：设置读写、env、主题、系统字体 |
| **hotKey** | `hotKey/` | 本地 + 全局快捷键，转发为 app 事件 |
| **tray** | `tray.ts` | 托盘图标/菜单（播放控制、显示、退出） |
| **appMenu** | `appMenu.ts` | 应用菜单栏 |
| **sync** | `sync/` | 跨端同步：`server/`（主机）+ `client/`（连接）+ `musicFile/`（本地音乐文件同步） |

### winMain 内部
- `main.ts` — 创建/显示/销毁主窗口、尺寸、全屏、透明、缓存
- `utils.ts` — 辅助函数
- `rendererEvent/index.ts` — 注册所有 `WIN_MAIN_RENDERER_EVENT_NAME` 处理器，拆分到：
  - `app.ts` — 窗口控制、对话框、主题、播放状态上报、devtools
  - `music.ts` — 歌词 raw/edited 的读写与查询（`get_palyer_lyric`、`get_lyric_raw` …）
  - `data.ts` — 通用 `save_data`/`get_data`（`DATA_KEYS`）
  - `hotKey.ts` — 快捷键配置/状态
  - `soundEffect.ts` — EQ/卷积预设持久化
  - `sync.ts` — 同步模块桥接
  - `process.ts` — 进程信息等杂项

## 2. 主进程支撑 — `src/main/`

| 路径 | 作用 |
| --- | --- |
| `index.ts` | 进程入口：`initGlobalData` → env → 单实例 → 注册模块 → `app.whenReady` |
| `app.ts` | `initGlobalData`、`initAppSetting`（DB 初始化 + 迁移）、`listenerAppEvent`、`setUserDataPath`、`quitApp` |
| `worker/` | DB worker：`index.ts`（createWorkers）、`dbService/`、`utils/worker.ts`（Comlink + worker_threads） |
| `event/` | 主进程事件总线：`createAppEvent`、`createListEvent`、`createDislikeEvent` |
| `utils/` | `request.ts`（undici 包装 + 代理）、`setting.ts`、`theme.ts`、`hotKey.ts`、`migrate.ts`、`nodejs.ts` |
| `types/` | 主进程侧类型声明 |

## 3. 共享层 — `src/common/`

被 main 与 renderer 同时引入，是契约层。

| 路径 | 作用 |
| --- | --- |
| `ipcNames.ts` | 全部 IPC 事件名（`CMMON_EVENT_NAME`、`WIN_MAIN_RENDERER_EVENT_NAME`、`WIN_LYRIC_RENDERER_EVENT_NAME`、`HOTKEY_*` 等） |
| `mainIpc.ts` / `rendererIpc.ts` | `ipcMain`/`ipcRenderer` 的类型化薄封装 |
| `types/` | 全局 `LX.*` 命名空间：`app_setting`、`music`、`player`、`list`、`list_sync`、`dislike_list(_sync)`、`sync`、`music_file_sync`、`music_metadata`、`theme`、`sound_effect`、`desktop_lyric`、`config_files`、`ipc_*` |
| `constants.ts` | `STORE_NAMES`、`APP_EVENT_NAMES`、`LIST_IDS`、`DATA_KEYS`、`DEFAULT_SETTING`、`TRAY_AUTO_ID` |
| `defaultSetting.ts` / `defaultHotKey.ts` | 设置/快捷键默认值（已剔除音源、搜索、下载、OpenAPI、自动更新键） |
| `config.ts` | 窗口尺寸档位、白名单等 |
| `constants_sync.ts` | 同步协议常量与 `FeaturesList`（`list` / `dislike` / `musicFile`） |
| `utils/` | `common`、`nodejs`、`request`(undici)、`tools`、`electron`、`lyricUtils`、`lyric-font-player`、`pinyin`、`migrateSetting` |

## 4. 主窗口渲染进程 — `src/renderer/`

### core
| 路径 | 作用 |
| --- | --- |
| `core/player/` | 播放控制：`action.ts`（playList/playNext/playPrev/setMusicUrl…）、`utils.ts`、`timeoutStop.ts` |
| `core/music/` | 资源分发：`index.ts`（对外）、`local.ts`（本地文件/封面/歌词）、`utils.ts`（歌词工具） |
| `core/useApp/` | 启动编排：`index.ts`（总入口）、`useDataInit`、`useEventListener`、`useHandleEnvParams`、`useSettingSync`、`useStatusbarLyric`、`useSync`、`usePlayer/` |
| `core/lyric.ts` | 歌词行解析/偏移 |
| `core/dislikeList.ts` | 不喜欢规则匹配（同步特性保留，UI 已隐藏） |
| `core/globalData.ts` | 构建 `window.lx`（worker、状态默认值） |

### store（无 Pinia）
| 路径 | 作用 |
| --- | --- |
| `store/index.ts` | 全局：`proxy`、`sync`、`windowSize*`、`isFullscreen`、`theme*`、`isShowPact` |
| `store/setting.ts` | `appSetting` + `updateSetting` + 常用 setter |
| `store/player/` | `state`（playMusicInfo/musicInfo/playedList/tempPlayList）、`action`、`lyric`、`volume`、`playProgress`、`playbackRate` |
| `store/list/` | 列表状态与 CRUD；`listManage/` 负责内存缓存与渲染进程 worker 协作 |
| `store/dislikeList/` | 不喜欢列表状态（同步特性） |
| `store/soundEffect.ts` | EQ/卷积/声像/变速参数 |
| `store/utils.ts` | 主题构建与切换工具 |

### views
| 路径 | 作用 |
| --- | --- |
| `views/List/` | 我的列表（`MyList/`）+ 歌曲列表（`MusicList/`）：导入文件夹/文件、排序、去重、导入导出、右键菜单、列表内搜索 |
| `views/Setting/` | 设置：`SettingBasic`（主题/语言/字体/窗口/控制按钮位置）、`SettingPlay`、`SettingPlayDetail`、`SettingDesktopLyric`、`SettingList`、`SettingSync/`（含 `MusicFileSync.vue`）、`SettingHotKey`、`SettingNetwork`（代理）、`SettingBackup`、`SettingOther`、`SettingAbout`，以及 `ThemeEditModal/` |

### components / plugins / worker
| 路径 | 作用 |
| --- | --- |
| `components/layout/{Aside,Toolbar,PlayBar,PlayDetail}/` | 主框架：侧栏（导航 + 左上 logo/窗口按钮）、工具栏（**页面标题 + 右上角窗口按钮**）、播放栏、播放详情页 |
| `components/layout/{PactModal,SyncModeModal,SyncAuthCodeModal,Icons,View}.vue` | 协议弹窗、同步弹窗、图标 sprite、路由出口 |
| `components/base/` | 基础控件：`Btn Checkbox Input Menu MusicList Popup Selection SliderBar Tab VirtualizedList` |
| `components/common/` | 通用业务控件：`ListAddModal`、`PlaybackRateBtn`、`ProgressBar`、`SoundEffectBtn/`、`TogglePlayModeBtn`、`VolumeBtn`、`AudioVisualizer` 等 |
| `components/material/` | 列表行按钮、排序等列表物料（`ListButtons.vue` 已无下载按钮） |
| `plugins/player/` | 音频引擎（HTMLAudioElement + Web Audio：EQ、卷积、声像、变速、analyser） |
| `plugins/{Dialog,SvgIcon,Tips}/` | 对话框、图标、提示 |
| `worker/main/` | 渲染进程 Web Worker：`list.ts`（本地文件解析、排序/过滤/去重、导入导出）、`music.ts`（内嵌封面/歌词）、`common.ts` |
| `event/` | `window.app_event`（渲染进程事件总线） |

## 5. 桌面歌词窗口 — `src/renderer-lyric/`

| 路径 | 作用 |
| --- | --- |
| `main.ts` | 独立 Vue 入口 |
| `core/mainWindowChannel.ts` | 与主窗口的 `MessagePort` 通道（歌词/状态/偏移/播放速率） |
| `components/` | 歌词行渲染、字体效果 |
| `store/` `useApp/` `plugins/` | 歌词窗口自己的状态与插件 |

主进程侧：`src/main/modules/winLyric/{index,main,config,rendererEvent,utils,mouseCheckTools}.ts`。

## 6. 构建与打包 — `build-config/`

| 路径 | 作用 |
| --- | --- |
| `pack.js` | 并行构建三个 bundle（main / renderer / renderer-lyric）到 `dist/` |
| `runner-dev.js` | 开发服务器 + 启动 Electron（**启动子进程前移除 `ELECTRON_RUN_AS_NODE`**） |
| `build-pack.js` | electron-builder 打包（target/arch/type 来自 argv） |
| `main/webpack.config.{base,dev,prod}.js` | 主进程 bundle（target Node） |
| `renderer/webpack.config.*.js` | 主窗口 bundle |
| `renderer-lyric/webpack.config.*.js` | 歌词窗口 bundle |
| `build-{before,after}-pack.js`、`post-install.js`、`dependencies-patch.js`、`lib-update.js` | 打包钩子与依赖维护 |
| `lib/` | vendor 的构建辅助 |

无 `renderer-scripts` 目标（userApi 默认脚本已随功能删除）。

## 7. 其他

- `src/lang/` — i18n 文案（`zh-cn` / `zh-tw` / `en-us` / `ko-kr`）
- `src/static/` — 打包时复制到应用旁的静态资源（`global.staticPath`）
- `doc/music-file-sync/本地音乐文件同步-设计.md` — musicFile 同步契约
- `tests/` — musicFile 同步纯逻辑测试（node 直接运行，不进 bundle、不参与 lint）
- `dist/` — webpack 输出（`dist/main.js` 是打包入口）
