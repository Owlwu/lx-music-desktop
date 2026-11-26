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
  'main/modules/sidecarWrite.ts',
  'common/utils/mediaMatch/normalize.ts',
  'common/utils/coverMatch/score.ts',
  'main/modules/coverMatch/coverFile.ts',
]
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cover-match-'))
for (const relPath of moduleNames) {
  const code = fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
    .replace(/from '@common\/utils\/mediaMatch\/normalize'/g, "from './normalize.ts'")
    .replace("from '../sidecarWrite'", "from './sidecarWrite'")
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
})
check('首次写入不产生备份', fs.existsSync(jpgBackupPath), false)
check('首次写入内容正确', fs.readFileSync(jpgPath).equals(firstJpeg), true)
check('音频文件内容未变化', fs.readFileSync(audioPath).toString('base64'), audioHashBefore)

fs.writeFileSync(jpgPath, 'original-jpg')
const secondJpeg = makeJpeg(600, 600, 2)
await coverFile.applyCoverImage(audioPath, secondJpeg)
check('覆盖同名 JPEG', fs.readFileSync(jpgPath).equals(secondJpeg), true)
check('覆盖不产生备份', fs.existsSync(jpgBackupPath), false)

const pngData = makePng(600, 600, 4)
const originalWriteFile = fsPromises.writeFile
fsPromises.writeFile = async () => {
  throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
}
try {
  await checkThrowsCode('写入失败抛 disk_full', () => coverFile.applyCoverImage(audioPath, pngData), 'disk_full')
} finally {
  fsPromises.writeFile = originalWriteFile
}
check('写入失败时当前 JPEG 仍可用', fs.readFileSync(jpgPath).equals(secondJpeg), true)
check('写入失败后无临时文件', fs.existsSync(pngPath + '.tmp'), false)
check('写入失败未创建备份', fs.existsSync(jpgBackupPath), false)

check('切换到 PNG', await coverFile.applyCoverImage(audioPath, pngData), { imagePath: pngPath, format: 'png' })
check('旧 JPEG 已删除', fs.existsSync(jpgPath), false)
check('PNG 文件为当前封面', (await coverFile.getCoverState(audioPath)).imagePath, pngPath)
check('切换格式不创建备份', fs.existsSync(jpgBackupPath) || fs.existsSync(pngBackupPath), false)

fs.writeFileSync(jpgPath, secondJpeg)
fs.writeFileSync(jpgBackupPath, 'legacy-backup')
check('两种格式都存在时优先读 JPEG', (await coverFile.getCoverState(audioPath)).imagePath, jpgPath)
check('删除同名封面', await coverFile.deleteCover(audioPath), true)
check('JPEG 和 PNG 均已删除', [fs.existsSync(jpgPath), fs.existsSync(pngPath)], [false, false])
check('旧备份不会被读取', await coverFile.getCoverState(audioPath), { imageExists: false })
check('重复删除无效果', await coverFile.deleteCover(audioPath), false)
check('删除后可重新匹配', await coverFile.applyCoverImage(audioPath, firstJpeg), { imagePath: jpgPath, format: 'jpg' })
await Promise.all([coverFile.applyCoverImage(audioPath, firstJpeg), coverFile.applyCoverImage(audioPath, pngData)])
check('并发匹配后只剩一张封面', Number(fs.existsSync(jpgPath)) + Number(fs.existsSync(pngPath)), 1)
check('并发匹配后无临时文件', fs.readdirSync(workDir).filter(name => name.endsWith('.tmp')), [])

await checkThrowsCode(
  '不存在的音频路径拒绝写入',
  async() => await coverFile.applyCoverImage(path.join(workDir, 'missing.mp3'), firstJpeg),
  'invalid_file',
)
await checkThrowsCode('不存在的音频路径拒绝删除', () => coverFile.deleteCover(path.join(workDir, 'missing.mp3')), 'invalid_file')
check('lrc 扩展名路径拒绝', await coverFile.isAudioFilePath(path.join(workDir, 'Artist - Song.lrc')), false)
check('图片扩展名路径拒绝', await coverFile.isAudioFilePath(jpgPath), false)
check('相对路径拒绝', await coverFile.isAudioFilePath('Artist - Song.flac'), false)
await checkThrowsCode(
  '像素过小图片拒绝写入',
  async() => await coverFile.applyCoverImage(audioPath, makeJpeg(100, 100)),
  'image_invalid',
)

const invalidState = await coverFile.getCoverState(path.join(workDir, 'missing.mp3'))
check('无效路径状态为空', invalidState, { imageExists: false })
check('音频文件仍未被修改', fs.readFileSync(audioPath).toString('base64'), audioHashBefore)

console.log(`\nresult: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
