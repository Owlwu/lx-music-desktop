# 桌面端代码签名

Electron 打包脚本支持 Windows Authenticode 和 macOS 代码签名。多台构建机需要为同一平台复用签名身份时，可以迁移已有证书。正式分发时，macOS 使用 Apple Developer ID 并公证，Windows 使用 Windows 支持的代码签名证书。自签名证书适合内部使用，安装和启动仍受目标电脑的信任策略以及 Gatekeeper、SmartScreen 等机制影响。

## 本地签名材料

`signing.env.example` 是可提交的模板。实际的 `signing.env` 含证书密码，`.p12` 或 `.pfx` 可能包含私钥。Git 和 Electron 打包均排除此目录中的本地签名材料。迁移私钥和密码时使用可信渠道。

- `create-shared-cert.sh` 在 macOS 上生成内部开发用的自签名证书、本地配置和公钥证书。已有证书时复用，`--force` 会生成新的签名身份。
- `import-mac-signing.sh` 在 Mac 上导入已有证书，默认尝试设置当前用户的代码签名信任。可用 `--no-trust` 仅导入。
- `windows/import-win-signing.ps1` 在 Windows 上验证证书并写入本地打包配置。`windows/import-signing.cmd` 是执行同一脚本的快捷入口。

## macOS

在已有身份的构建机上，通过「钥匙串访问」选中要迁移的具体身份并导出 PKCS#12。将证书移至目标 Mac 后，用下面的命令导入自签名证书：

```bash
./build-config/signing/import-mac-signing.sh --p12 /path/to/signing.p12 --password-file /path/to/password-file
```

如已复制 `signing.env` 和默认文件名 `lxmusic-codesign.p12` 到签名目录，可以直接运行导入脚本。使用 Apple Developer ID 时，在钥匙串访问中导入，或给脚本传入 `--no-trust`。

如果需要新的内部开发证书，可以执行 `./build-config/signing/create-shared-cert.sh`。导入时 macOS 可能要求授权。执行 `security find-identity -v -p codesigning` 确认身份可用，再打包：

```bash
npm run pack:mac:dmg:arm64
codesign --verify --deep --strict build/mac-arm64/lx-music-desktop.app
```

`MAC_SIGN_IDENTITY` 指定钥匙串中的证书名称。Apple 证书填写去掉 `Developer ID Application: ` 前缀后的名称。`MAC_NOTARIZE=1` 允许 electron-builder 使用已配置的 Apple 凭据公证。

## Windows

在项目根目录执行：

```powershell
.\build-config\signing\windows\import-signing.cmd -PfxPath C:\path\to\signing.pfx
npm run pack:win:setup:x64
Get-AuthenticodeSignature .\build\win-unpacked\lx-music-desktop.exe
```

导入脚本可从已有 `signing.env` 读取密码，也支持 `-PasswordFile`，否则会提示输入。`-ImportCert` 将身份导入当前用户的个人证书库。`-TrustRoot` 仅用于经确认的内部自签名证书，会修改本机根证书库并需要管理员权限。使用 `-Exe` 可查看指定程序的签名并比较证书指纹。

## 配置优先级

Windows 本地签名配置从 `signing.env` 读取 `CSC_LINK`，相对路径以项目根目录为准。设置 `WIN_CSC_LINK` 或 `CSC_LINK` 环境变量时，electron-builder 使用原生签名配置。密码可用 `WIN_CSC_KEY_PASSWORD` 或 `CSC_KEY_PASSWORD` 环境变量覆盖。macOS 优先读取 `MAC_SIGN_IDENTITY` 和 `MAC_NOTARIZE` 环境变量。未提供本地签名配置时，electron-builder 沿用其默认行为。
