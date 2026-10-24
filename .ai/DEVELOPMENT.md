# DEVELOPMENT.md — 安装、运行、构建、打包

> 本地构建所需的一切。命令来自 `package.json`（版本 `2.12.6`）。
> **Node `>= 22`、npm `>= 8.5.2`（硬性 `engines`）。**

## 环境

- **Node.js `>= 22`**；`postinstall` 会跑 `electron-builder install-app-deps`，为当前 Electron ABI
  重建原生依赖（`better-sqlite3`、`bufferutil`、`utf-8-validate`），需要可用的 C++ 工具链或预编译缓存。
- GitHub fork 依赖（`eslint-formatter-friendly`、`spinnies`、`webpack-hot-middleware` 等）在
  `package.json` 里按 commit 锁定，安装时需要 GitHub 访问。
- renderer 的 browserslist 目标为 Electron 22.3.0（转译目标），运行时是 Electron 40.9.2。
- **开发/CI 环境若注入 `ELECTRON_RUN_AS_NODE=1`，Electron 会以纯 Node 运行并抛
  `Not running in an Electron environment!`。** `build-config/runner-dev.js` 已在启动子进程前
  显式移除该变量；如果你自己写脚本启动 `dist/main.js`，请同样处理。

## 安装

```
npm install      # 安装依赖并执行 postinstall（原生依赖重建）
```

## 开发

```
npm run dev
```
- `build-config/runner-dev.js` 并行起 **三个** webpack 构建，然后启动 Electron：
  - `main` — `target: electron-main`，watch；主进程改动会重启 Electron（inspector `--inspect=5858`）
  - `renderer` — `webpack-dev-server` **9080** 端口 + HMR（`src/renderer/main.ts`）
  - `renderer-lyric` — `webpack-dev-server` **9081** 端口（桌面歌词窗口）
- 会调用 `replaceLib`（`build-before-pack.js`）接好原生库
- 端口 9080/9081 需空闲

> 没有 `renderer-scripts` 目标（userApi 默认脚本已随功能删除）。

## 构建（只出 bundle，不打安装包）

```
npm run build               # = node build-config/pack.js，三个 bundle 输出到 dist/
npm run build:main          # 仅主进程
npm run build:renderer      # 仅主窗口
npm run build:renderer-lyric
```
`npm run build` 是 `pack:*` / `publish:*` 的前置步骤。

## 打包

`build-config/build-pack.js` 从 argv 读取 `target= arch= type= [publish=]` 并调用 electron-builder。

```
npm run pack                    # win x64 setup（含 build）
npm run pack:win                # win 全部：setup x86_64/x64/x86/arm64 + 7z
npm run pack:win:portable       # portable
npm run pack:linux              # deb(amd64/arm64/armv7l) + appImage + rpm + pacman
npm run pack:mac                # dmg x64 + arm64
npm run pack:dir                # 未打包目录
```
`publish:*` 变体加 `publish=always`（上传 release）；`win7_*` 为旧版 Windows 构建。

## Lint

```
npm run lint        # eslint (ts/js/vue)，friendly formatter，扫描 src/
npm run lint:fix    # 自动修复
```
**每个 webpack 构建内也跑 ESLint（`eslint-webpack-plugin`）**，lint 错误会让 `npm run build` 失败。

## 其他脚本
- `npm run build:theme` — `node src/common/theme/createThemes.js` 重新生成主题
- `npm run dp` / `npm run up` — 走 `127.0.0.1:2081` 代理安装/打包
- `npm run publish` — 发布流程（`node publish`）

## Bundle 与产物（webpack）

| 目标 | 入口 | 产物 | 配置 |
| --- | --- | --- | --- |
| main | `src/main/index.ts` | `dist/main.js` | `build-config/main/webpack.config.{base,dev,prod}.js` |
| renderer | `src/renderer/main.ts` | `dist/renderer.js`、`dist/index.html` | `build-config/renderer/...` |
| renderer-lyric | `src/renderer-lyric/main.ts` | `dist/renderer-lyric.js`、`dist/lyric.html` | `build-config/renderer-lyric/...` |

`main` 用 `target: electron-main` + `commonjs2`；renderer 用 `electron-renderer`，配
`vue-loader`、`pug-plain-loader`、`less-loader`、`svg-sprite-loader`（`src/renderer/assets/svgs`）、
`postcss-pxtorem`（rem 自适应，见 `css-loader.config.js`）。

## 路径别名（webpack `resolve.alias` 为准）

| 别名 | 指向 |
| --- | --- |
| `@root` | `src/` |
| `@main` | `src/main/` |
| `@renderer` | `src/renderer/` |
| `@lyric` | `src/renderer-lyric/` |
| `@common` | `src/common/` |
| `@static` | `src/static/`（仅 renderer/lyric bundle） |

tsconfig 的 `paths` 是注释状态，**构建以 webpack 别名为准**。

## TypeScript

- `tsconfig.json` 继承 `@tsconfig/recommended`；`allowJs: true`（少量 `.js` 工具/composable）
- 全局 `LX` 命名空间在 `src/common/types/*.d.ts`（ambient，无需 import）
- **没有独立的 typecheck 脚本**：类型错误由 `ts-loader` 在 webpack 构建中暴露

## Lint 配置

根 `.eslintrc.cjs` 继承 `.eslintrc.base.cjs`（`standard` / `standard-with-typescript` /
`plugin:vue/vue3-recommended` + `vue-pug`）；`main/`、`renderer/`、`renderer-lyric/`、`common/`、`lang/`
各有 overrides。关键规则：禁 `var`、关闭 camelcase、2 空格、`comma-dangle: always-multiline`、
函数括号前不留空格。

## 测试

**没有测试框架**，唯一的自动化门禁是 ESLint + 构建。

例外——本地音乐文件同步的纯逻辑（`src/main/modules/sync/musicFile/diff.ts`）刻意零依赖，
Node `>= 22` 可直接剥离 TS 类型运行：

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/music-file-sync.test.ts   # diff/plan 规则
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/music-file-fs.test.ts     # 扫描/分块传输/删除（真实临时目录）
```

`tests/music-file-fs.test.ts` 还会断言移动端
`lx-music-mobile/src/plugins/sync/client/modules/musicFile/diff.ts` 与桌面端逐字节一致——
改规则必须两边同步。设计契约见 `doc/music-file-sync/本地音乐文件同步-设计.md`。