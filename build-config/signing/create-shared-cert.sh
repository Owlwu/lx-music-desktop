#!/usr/bin/env bash
#
# 生成一份 macOS / Windows 共用的自签名代码签名证书，并导出为 .p12。
#
# 团队内部分发时可复用这份证书，使同一平台各版本的签名身份一致。
#
# 用法：
#   ./create-shared-cert.sh                      # 默认：CN = "LX Music Dev Signing"，随机密码
#   ./create-shared-cert.sh --cn "My Team"       # 自定义证书名（两台机器必须一致）
#   ./create-shared-cert.sh --force              # 已有证书时重新生成
#   ./create-shared-cert.sh --no-import          # 只导出 .p12，不导入钥匙串
#
# 产物（都在 build-config/signing/ 下，已被 .gitignore 忽略）：
#   lxmusic-codesign.p12        证书 + 私钥（复制到 Windows 使用）
#   lxmusic-codesign.cert.pem   公钥证书（Windows 信任根证书时用）
#   signing.env                 构建用的环境变量（含密码，勿提交）
#
# 注意：自签名证书只适合本地/团队内部分发，无法通过 Gatekeeper 公证，
# 正式对外发布请改用 Apple Developer ID + Windows 商业代码签名证书。

set -euo pipefail

SIGNING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SIGNING_DIR/../.." && pwd)"
DEFAULT_CERT_NAME="lxmusic-codesign.p12"

CN="LX Music Dev Signing"
DAYS=3650
OUT=""
PASS=""
IMPORT=1
TRUST=1
FORCE=0
KEYCHAIN="${KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log() { printf '\033[1;34m[signing]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[signing]\033[0m %s\n' "$*" >&2; }

die() {
  printf '\033[1;31m[signing]\033[0m %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cn) CN="${2:?--cn 需要一个值}"; shift 2 ;;
    --days) DAYS="${2:?--days 需要一个值}"; shift 2 ;;
    --out) OUT="${2:?--out 需要一个值}"; shift 2 ;;
    --password) PASS="${2:?--password 需要一个值}"; shift 2 ;;
    --password-file) PASS="$(tr -d '\r\n' < "${2:?--password-file 需要一个文件}")"; shift 2 ;;
    --keychain) KEYCHAIN="${2:?--keychain 需要一个值}"; shift 2 ;;
    --no-import) IMPORT=0; shift ;;
    --no-trust) TRUST=0; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "此脚本只能在 macOS 上运行"

OUT="${OUT:-$SIGNING_DIR/$DEFAULT_CERT_NAME}"

# 优先用 Homebrew 的 OpenSSL 3（支持 -legacy 导出旧式 PKCS#12），
# 系统自带的是 LibreSSL，两者都能用，但兼容写法不同。
OPENSSL=""
for candidate in /opt/homebrew/bin/openssl /usr/local/opt/openssl@3/bin/openssl "$(command -v openssl || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then OPENSSL="$candidate"; break; fi
done
[[ -n "$OPENSSL" ]] || die "找不到 openssl"
log "使用 openssl：${OPENSSL}（$("$OPENSSL" version)）"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lxmusic-signing.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

# 导出 p12。macOS 钥匙串与 Windows 旧版 signtool 对现代 PBE（AES-256 + SHA256）
# 支持不一致，优先导出兼容性最好的旧式加密格式：
#   3DES + SHA1 —— macOS 钥匙串、Windows signtool、OpenSSL 3 默认 provider 都能读写
export_p12() {
  local key="$1" cert="$2" out="$3" pass="$4" name="$5"
  local base=("$OPENSSL" pkcs12 -export -inkey "$key" -in "$cert" -name "$name" -out "$out" -passout "pass:$pass")
  local help
  help="$("$OPENSSL" pkcs12 -help 2>&1 || true)"
  "${base[@]}" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 >/dev/null 2>&1 && return 0
  if [[ "$help" == *-legacy* ]]; then
    "${base[@]}" -legacy >/dev/null 2>&1 && return 0
  fi
  "${base[@]}" -descert >/dev/null 2>&1 && return 0
  return 1
}

CERT_PEM="$TMP_DIR/cert.pem"
KEY_PEM="$TMP_DIR/key.pem"

