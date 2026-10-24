# PROJECT.md — LX Music Desktop（纯本地播放器分支）

> 知识库入口。给 agent 的 30,000 英尺视角，读完再进代码。
> 路径均相对仓库根目录。配套：`ARCHITECTURE.md`（进程/边界）、`MODULES.md`（文件在哪）、
> `DATA_FLOW.md`（数据怎么走）、`API.md`（接口契约）、`RISKS.md`（坑）、`DEVELOPMENT.md`（怎么跑）。

## 这是什么

`lx-music-desktop` 是本仓库的分支版本，已从上游「在线音乐聚合播放器」精简为 **纯本地音乐播放器**：

- 播放本地音频文件（mp3 / flac / ogg / oga / wav / m4a），读取内嵌或同名 `.lrc` 歌词与内嵌/封面文件
- 「我的列表」管理（试听列表、我的收藏、自定义列表、文件夹递归导入、导入导出 `.lxmc`）
- 桌面歌词窗口、均衡器/卷积混响/变速变调、全局快捷键、系统托盘
- 与 `lx-music-mobile` 的跨端同步：列表 / 不喜欢列表 / **本地音乐文件同步（musicFile）**

**已移除**（不要试图找回，相关文件已删除）：在线音源抓取（kw/kg/tx/wy/mg/xm/bd）、搜索、排行榜、
在线歌单与歌单详情、评论、自定义音源（userApi）、本地 OpenAPI（HTTP+SSE）、内置下载器、自动更新、
`lxmusic://` deeplink 协议、换源/音质切换逻辑与相关设置项。

## 技术栈（据 `package.json`）

| 关注点 | 技术 | 说明 |
| --- | --- | --- |
| 运行时 | Electron `40.9.2` | 多窗口桌面应用 |
| UI | Vue `~3.3.13` + Vue Router `~4.5.1` | 两个 Vue 应用：主窗口 + 桌面歌词窗口 |
| 语言 | TypeScript `5.9.3`（`allowJs: true`） | 无遗留 provider JS；少量 `.js` 工具/composable |
| 数据库 | `better-sqlite3` `^13` | 跑在 Node worker 线程，经 Comlink 暴露 |
| HTTP | `undici` `^7` | 主进程侧通用请求（代理/重试），当前仅同步与后续联网功能使用 |
| 音频 | HTMLAudioElement + Web Audio API | EQ/卷积/analyser/变速变调 |
| 构建 | Webpack `^5` | 三个 bundle：main / renderer / renderer-lyric |
| 打包 | `electron-builder` `^26` | Windows 优先，Linux/macOS 次要 |
| 状态 | Vue reactivity（无 Pinia/Vuex） | `src/renderer/store/` |
| i18n | 自研插件 | `src/lang/{zh-cn,zh-tw,en-us,ko-kr}.json` |
| Node | `>= 22`，npm `>= 8.5.2` | `postinstall` 重建原生依赖 |

依赖清单（`dependencies`）：`@simonwep/pickr`、`better-sqlite3`、`bufferutil`、`comlink`、
`electron-log`、`font-list`、`iconv-lite`、`jschardet`、`message2call`、`music-metadata`、
`undici`、`utf-8-validate`、`vue`、`vue-router`、`ws`。

## 入口

| 进程 | 入口 | 作用 |
| --- | --- | --- |
| Main | `src/main/index.ts` | 启动 Electron、注册模块、单实例、DB worker |
| Main 全局初始化 | `src/main/app.ts` | `global.lx`、数据目录、主题、代理、设置初始化 |
| Renderer（主窗口） | `src/renderer/main.ts` | 挂载 `App.vue` |
| Renderer（桌面歌词） | `src/renderer-lyric/main.ts` | 独立的歌词窗口 Vue 应用 |
| Worker（DB） | `src/main/worker/index.ts` | `better-sqlite3` + Comlink |
| 打包产物入口 | `dist/main.js` | `package.json` 的 `main` |

