# RISKS.md — 会咬人的地方

> 脆弱点、外部依赖、验证缺口的实用提醒。不是 bug 列表，是「注意什么」。

## 原生 / 构建期依赖
- `better-sqlite3`、`bufferutil`、`utf-8-validate` 是原生模块，必须按当前 Electron ABI 编译。
  `postinstall` 跑 `electron-builder install-app-deps`；缺少工具链/预编译缓存或 Electron/Node 版本
  不匹配会直接让 `npm install` / `npm run dev` 失败。
- **Node `>= 22` 是硬要求**（`undici ^7` 亦要求）。
- **`ELECTRON_RUN_AS_NODE` 环境变量**：某些编辑器终端/CI/沙箱会注入 `=1`，导致 Electron 以纯 Node
  运行并抛 `Not running in an Electron environment!`。`runner-dev.js` 已处理；其它启动脚本需自行清理。

## Fork 依赖（按 commit 锁定）
`eslint-formatter-friendly`、`spinnies`、`webpack-hot-middleware` 等来自 GitHub，安装需网络访问；
上游 commit 被替换会导致行为变化。升级要连同锁定 commit 一起改。

## 精简后的残留数据（最容易被忽略）
- **旧列表里的在线条目无法播放**：历史数据可能残留 `source != 'local'` 的歌曲。本地播放会抛
  「本地文件不存在」。若要彻底干净，需要一次性清洗（只保留 `source === 'local'` 的条目，先备份 DB）。
- **历史表已在 DB v3 迁移中删除**：`music_url` / `music_info_other_source` / `download_list`
  由 `migrateV2` 直接 `DROP TABLE IF EXISTS`。再改表结构时三处要一起改：
  `tables.ts`（建表）+ `verifyDB.ts`（结构校验）+ `migrate.ts`（旧库迁移）；漏改会让 `verifyDB`
  返回 `null`，主进程备份并重建整库（用户数据清空）。
- **旧版遗留文件**：`<lxDataPath>/user_api.json` 会在启动时自动删除。
- **已删除的设置键**：`common.apiSource`、`common.sourceNameType`、`common.tryAutoUpdate`、
  `common.showChangeLog`、`player.playQuality`、`download.*`、`search.*`、`openAPI.*`、`odc.*`
  已从 `defaultSetting`/`app_setting.d.ts` 移除。老配置文件里这些键会被忽略；**不要再读写它们**
  （读出来是 `undefined`，`formatMusicName(undefined, ...)` 之类会崩）。
- `LX.Download` / `LX.Quality` / `LX.Music.MusicInfoOnline` 等类型已全部移除；
  `LX.Music.MusicInfo` 就是本地歌曲，`source` 只能是 `'local'`。

## 本地歌曲的路径脆弱性
- 本地歌曲的 `id` 与 `meta.filePath` **都是绝对路径**。文件移动/改名/换盘后：列表项还在，但播放失败。
- 目前没有「库扫描/路径修复」实现；如需实现，复用 `main/modules/sync/musicFile/localFs.ts`
  的 `scanEntries`/`scanIndex/scanFolderTree` 与 `diff.ts` 的纯逻辑（或内容签名）来重定位。
- 同一首歌重复导入会产生重复项（列表提供查重/去重工具，但不会自动合并）。

## 跨端同步 — 已知取舍
- 内容一致性用 **size + 内容签名**（首/尾各 4 KiB 的 `fnv1a32 + djb2_32`），因为跨设备 mtime 必然不同；
  签名只覆盖首尾，中间差异可能漏判；任一端缺 `sig` 会退回「仅比大小」。
- 同名 `.lrc` 不作为独立同步项，随音频文件一起搬运；只改 `.lrc` 内容不会被识别为变更。
- 冲突默认方向为 `pull`（用对端覆盖），UI 提供「全部用本地/对端覆盖」批量按钮。
- 无断点续传：中途取消会留下半截文件，下次同步表现为冲突。
- baseline 存在**发起同步的那一侧**（`<lxDataPath>/sync/musicFile/baseline.json`）。
- 本机作为 **server** 且多客户端连接时，驱动只选第一个就绪且支持该特性的客户端。
- `diff.ts` 与 `lx-music-mobile` 逐字节镜像，`tests/music-file-fs.test.ts` 会断言一致性。

## 验证缺口
- **没有测试框架、没有 `npm test`、没有 typecheck 脚本**。门禁只有 ESLint（构建内）与 webpack 构建。
- 行为验证靠 `npm run dev` 手动走查。你是事实上的测试者。
- 例外：`tests/music-file-*.test.ts`（纯逻辑，node 直接跑）。

## IDE 与构建不一致
- `tsconfig.json` 的 `paths` 被注释，**webpack 别名才是权威**。IDE 里 `@main/@renderer/...` 可能报红，
  构建却正常——以构建为准。

## 架构耦合 / 易混淆点
- **两套 worker**：主进程 `global.lx.worker.dbService`（SQLite / `worker_threads`）与渲染进程
  `window.lx.worker.main`（Web Worker，本地文件解析）。改一个不影响另一个；渲染进程只能经 IPC 触达 DB。
- **两套事件总线**：`window.app_event`（渲染）与 `global.lx.event_app`（主）。跨进程只能 IPC。
- **没有状态库**：状态是散落的 `ref/reactive`，没有统一「真相源」；跟随既有 `store/<domain>` 模式。
- 渲染进程有 Node 能力（`nodeIntegration: true`、`nodeIntegrationInWorker: true`），但业务职责仍应放主进程。

## 安全姿态
- 主进程在 `listenerAppEvent()` 中锁定外链与 `<webview>`（剥离 preload、禁用 nodeIntegration）。
  新增窗口/放宽 `nodeIntegration`/CSP 要非常谨慎。
- userApi 沙箱窗口与 OpenAPI 服务已移除，目前没有运行用户脚本或监听端口的模块。
- 若后续加「在线匹配歌词/封面」：只允许固定目标域名的 GET、限制响应大小、校验内容后再入库；
  不要引入「任意 URL 下载 + 执行」的路径。

## 平台优先级
- **Windows 是主目标**（打包脚本、setup/portable/7z、win7 兼容变体最全）。macOS/Linux 次要。
  OS 相关代码用 `process.platform` 守卫。

## i18n / 文案
- `zh-cn` / `en-us` / `zh-tw`（另有 `ko-kr`）人工同步；只加一个语言会回退到 `zh-cn`。
- 缺失 key 会把 key 本身显示给用户。

## 与上游的关系
- 本仓库已 fork 并精简，`master_up` 仅作对照；**不要按上游行为假设本仓库仍有在线能力**。
- 上游修复不会自动进来；同步/DB/播放相关 bug 需自行判断是否要手工移植（多数上游改动与在线功能相关，可直接跳过）。