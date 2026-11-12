/**
 * 桌面端专辑封面匹配：纯逻辑 + 封面文件规则测试
 *
 * 运行：node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/cover-match.test.ts
 *
 * 与 tests/media-match.test.ts 同一套路：把 TS 源码复制到临时目录，
 * 补齐无扩展名的相对导入后在 node 原生类型擦除下直接运行。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let failed = 0
let passed = 0

const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}\n       actual   = ${a}\n       expected = ${b}`)
  }
}

const checkThrowsCode = async(name: string, fn: () => Promise<unknown>, expectedCode: string) => {
  try {
    await fn()
    failed++
    console.log(`  FAIL ${name} (no throw)`)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === expectedCode) {
      passed++
      console.log(`  ok   ${name}`)
    } else {
      failed++
      console.log(`  FAIL ${name}\n       code = ${code}\n       expected = ${expectedCode}`)
    }
  }
}

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const moduleNames = [
  'common/utils/mediaMatch/normalize.ts',
  'common/utils/coverMatch/score.ts',
  'main/modules/coverMatch/coverFile.ts',
]
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cover-match-'))
for (const relPath of moduleNames) {
  const code = fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
    .replace(/from '@common\/utils\/mediaMatch\/normalize'/g, "from './normalize.ts'")
    .replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
  fs.writeFileSync(path.join(moduleDir, path.basename(relPath)), code, 'utf8')
}

const load = async(name: string) => {
  return import(pathToFileURL(path.join(moduleDir, name + '.ts')).href)
}

const score = await load('score')
const coverFile = await load('coverFile')

const fsPromisesModule = await import('node:fs/promises')
const fsPromises = fsPromisesModule.default

const createWorkDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `lx-cover-match-${name}-`))

// 构造最小合法 JPEG（含 APP0 + SOF0），宽高可指定
const makeJpeg = (width: number, height: number, tag = 0): Buffer => {
  const app0Payload = Buffer.alloc(14)
  app0Payload[0] = tag & 0xff
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), app0Payload])
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])])
}

// 构造最小合法 PNG（签名 + IHDR），宽高可指定
const makePng = (width: number, height: number, tag = 0): Buffer => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8
  ihdr[17] = 6
  ihdr[18] = tag & 0xff
  return Buffer.concat([signature, ihdr])
}

console.log('\n== score ==')
const query = {
  name: 'Song',
  singer: 'Artist',
  albumName: 'Album',
  durationSec: 235,
  fileStem: 'Artist - Song',
  variants: ['Song Artist', 'Song'],
}
const candidate = (overrides: Record<string, unknown> = {}) => ({
  source: 'qq',
  id: 'album-1',
  name: 'Song',
  singer: 'Artist',
  albumName: 'Album',
  durationSec: 235,
  coverUrl: 'https://y.qq.com/music/photo_new/T002R500x500M000album-1.jpg',
  thumbnailUrl: 'https://y.qq.com/music/photo_new/T002R150x150M000album-1.jpg',
  score: 0,
  ...overrides,
})

check('完全一致且专辑相同 = 1（封顶）', score.scoreCoverCandidate(query, candidate()), 1)
check(
  '专辑相同 +0.05',
  score.scoreCoverCandidate(query, candidate({ singer: 'Other' })),
  0.75,
)
check(
  '专辑不同不加分',
  score.scoreCoverCandidate(query, candidate({ singer: 'Other', albumName: 'Different' })),
  0.7,
)
check(
  '专辑包含 +0.05',
  score.scoreCoverCandidate(
    { ...query, albumName: 'Album (Deluxe Edition)' },
    candidate({ singer: 'Other' }),
  ),
  0.75,
)
check(
  '本地专辑为空不加分',
  score.scoreCoverCandidate({ ...query, albumName: '' }, candidate({ singer: 'Other' })),
  0.7,
)
check(
  '候选标题带伴奏标记 → 减半',
  score.scoreCoverCandidate(query, candidate({ name: 'Song (Off Vocal)' })),
  0.4875,
)
check(
  '查询本身带伴奏标记时不扣分',
  score.scoreCoverCandidate(
    { ...query, name: 'Song (Off Vocal)', fileStem: 'Artist - Song (Off Vocal)' },
    candidate({ name: 'Song (Off Vocal)' }),
  ),
  1,
)
check('isInstrumentalQuery 识别文件名标记', score.isInstrumentalQuery({ ...query, fileStem: 'Song (Inst_)' }), true)

const ranked = score.rankCoverCandidates(query, [
  candidate({ id: 'same', name: 'Song (Off Vocal)' }),
  candidate({ id: 'same', name: 'Song' }),
  candidate({ id: 'other', name: 'Different Song', singer: 'Other', albumName: 'Other' }),
])
check('专辑维度去重（source+id）', ranked.length, 2)
check('去重保留分数最高者', ranked[0].id, 'same')
check('去重保留最高分候选的曲名', ranked[0].name, 'Song')
check('按分数降序', ranked[0].score >= ranked[1].score, true)

const crossSource = score.rankCoverCandidates(query, [
  candidate({ source: 'qq', id: 'x' }),
  candidate({ source: 'itunes', id: 'x' }),
])
check('不同源同 id 不去重', crossSource.length, 2)

const many = Array.from({ length: 25 }, (_, i) => candidate({ id: String(i), name: `Song ${i}` }))
check('最多返回 20 条', score.rankCoverCandidates(query, many).length, 20)

console.log('\n== coverFile 图片头解析 ==')
check('JPEG magic + 尺寸', coverFile.parseImageInfo(makeJpeg(500, 500)), { format: 'jpg', width: 500, height: 500 })
check('PNG magic + 尺寸', coverFile.parseImageInfo(makePng(600, 600)), { format: 'png', width: 600, height: 600 })
check('未知格式返回 null', coverFile.parseImageInfo(Buffer.from('not-an-image')), null)
check('PNG 签名长度不足返回 null', coverFile.parseImageInfo(makePng(600, 600).subarray(0, 12)), null)
check(
  'JPEG 截断返回 null',
  coverFile.parseImageInfo(makeJpeg(500, 500).subarray(0, 8)),
  null,
)
check('尺寸下限 200 合法', coverFile.isImageSizeAllowed(200, 200), true)
check('尺寸上限 4000 合法', coverFile.isImageSizeAllowed(4000, 4000), true)
check('宽 199 非法', coverFile.isImageSizeAllowed(199, 500), false)
check('高 4001 非法', coverFile.isImageSizeAllowed(500, 4001), false)
check(
  'validateImageData 拒绝过小图片',
  (() => {
    try {
      coverFile.validateImageData(makeJpeg(199, 500))
      return 'no-throw'
    } catch (err) {
      return (err as { code?: string }).code
    }
  })(),
  'image_invalid',
)
check(
  'validateImageData 拒绝超 8MB 图片',
  (() => {
    const data = Buffer.alloc(coverFile.MAX_IMAGE_BYTES + 1)
    data[0] = 0xff
    data[1] = 0xd8
    data[2] = 0xff
    try {
      coverFile.validateImageData(data)
      return 'no-throw'
    } catch (err) {
      return (err as { code?: string }).code
    }
  })(),
  'image_too_large',
)

console.log('\n== coverFile 文件规则（临时目录） ==')
const workDir = createWorkDir('files')
const audioPath = path.join(workDir, 'Artist - Song.flac')
const audioContent = Buffer.from('fake-audio-content')
fs.writeFileSync(audioPath, audioContent)
const audioHashBefore = fs.readFileSync(audioPath).toString('base64')
const jpgPath = path.join(workDir, 'Artist - Song.jpg')
const pngPath = path.join(workDir, 'Artist - Song.png')
const jpgBackupPath = jpgPath + '.bak'
const pngBackupPath = pngPath + '.bak'

check('音频路径校验通过', await coverFile.isAudioFilePath(audioPath), true)

const firstJpeg = makeJpeg(500, 500, 1)
const firstApply = await coverFile.applyCoverImage(audioPath, firstJpeg)
check('首次写入 JPEG → .jpg', firstApply, {
  imagePath: jpgPath,
  format: 'jpg',
  backupCreated: false,
})
check('首次写入不产生备份', fs.existsSync(jpgBackupPath), false)
check('首次写入内容正确', fs.readFileSync(jpgPath).equals(firstJpeg), true)
check('音频文件内容未变化', fs.readFileSync(audioPath).toString('base64'), audioHashBefore)

fs.writeFileSync(jpgPath, 'original-jpg')
const secondJpeg = makeJpeg(600, 600, 2)
const secondApply = await coverFile.applyCoverImage(audioPath, secondJpeg)
check('已存在 jpg 先备份', secondApply.backupCreated, true)
check('备份保留原始内容', fs.readFileSync(jpgBackupPath, 'utf8'), 'original-jpg')
check('新 jpg 写入成功', fs.readFileSync(jpgPath).equals(secondJpeg), true)

const thirdJpeg = makeJpeg(500, 500, 3)
const thirdApply = await coverFile.applyCoverImage(audioPath, thirdJpeg)
check('已有 .bak 时不再覆盖备份', thirdApply.backupCreated, false)
check('备份内容保持不变', fs.readFileSync(jpgBackupPath, 'utf8'), 'original-jpg')
check('当前 jpg 被覆盖', fs.readFileSync(jpgPath).equals(thirdJpeg), true)

const stateAfterApply = await coverFile.getCoverState(audioPath)
check('状态：图片存在', stateAfterApply.imageExists, true)
check('状态：格式 jpg', stateAfterApply.imageFormat, 'jpg')
check('状态：备份存在', stateAfterApply.backupExists, true)
check('状态：尺寸正确', stateAfterApply.imageSize, thirdJpeg.length)
check('状态：mtime 为数字', typeof stateAfterApply.imageMtime, 'number')

check('回退成功', await coverFile.rollbackCover(audioPath), true)
check('回退恢复原始备份', fs.readFileSync(jpgPath, 'utf8'), 'original-jpg')
check('回退后 .bak 消失', fs.existsSync(jpgBackupPath), false)
check('无备份时回退返回 false', await coverFile.rollbackCover(audioPath), false)

// PNG 覆盖：旧 jpg 必须备份，避免旧 jpg 遮住新 png；回退时删除新 png、恢复 jpg
fs.writeFileSync(jpgPath, 'legacy-jpg')
const pngData = makePng(600, 600, 1)
const pngApply = await coverFile.applyCoverImage(audioPath, pngData)
check('PNG 写入 .png', pngApply, {
  imagePath: pngPath,
  format: 'png',
  backupCreated: true,
})
check('旧 jpg 备份为 jpg.bak', fs.readFileSync(jpgBackupPath, 'utf8'), 'legacy-jpg')
check('旧 jpg 不再可见', fs.existsSync(jpgPath), false)
check('PNG 覆盖不产生 png.bak', fs.existsSync(pngBackupPath), false)
check('新 png 内容正确', fs.readFileSync(pngPath).equals(pngData), true)
const pngState = await coverFile.getCoverState(audioPath)
check('状态：当前可见图为 png', pngState.imageFormat, 'png')
check('状态：备份存在（jpg.bak）', pngState.backupExists, true)
check('PNG 回退成功', await coverFile.rollbackCover(audioPath), true)
check('回退后 png 被删除', fs.existsSync(pngPath), false)
check('回退恢复旧 jpg', fs.readFileSync(jpgPath, 'utf8'), 'legacy-jpg')
check('回退后 jpg.bak 消失', fs.existsSync(jpgBackupPath), false)

// QA Q1 回归：已有 jpg + 已有 jpg.bak 时应用 PNG，旧 jpg 必须被移走，不能遮住新 png
const shadowDir = createWorkDir('jpg-bak-png')
const shadowAudio = path.join(shadowDir, 'Song.mp3')
fs.writeFileSync(shadowAudio, 'audio-shadow')
const shadowJpg = path.join(shadowDir, 'Song.jpg')
const shadowPng = path.join(shadowDir, 'Song.png')
const shadowJpgBak = shadowJpg + '.bak'
const shadowStageTmp = shadowJpg + '.bak.replaced.tmp'
fs.writeFileSync(shadowJpg, 'current-jpg-A')
fs.writeFileSync(shadowJpgBak, 'older-jpg-bak-B')
const shadowPngData = makePng(600, 600, 9)
const shadowApply = await coverFile.applyCoverImage(shadowAudio, shadowPngData)
check('jpg+jpg.bak 已存在时应用 png 成功', shadowApply, {
  imagePath: shadowPng,
  format: 'png',
  backupCreated: false,
})
check('旧 jpg 被移走（仅 png 可见）', fs.existsSync(shadowJpg), false)
check('新 png 内容正确', fs.readFileSync(shadowPng).equals(shadowPngData), true)
check('旧 jpg.bak 保留不动', fs.readFileSync(shadowJpgBak, 'utf8'), 'older-jpg-bak-B')
check('无 .bak.replaced.tmp 残留', fs.existsSync(shadowStageTmp), false)
const shadowState = await coverFile.getCoverState(shadowAudio)
check('状态：可见图为 png（不再被 jpg 遮住）', shadowState.imageFormat, 'png')
check('该场景回退成功', await coverFile.rollbackCover(shadowAudio), true)
check('回退恢复 jpg.bak 内容', fs.readFileSync(shadowJpg, 'utf8'), 'older-jpg-bak-B')
check('回退清理新 png', fs.existsSync(shadowPng), false)
check('回退后 jpg.bak 被删除', fs.existsSync(shadowJpgBak), false)

// 暂存旧 jpg 后写入失败：旧 jpg 必须改回原名，不留暂存文件
const stageFailDir = createWorkDir('stage-fail')
const stageFailAudio = path.join(stageFailDir, 'Song.mp3')
fs.writeFileSync(stageFailAudio, 'audio-stage-fail')
const stageFailJpg = path.join(stageFailDir, 'Song.jpg')
const stageFailJpgBak = stageFailJpg + '.bak'
fs.writeFileSync(stageFailJpg, 'current-jpg-C')
fs.writeFileSync(stageFailJpgBak, 'older-jpg-bak-D')
const originalWriteFileForStage = fsPromises.writeFile
fsPromises.writeFile = async() => {
  const err = new Error('no space left on device') as NodeJS.ErrnoException
  err.code = 'ENOSPC'
  throw err
}
try {
  await checkThrowsCode(
    '暂存旧图后写入失败抛 disk_full',
    async() => await coverFile.applyCoverImage(stageFailAudio, makePng(600, 600, 10)),
    'disk_full',
  )
} finally {
  fsPromises.writeFile = originalWriteFileForStage
}
check('失败后旧 jpg 改回原名', fs.readFileSync(stageFailJpg, 'utf8'), 'current-jpg-C')
check('失败后不残留新 png', fs.existsSync(path.join(stageFailDir, 'Song.png')), false)
check('失败后不残留 png.tmp', fs.existsSync(path.join(stageFailDir, 'Song.png.tmp')), false)
check('失败后不残留 .bak.replaced.tmp', fs.existsSync(stageFailJpg + '.bak.replaced.tmp'), false)
check('失败后旧 jpg.bak 保持不动', fs.readFileSync(stageFailJpgBak, 'utf8'), 'older-jpg-bak-D')

// 写入失败恢复：备份后写临时文件失败（模拟磁盘满），应把备份改回原图
const failureJpg = makeJpeg(500, 500, 7)
fs.writeFileSync(jpgPath, 'keep-me')
const originalWriteFile = fsPromises.writeFile
fsPromises.writeFile = async() => {
  const err = new Error('no space left on device') as NodeJS.ErrnoException
  err.code = 'ENOSPC'
  throw err
}
try {
  await checkThrowsCode('写入失败抛 disk_full', async() => await coverFile.applyCoverImage(audioPath, failureJpg), 'disk_full')
} finally {
  fsPromises.writeFile = originalWriteFile
}
check('失败后原 jpg 恢复', fs.readFileSync(jpgPath, 'utf8'), 'keep-me')
check('失败后不残留备份', fs.existsSync(jpgBackupPath), false)
check('失败后不残留临时文件', fs.existsSync(jpgPath + '.tmp'), false)

// 回退失败安全：rename 失败时当前图与备份都保留，可重试
const rollbackJpg = makeJpeg(600, 600, 8)
await coverFile.applyCoverImage(audioPath, rollbackJpg)
check('回退失败测试前备份存在', fs.existsSync(jpgBackupPath), true)
const currentJpgBeforeRollback = fs.readFileSync(jpgPath).toString('base64')
const originalRename = fsPromises.rename
fsPromises.rename = async() => {
  const err = new Error('operation not permitted') as NodeJS.ErrnoException
  err.code = 'EPERM'
  throw err
}
try {
  await checkThrowsCode('回退 rename 失败抛 no_permission', async() => await coverFile.rollbackCover(audioPath), 'no_permission')
} finally {
  fsPromises.rename = originalRename
}
check('回退失败时当前图未丢', fs.readFileSync(jpgPath).toString('base64'), currentJpgBeforeRollback)
check('回退失败时备份保留', fs.existsSync(jpgBackupPath), true)
check('回退失败不残留 rollback 临时文件', fs.existsSync(jpgPath + '.rollback.tmp'), false)
check('回退可重试并成功', await coverFile.rollbackCover(audioPath), true)
check('回退后恢复原始备份内容', fs.readFileSync(jpgPath, 'utf8'), 'keep-me')

await checkThrowsCode(
  '不存在的音频路径拒绝写入',
  async() => await coverFile.applyCoverImage(path.join(workDir, 'missing.mp3'), firstJpeg),
  'invalid_file',
)
check('lrc 扩展名路径拒绝', await coverFile.isAudioFilePath(path.join(workDir, 'Artist - Song.lrc')), false)
check('图片扩展名路径拒绝', await coverFile.isAudioFilePath(jpgPath), false)
check('相对路径拒绝', await coverFile.isAudioFilePath('Artist - Song.flac'), false)
await checkThrowsCode(
  '像素过小图片拒绝写入',
  async() => await coverFile.applyCoverImage(audioPath, makeJpeg(100, 100)),
  'image_invalid',
)

const invalidState = await coverFile.getCoverState(path.join(workDir, 'missing.mp3'))
check('无效路径状态为空', invalidState, { imageExists: false, backupExists: false })
check('音频文件仍未被修改', fs.readFileSync(audioPath).toString('base64'), audioHashBefore)

console.log(`\nresult: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