## 目录总览

```
src/
├─ main/                 # 主进程（Node）
│  ├─ index.ts app.ts
│  ├─ modules/           # winMain winLyric commonRenderers hotKey tray(appMenu) sync
│  ├─ worker/            # DB worker（better-sqlite3 + Comlink）
│  ├─ event/             # 主进程事件总线（app/list/dislike）
│  ├─ types/ utils/
├─ renderer/             # 主窗口（Vue 3）
│  ├─ main.ts App.vue router.ts
│  ├─ core/              # player / music / useApp / lyric / dislikeList / globalData
│  ├─ store/             # player, list, dislikeList, setting, soundEffect, index
│  ├─ views/             # List, Setting
│  ├─ components/        # layout（Aside/Toolbar/PlayBar/PlayDetail）、base、common、material
│  ├─ worker/            # 渲染进程 Web Worker（仅 main）
├─ renderer-lyric/       # 桌面歌词窗口（独立 Vue 应用）
├─ common/               # main 与 renderer 共享：ipcNames、types（LX.* 全局命名空间）、utils、theme
├─ lang/                 # i18n 文案
└─ static/               # 打包时复制到 dist 的静态资源
build-config/            # webpack 配置 + electron-builder 打包脚本（无 renderer-scripts）
doc/                     # 设计文档（含 music-file-sync 设计）
tests/                   # 本地音乐文件同步的纯逻辑测试（node 直接跑）
```

## 功能 → 位置

- **本地库与播放**：`src/renderer/views/List/`、`src/renderer/core/player/`、`src/renderer/plugins/player/`
- **本地文件解析**（元数据/封面/歌词）：`src/renderer/worker/main/`（Web Worker）、`src/renderer/utils/music.ts`
- **URL/封面/歌词分发**：`src/renderer/core/music/{index,local,utils}.ts`
- **列表持久化**：`src/renderer/store/list/` + DB worker 的 `list` 模块（`my_list` / `my_list_music_info`）
- **桌面歌词**：`src/main/modules/winLyric/` + `src/renderer-lyric/`
- **设置**：`src/renderer/views/Setting/`（无音源/搜索/下载/OpenAPI/更新分区）
- **跨端同步**：`src/main/modules/sync/` + `src/renderer/views/Setting/components/SettingSync/`
- **主题**：`src/common/theme/`、`src/renderer/views/Setting/components/ThemeEditModal/`
- **快捷键/托盘**：`src/main/modules/hotKey/`、`src/main/modules/tray.ts`

## 平台与打包

- Windows 优先：setup / portable / 7z「绿色版」、`win7` legacy 变体，arch `x64/x86/x86_64/arm64`
- Linux：`appImage deb rpm pacman`；macOS：`dmg`（x64 / arm64）
- Portable：Windows 下若 exe 旁存在 `portable` 目录，用户数据写入该目录（`setUserDataPath`）
- 用户数据目录：`<userData>/LxDatas`（`global.lxDataPath`），SQLite 文件 `lx.data.db`（WAL）

## 相关项目

- 移动端：`../lx-music-mobile`（同一 fork 思路的纯本地播放器，通过 musicFile 同步配对）
- 上游：`https://github.com/lyswhut/lx-music-desktop`（作者 `lyswhut`，Apache-2.0）

## 给 agent 的硬规则

- **不要重新引入在线音源/下载/用户脚本**：精简是刻意的目标；需要联网能力时，只做「歌词/封面匹配」
  这类独立小模块，复用 `common/utils/request.ts` 与现有歌词存储。
- 改动前先读 `RISKS.md`；DB 结构、同步协议、原生依赖是最容易出事的区域。
- 交付前必须 `npm run lint` + `npm run build`（构建内置 ESLint，会失败即报错）。
- 不在源码里猜测未验证的行为；不确定就标注 `[待确认]`，或去读实现再写。