if [[ -f "$OUT" && $FORCE -eq 0 ]]; then
  log "已存在 ${OUT}，跳过生成（重新生成请加 --force）"
  if [[ -z "$PASS" && -f "$SIGNING_DIR/signing.env" ]]; then
    PASS="$(sed -n 's/^CSC_KEY_PASSWORD=//p' "$SIGNING_DIR/signing.env" | head -1)"
  fi
  [[ -n "$PASS" ]] || die "无法从 signing.env 读取已有证书密码，请用 --password 指定，或加 --force 重新生成"
  "$OPENSSL" pkcs12 -in "$OUT" -clcerts -nokeys -passin "pass:$PASS" -out "$CERT_PEM" 2>/dev/null \
    || die "读取已有 p12 失败（密码不对？）"
  DETECTED_CN="$("$OPENSSL" x509 -in "$CERT_PEM" -noout -subject -nameopt multiline 2>/dev/null | sed -n 's/^ *commonName *= //p')"
  [[ -n "$DETECTED_CN" ]] && CN="$DETECTED_CN"
else
  [[ -n "$PASS" ]] || PASS="$("$OPENSSL" rand -hex 18)"

  cat > "$TMP_DIR/ext.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
string_mask = utf8only

[dn]
CN = $CN
O = LX Music
C = CN

[v3]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyCertSign
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

  log "生成自签名代码签名证书：CN=${CN}，有效期 ${DAYS} 天"
  "$OPENSSL" req -x509 -newkey rsa:3072 -sha256 -nodes -days "$DAYS" \
    -keyout "$KEY_PEM" -out "$CERT_PEM" -config "$TMP_DIR/ext.cnf" >/dev/null 2>&1 \
    || die "生成证书失败"

  export_p12 "$KEY_PEM" "$CERT_PEM" "$OUT" "$PASS" "$CN" \
    || die "导出 p12 失败（尝试的旧式加密格式都不被 OpenSSL 支持）"
  chmod 600 "$OUT"
fi

# 公钥证书（Windows 侧信任根证书、排查问题时用）
cp "$CERT_PEM" "$SIGNING_DIR/lxmusic-codesign.cert.pem"
chmod 644 "$SIGNING_DIR/lxmusic-codesign.cert.pem"

SHA1="$("$OPENSSL" x509 -in "$CERT_PEM" -noout -fingerprint -sha1 | sed 's/^.*=//')"

# 导入本机钥匙串，让 codesign / electron-builder 能找到该身份
if [[ $IMPORT -eq 1 ]]; then
  if security find-identity -p codesigning "$KEYCHAIN" | grep -F "${SHA1//:/}" >/dev/null; then
    log "钥匙串中已存在身份：$CN"
  else
    if security import "$OUT" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign -T /usr/bin/security; then
      log "已导入钥匙串：$KEYCHAIN"
    else
      warn "导入钥匙串失败。请手动执行：security import \"$OUT\" -k \"$KEYCHAIN\" -P '***' -T /usr/bin/codesign"
      warn "（build 之前必须完成这一步，否则 macOS 产物不会签名）"
    fi
  fi

  # 仅设置代码签名信任，使 security find-identity 能找到此身份。
  if [[ $TRUST -eq 1 ]]; then
    if security add-trusted-cert -p codeSign -r trustRoot -k "$KEYCHAIN" "$CERT_PEM" >/dev/null 2>&1; then
      log "已把证书加入当前用户的信任设置（TrustRoot）"
    else
      warn "设置信任失败（可能需要在有图形界面的终端里重试）："
      warn "  security add-trusted-cert -p codeSign -r trustRoot -k \"$KEYCHAIN\" \"$SIGNING_DIR/lxmusic-codesign.cert.pem\""
      warn "或打开「钥匙串访问」→ 找到证书 → 显示简介 → 信任 → 始终信任"
    fi
  fi
fi

NOT_AFTER="$("$OPENSSL" x509 -in "$CERT_PEM" -noout -enddate | sed 's/^notAfter=//')"

case "$OUT" in
  "$PROJECT_ROOT"/*) REL_OUT="./${OUT#"$PROJECT_ROOT"/}" ;;
  *) REL_OUT="$OUT" ;;
esac

cat > "$SIGNING_DIR/signing.env" <<EOF
# 由 create-shared-cert.sh 自动生成 —— 含证书私钥密码，请勿提交 / 外传
CSC_LINK=$REL_OUT
CSC_KEY_PASSWORD=$PASS
MAC_SIGN_IDENTITY=$CN
MAC_NOTARIZE=0
EOF
chmod 600 "$SIGNING_DIR/signing.env"

log "完成"
log "  证书：$OUT"
log "  CN：$CN"
log "  SHA1：$SHA1"
log "  有效期至：$NOT_AFTER"
echo
log "接下来在 Windows 电脑上（把 lxmusic-codesign.p12 拷过去）："
echo "  cd <项目目录>"
echo '  powershell -ExecutionPolicy Bypass -File .\build-config\signing\windows\import-win-signing.ps1 -PfxPath .\build-config\signing\lxmusic-codesign.p12'
echo
log "或在第二台 Mac 上："
echo "  ./build-config/signing/import-mac-signing.sh --password-file /path/to/password-file"
