'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const ENV_FILE = path.join(__dirname, 'signing.env')

/** 解析 KEY=VALUE 格式的 env 文件（支持 # 注释、单双引号、值中含 =） */
function parseEnv(content) {
  const result = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    if (key) result[key] = value
  }
  return result
}

function readEnvFile() {
  try {
    return parseEnv(fs.readFileSync(ENV_FILE, 'utf8'))
  } catch (error) {
    if (error.code != 'ENOENT') throw error
    return {}
  }
}

function resolveCertificatePath(value) {
  const normalized = process.platform == 'win32' ? value : value.replace(/\\/g, '/')
  if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
    return path.resolve(os.homedir(), normalized.slice(2))
  }
  return path.resolve(PROJECT_ROOT, normalized)
}

function loadSigningConfig() {
  const fileEnv = readEnvFile()
  const macIdentity = (process.env.MAC_SIGN_IDENTITY ?? fileEnv.MAC_SIGN_IDENTITY ?? '').trim()
  // 显式设置的 CSC_LINK 交由 electron-builder 处理，也支持 Base64 等输入。
  const localWindowsCert = process.env.WIN_CSC_LINK == null && process.env.CSC_LINK == null
    ? fileEnv.CSC_LINK
    : null

  return {
    win: localWindowsCert
      ? {
          certificateFile: resolveCertificatePath(localWindowsCert),
          certificatePassword: process.env.CSC_KEY_PASSWORD ?? fileEnv.CSC_KEY_PASSWORD ?? '',
        }
      : null,
    mac: macIdentity
      ? {
          identity: macIdentity,
          notarize: (process.env.MAC_NOTARIZE ?? fileEnv.MAC_NOTARIZE) == '1',
        }
      : null,
  }
}

module.exports = { loadSigningConfig }
