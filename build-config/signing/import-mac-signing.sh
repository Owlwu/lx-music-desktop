#!/usr/bin/env bash
#
# 在 Mac 上导入共享的代码签名证书（.p12），并设置代码签名信任。
#
# 在多台 Mac 上复用同一份证书，以保持同一应用各版本的签名身份。
#
# 用法：
#   ./import-mac-signing.sh --password '<密码>'            # 导入 + 信任
#   ./import-mac-signing.sh                                # 密码从 signing.env 读取
#   ./import-mac-signing.sh --no-trust                     # 只导入，不改信任设置
#   ./import-mac-signing.sh --p12 ./some/other.p12 --password 'xxx'
#
# 如果之后出现「codesign 每次都要求输入密钥串密码」，执行：
#   security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k '<登录密码>' login.keychain-db

set -euo pipefail

SIGNING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

P12="$SIGNING_DIR/lxmusic-codesign.p12"
PASS=""
TRUST=1
KEYCHAIN="${KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"
PARTITION=0

log() { printf '\033[1;34m[signing]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[signing]\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31m[signing]\033[0m %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --p12) P12="${2:?}"; shift 2 ;;
    --password) PASS="${2:?}"; shift 2 ;;
    --password-file) PASS="$(tr -d '\r\n' < "${2:?}")"; shift 2 ;;
    --keychain) KEYCHAIN="${2:?}"; shift 2 ;;
    --no-trust) TRUST=0; shift ;;
    --set-key-partition) PARTITION=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "此脚本只能在 macOS 上运行"
[[ -f "$P12" ]] || die "找不到证书文件：${P12}（先从另一台电脑拷贝过来）"

OPENSSL="$(command -v openssl || true)"
[[ -n "$OPENSSL" ]] || die "找不到 openssl"

if [[ -z "$PASS" && -f "$SIGNING_DIR/signing.env" ]]; then
  PASS="$(sed -n 's/^CSC_KEY_PASSWORD=//p' "$SIGNING_DIR/signing.env" | head -1)"
fi
[[ -n "$PASS" ]] || die "缺少证书密码：请用 --password 指定，或把 signing.env 一起拷贝过来"

CERT_PEM="$(mktemp "${TMPDIR:-/tmp}/lxmusic-cn.XXXXXX.pem")"
trap 'rm -f "$CERT_PEM"' EXIT
"$OPENSSL" pkcs12 -in "$P12" -clcerts -nokeys -passin "pass:$PASS" -out "$CERT_PEM" 2>/dev/null \
  || die "读取证书失败：密码不对，或 p12 格式不受支持"
CN="$("$OPENSSL" x509 -in "$CERT_PEM" -noout -subject -nameopt multiline 2>/dev/null | sed -n 's/^ *commonName *= //p')"
[[ -n "$CN" ]] || die "读取证书失败：密码不对，或 p12 格式不受支持"
log "证书 CN：$CN"
FINGERPRINT="$("$OPENSSL" x509 -in "$CERT_PEM" -noout -fingerprint -sha1 | sed 's/^.*=//; s/://g')"

if security find-identity -p codesigning "$KEYCHAIN" | grep -F "$FINGERPRINT" >/dev/null; then
  log "钥匙串中已存在身份：$CN（跳过导入）"
else
  if ! security import "$P12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign -T /usr/bin/security; then
    die "导入钥匙串失败（钥匙串是否已解锁？）"
  fi
  log "已导入钥匙串：$KEYCHAIN"
fi

if [[ $PARTITION -eq 1 ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "当前用户的登录密码（用于允许 codesign 访问私钥，回车跳过）: " KC_PASS
    echo
    if [[ -n "${KC_PASS:-}" ]]; then
      security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KEYCHAIN" >/dev/null \
        && log "已设置 key partition（codesign 不再弹窗）" \
        || warn "设置 key partition 失败"
    fi
    unset KC_PASS
  else
    warn "非交互式终端，跳过 key partition；首次签名可能弹出钥匙串授权，点「始终允许」即可"
  fi
fi

if [[ $TRUST -eq 1 ]]; then
  if security add-trusted-cert -p codeSign -r trustRoot -k "$KEYCHAIN" "$CERT_PEM" >/dev/null 2>&1; then
    log "已为当前用户设置代码签名信任"
  else
    warn "设置信任失败，可在钥匙串访问中为 $CN 设置代码签名信任"
  fi
fi

log "校验："
if security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "$FINGERPRINT"; then
  log "完成：本机可以用该证书给 macOS 产物签名了"
else
  warn "security find-identity -v 里仍找不到 $CN"
  warn "常见原因：证书没有被信任（钥匙串访问 → 证书 → 始终信任），或该 p12 只有公钥没有私钥"
  exit 1
fi
