/**
 * QQ QRC 逐字歌词：解析 / 可用性 / [awlrc:] 拼装 / 桌面 parseLyric 回读测试
 *
 * 运行：node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/word-sync.test.ts
 *
 * 夹具来自 docs/source/wordsync/fixtures 的真实 QRC 明文（不含 hex 密文）。
 * 纯逻辑模块是 TS，直接把源码复制到临时目录并把无扩展名的相对导入补成 `.ts`，
 * 以便 node 原生类型擦除直接运行（与 tests/media-match.test.ts 同一套路）。
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

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const fixturesDir = fileURLToPath(new URL('./fixtures/wordsync/', import.meta.url))
const moduleNames = [
  'common/utils/mediaMatch/qrcLyric.ts',
  'common/utils/mediaMatch/qqParse.ts',
  'common/utils/mediaMatch/normalize.ts',
  'common/utils/mediaMatch/lrcText.ts',
  'common/utils/mediaMatch/score.ts',
  'common/utils/lyricUtils/qrc.js',
]
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-word-sync-'))
for (const relPath of moduleNames) {
  const code = fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
    .replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
  // qrc.js 也复制成 .ts：内容是纯 JS，node 类型擦除可直接加载
  const ext = path.extname(relPath)
  const outName = path.basename(relPath).slice(0, -ext.length) + '.ts'
  fs.writeFileSync(path.join(moduleDir, outName), code, 'utf8')
}

const load = async(name: string) => {
  return import(pathToFileURL(path.join(moduleDir, name + '.ts')).href)
}

const qrcLyric = await load('qrcLyric')
const qqParse = await load('qqParse')
const lrcText = await load('lrcText')
const score = await load('score')
const qrc = await load('qrc')

const readFixture = (name: string): string => {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8').replace(/\r\n?/g, '\n')
}
const stripFinalNewline = (text: string): string => text.endsWith('\n') ? text.slice(0, -1) : text

/**
 * 桌面端 renderer/worker/main/music.ts 的 parseLyric 逻辑复刻（二期未改动该文件，仅用于验证 [awlrc:] 回读）
 */
const parseLyric = (lrc: string) => {
  const verifyAwlrc = (lrc: string) => {
    return /(?:^|\s*)\[\d+:\d+(?:\.\d+)]<\d+,\d+>.+$/m.test(lrc)
  }
  const verifylrc = (lrc: string) => {
    return /(?:^|\s*)\[\d+:\d+(?:\.\d+)].+$/m.test(lrc)
  }
  const lrcTags = {
    awlrc: {
      name: 'lxlyric',
      verify: verifyAwlrc,
    },
    lrc: {
      name: 'lyric',
      verify: verifylrc,
    },
  } as const
  const tagRxp = /(?:^|\n\s*)\[awlrc:([^\]]+)]/i
  const lrcRxp = /^(lrc|awlrc):([^,]+)$/i
  const parse = (content: string) => {
    const lyricInfo: Record<string, string> = {}
    const lrcs = content.trim().split(',')
    for (const lrc of lrcs) {
      const result = lrcRxp.exec(lrc.trim())
      if (!result) continue
      const target = lrcTags[result[1].toLowerCase() as 'lrc' | 'awlrc']
      if (!target) continue
      const data = Buffer.from(result[2], 'base64').toString('utf-8').trim()
      if (target.verify(data)) lyricInfo[target.name] = data
    }
    return lyricInfo
  }
  let parsedInfo: Record<string, string> = {}
  const lyric = lrc.replace(tagRxp, (_: string, p1: string) => {
    parsedInfo = parse(p1)
    return ''
  }).trim()
  return { lyric, ...parsedInfo }
}

const timedLabelCount = (text: string): number => (text.match(/^\[\d{1,3}:\d{2}\.\d{3}]/gm) ?? []).length
const wordTagCountOf = (text: string): number => (text.match(/<\d+,\d+>/g) ?? []).length

const readQrc = (slug: string): string => stripFinalNewline(readFixture(`qq-qrc-${slug}.decoded.qrc.txt`))
const readLxlyric = (slug: string): string => stripFinalNewline(readFixture(`qq-qrc-${slug}.lxlyric.txt`))
const readLineLrc = (slug: string): string => stripFinalNewline(readFixture(`qq-qrc-${slug}.line.lrc`))
const lineLrcWithoutSourceHeader = (text: string): string => {
  return text.split('\n').filter(line => !/^\[(ti|ar|al|by):/i.test(line)).join('\n')
}

console.log('\n== QRC 解析（晴天真实样本） ==')
const qingtianQrc = readQrc('qingtian')
const qingtian = qrcLyric.parseQrcLyric(qingtianQrc)
const qingtianLxlyric = readLxlyric('qingtian')
const qingtianLine = readLineLrc('qingtian')
const qingtianExpectedLyric = lineLrcWithoutSourceHeader(qingtianLine)

check('lxlyric 与勘察夹具逐字节一致', qingtian.lxlyric, qingtianLxlyric)
check('行级歌词与勘察夹具一致（去掉源头部标签）', qingtian.lyric, qingtianExpectedLyric)
check('isUsableWordSync = true', qrcLyric.isUsableWordSync(qingtian), true)
check('lineCount = 时间轴行数', qingtian.lineCount, timedLabelCount(qingtian.lyric))
check('wordLineCount = 时间轴行数', qingtian.wordLineCount, timedLabelCount(qingtian.lyric))
check('wordTagCount = lxlyric 词标签数', qingtian.wordTagCount, wordTagCountOf(qingtianLxlyric))
check('[offset:0] 保留在行级', qingtian.lyric.startsWith('[offset:0]\n'), true)
check('[offset:0] 保留在逐字', qingtian.lxlyric.startsWith('[offset:0]\n'), true)
check('源头部标签未进入行级', /^\[(ti|ar|al|by):/m.test(qingtian.lyric), false)
check('行级不包含词级标签', qingtian.lyric.includes('<'), false)
check('行标签统一为 3 位小数', /\[\d{1,3}:\d{2}\.\d{1,2}]/.test(qingtian.lyric + qingtian.lxlyric), false)
check('逐字无空行（不插间奏空行）', qingtian.lxlyric.split('\n').every(line => line.trim() !== ''), true)

const firstTimedLxLine = qingtian.lxlyric.split('\n').find(line => /^\[\d{1,3}:\d{2}\.\d{3}]/.test(line)) ?? ''
check('首个时间轴行以 <a,b> 开头', /^\[\d{2}:\d{2}\.\d{3}]<\d+,\d+>/.test(firstTimedLxLine), true)
check('首行首词相对行首为 0', firstTimedLxLine.startsWith('[00:00.000]<0,160>晴'), true)
// QRC 原文 [29264,3446]故(29264,390)… -> 相对行首 0
check('绝对毫秒换算为相对行首', qingtian.lxlyric.includes('[00:29.264]<0,390>故<390,392>事'), true)

console.log('\n== QRC 解析（打上花火，含 [kana:] 幽灵标签） ==')
const dashangQrc = readQrc('dashanghuahuo')
const dashang = qrcLyric.parseQrcLyric(dashangQrc)
const dashangLxlyric = readLxlyric('dashanghuahuo')
check('夹具确实含 [kana:] 行', /^\[kana:/m.test(dashangQrc), true)
check('lxlyric 与勘察夹具逐字节一致', dashang.lxlyric, dashangLxlyric)
check('行级歌词与勘察夹具一致（去掉源头部标签）', dashang.lyric, lineLrcWithoutSourceHeader(readLineLrc('dashanghuahuo')))
check('wordTagCount 与夹具一致（kana 未混入）', dashang.wordTagCount, wordTagCountOf(dashangLxlyric))
check('lineCount = 57', dashang.lineCount, 57)
check('[kana:] 不产出文字', dashang.lyric.includes('kana') || dashang.lxlyric.includes('kana'), false)
check('[kana:] 里的时间戳未产出幽灵字', dashang.lxlyric.includes('<21507,'), false)
check('kana 行里的 (a,b) 不进入词标签计数', wordTagCountOf(dashang.lxlyric) < 600, true)

console.log('\n== 转换规则（构造样本） ==')
const simple = qrcLyric.parseQrcLyric('[0,1000]A(0,100)B(100,200)')
check('词级标签移到文字之前并转相对行首', simple.lxlyric, '[00:00.000]<0,100>A<100,200>B')
check('行级正文去掉词级标签', simple.lyric, '[00:00.000]AB')
check('构造样本可用', qrcLyric.isUsableWordSync(simple), true)

const earlyWord = qrcLyric.parseQrcLyric('[1000,500]A(900,100)')
check('词 start 早于行 start 截断为 0', earlyWord.lxlyric, '[00:01.000]<0,100>A')

const minuteMs = qrcLyric.parseQrcLyric('[61234,1000]A(61234,100)B(61334,200)')
check('分钟与毫秒标签格式', minuteMs.lyric, '[01:01.234]AB')
check('分钟与毫秒逐字格式', minuteMs.lxlyric, '[01:01.234]<0,100>A<100,200>B')

const lineOnly = qrcLyric.parseQrcLyric('[offset:0]\n[0,1000]intro line\n[1000,1000]A(1000,100)B(1100,100)')
check('无词级标签的 timed 行只进行级', lineOnly.lyric, '[offset:0]\n[00:00.000]intro line\n[00:01.000]AB')
check('无词级标签的 timed 行不进 lxlyric', lineOnly.lxlyric, '[offset:0]\n[00:01.000]<0,100>A<100,100>B')
check('混合行统计', { lineCount: lineOnly.lineCount, wordLineCount: lineOnly.wordLineCount, wordTagCount: lineOnly.wordTagCount }, {
  lineCount: 2,
  wordLineCount: 1,
  wordTagCount: 2,
})
check('混合行仍可用', qrcLyric.isUsableWordSync(lineOnly), true)

const emptyToken = qrcLyric.parseQrcLyric('[0,1000]A(0,100)(100,100)B(200,100)')
check('空文本 token 丢弃', emptyToken.lxlyric, '[00:00.000]<0,100>A<200,100>B')
check('空文本 token 不计入 wordTagCount', emptyToken.wordTagCount, 2)

const blankLine = qrcLyric.parseQrcLyric('[0,1000]   \n[1000,1000]A(1000,100)')
check('纯空白行丢弃', blankLine.lyric, '[00:01.000]A')
check('纯空白行不进逐字', blankLine.lxlyric, '[00:01.000]<0,100>A')

const droppedTags = qrcLyric.parseQrcLyric([
  '[ti:title]',
  '[ar:artist]',
  '[al:album]',
  '[by:]',
  '[language:eyJhIjoxfQ==]',
  '[hash:123]',
  '[kana:1あ(999,1)]',
  '[offset:0]',
  '[0,1000]A(0,100)',
].join('\n'))
check('头部/假时间轴标签全部丢弃，只保留 [offset:]', droppedTags.lyric, '[offset:0]\n[00:00.000]A')
check('逐字同样只保留 [offset:]', droppedTags.lxlyric, '[offset:0]\n[00:00.000]<0,100>A')

const crlf = qrcLyric.parseQrcLyric('[offset:0]\r\n[0,1000]A(0,100)\r\n')
check('CRLF 归一为 LF', crlf.lxlyric, '[offset:0]\n[00:00.000]<0,100>A')

const empty = qrcLyric.parseQrcLyric('')
check('空输入返回空结果', empty, { lyric: '', lxlyric: '', lineCount: 0, wordLineCount: 0, wordTagCount: 0 })

console.log('\n== 可用性判定 ==')
const placeholder = qrcLyric.parseQrcLyric('未经许可,不得翻唱或使用')
check('纯音乐占位文本不可用', { lineCount: placeholder.lineCount, usable: qrcLyric.isUsableWordSync(placeholder) }, { lineCount: 0, usable: false })
const untimed = qrcLyric.parseQrcLyric('作词 : ZAQ 作曲 : ZAQ 编曲 : ZAQ 演唱 : ZAQ')
check('无时间轴歌词不可用', { lineCount: untimed.lineCount, usable: qrcLyric.isUsableWordSync(untimed) }, { lineCount: 0, usable: false })
check('只有行级无词标签不可用', qrcLyric.isUsableWordSync(qrcLyric.parseQrcLyric('[0,1000]intro line')), false)
check('空结果不可用', qrcLyric.isUsableWordSync(empty), false)
check(
  '首行没有词级标签则整份不可用',
  qrcLyric.isUsableWordSync({
    lyric: '[00:01.000]only line',
    lxlyric: '[offset:0]\n[00:01.000]only line',
    lineCount: 1,
    wordLineCount: 1,
    wordTagCount: 0,
  }),
  false,
)
check(
  '首行有词级标签可用',
  qrcLyric.isUsableWordSync({
    lyric: '[00:01.000]line',
    lxlyric: '[offset:0]\n[00:01.000]<0,100>line',
    lineCount: 1,
    wordLineCount: 1,
    wordTagCount: 1,
  }),
  true,
)

console.log('\n== QRC 明文提取（XML / 纯文本） ==')
const xmlText = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<QrcInfos><QrcHeadInfo SaveTime="289" Version="100"/>',
  '<LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[ti:x]&#10;[offset:0]&#10;[0,1000]A(0,100)&amp;B&quot;C&quot;"/>',
  '</LyricInfo></QrcInfos>',
].join('\n')
check('XML 取 LyricContent 并反转义实体', qqParse.extractQrcLyricText(xmlText), '[ti:x]\n[offset:0]\n[0,1000]A(0,100)&B"C"')
check(
  'XML 支持 &lt; / &#39; / &#13;',
  qqParse.extractQrcLyricText('<LyricContent="A&lt;B&#39;C&#13;&#10;D"/>'),
  "A<B'C\nD",
)
check('纯文本原样返回', qqParse.extractQrcLyricText('  [0,1000]A(0,100)  '), '[0,1000]A(0,100)')
check('空明文返回空串', qqParse.extractQrcLyricText(''), '')

console.log('\n== musicu 响应解析（两级 code） ==')
check(
  '正常逐字响应',
  qqParse.parseQqWordSyncResponse({ code: 0, req: { code: 0, data: { qrc: 1, lyric: 'ABCD' } } }),
  { code: 0, reqCode: 0, qrc: true, lyric: 'ABCD' },
)
check(
  'req.code 非 0（伪造 songID）判失败',
  qqParse.parseQqWordSyncResponse({ code: 0, req: { code: 10006, data: {} } }),
  { code: 0, reqCode: 10006, qrc: false, lyric: null },
)
check(
  '外层 code 非 0 判失败',
  qqParse.parseQqWordSyncResponse({ code: -1, req: { code: 0, data: { qrc: 1, lyric: 'ABCD' } } }),
  { code: -1, reqCode: 0, qrc: false, lyric: null },
)
check(
  'qrc=0 退化为行级 base64 判失败',
  qqParse.parseQqWordSyncResponse({ code: 0, req: { code: 0, data: { qrc: 0, lyric: 'W3RpOuaZtOWkqV0=' } } }),
  { code: 0, reqCode: 0, qrc: false, lyric: null },
)
check(
  '无 lyric 字段判失败',
  qqParse.parseQqWordSyncResponse({ code: 0, req: { code: 0, data: { qrc: 1 } } }),
  { code: 0, reqCode: 0, qrc: true, lyric: null },
)
check('非对象响应判失败', qqParse.parseQqWordSyncResponse(null), { code: -1, reqCode: null, qrc: false, lyric: null })

console.log('\n== QQ 搜索 songid ==')
const qqSearch = qqParse.parseQqSearchResponse({
  code: 0,
  data: {
    song: {
      list: [
        { songmid: '001p3V4c0PQdmd', songid: 203636496, songname: '打上花火', singer: [{ name: 'Daoko' }], albumname: 'A', interval: '289' },
        { songmid: '0039MnYb0qxYhV', songname: '晴天' },
      ],
    },
  },
})
check('songid（number）映射为字符串', qqSearch[0].songId, '203636496')
check('缺 songid 时为空串', qqSearch[1].songId, '')
const rankedWithTrackId = score.rankCandidates({
  name: '打上花火',
  singer: 'Daoko',
  albumName: '',
  durationSec: 289,
  fileStem: '打上花火',
  variants: ['打上花火 Daoko'],
}, [{
  source: 'qq',
  id: '001p3V4c0PQdmd',
  trackId: '203636496',
  name: '打上花火',
  singer: 'Daoko',
  albumName: 'A',
  durationSec: 289,
  hasSynced: null,
  instrumental: false,
  score: 0,
}])
check('排序/去重后 trackId 不丢', rankedWithTrackId[0]?.trackId, '203636496')

console.log('\n== [awlrc:] 拼装 + 桌面 parseLyric 回读 ==')
const body = lrcText.buildLrcText({
  name: '晴天',
  singer: '周杰伦',
  albumName: '叶惠美',
  lyric: qingtian.lyric,
  isSynced: true,
})
check(
  '正文 = 本地头部 + QRC 转出的行级歌词',
  body,
  `[ti:晴天]\n[ar:周杰伦]\n[al:叶惠美]\n${qingtian.lyric.split('\n').map(line => line.trimEnd()).join('\n')}\n`,
)
const fileText = qrcLyric.buildAwlrcLrcText(body, qingtian.lxlyric)
const fileLines = fileText.split('\n')
check('文件以换行结尾', fileText.endsWith('\n'), true)
check('正文与标签之间是空行', fileText.includes('\n\n[awlrc:lrc:'), true)
const awlrcLine = fileLines[fileLines.length - 2]
check('标签独占一行且以 ] 结尾', awlrcLine.startsWith('[awlrc:lrc:') && awlrcLine.endsWith(']'), true)
const awlrcPayload = /^\[awlrc:([^\]]+)]$/.exec(awlrcLine)?.[1] ?? ''
const segments = awlrcPayload.split(',')
check('payload 恰好两段（lrc + awlrc）', segments.length, 2)
check('lrc 段与正文完全一致', Buffer.from(segments[0].slice('lrc:'.length), 'base64').toString('utf8'), body.trim())
check('awlrc 段与 lxlyric 完全一致', Buffer.from(segments[1].slice('awlrc:'.length), 'base64').toString('utf8'), qingtian.lxlyric)

const readback = parseLyric(fileText)
check('回读正文（[awlrc:] 被剥掉）', readback.lyric, body.trim())
check('回读 lxlyric', readback.lxlyric, qingtian.lxlyric)
check('回读正文不含 [awlrc:] 文本', readback.lyric.includes('[awlrc:'), false)
check('回读正文不含词级标签', readback.lyric.includes('<'), false)
check('回读 lxlyric 通过桌面 verifyAwlrc', /(?:^|\s*)\[\d+:\d+(?:\.\d+)]<\d+,\d+>.+$/m.test(readback.lxlyric ?? ''), true)
const bodyTimedLabels = body.split('\n').filter(line => /^\[\d/.test(line)).map(line => line.slice(0, 10))
const lxTimedLabels = qingtian.lxlyric.split('\n').filter(line => /^\[\d/.test(line)).map(line => line.slice(0, 10))
check('正文与逐字行标签一一对应（切换不跳行）', bodyTimedLabels, lxTimedLabels)
check('正文行数 = 头部 3 + offset + 时间轴行', body.trim().split('\n').length, 3 + 1 + qingtian.lineCount)

console.log('\n== QRC 解码器（恢复校验） ==')
check('空 hex 返回空串', await qrc.decodeQrc(''), '')
check('奇数长度 hex 返回空串', await qrc.decodeQrc('abc'), '')
check('非 zlib 数据返回空串', await qrc.decodeQrc('00112233445566778899aabbccddeeff'), '')

console.log(`\nresult: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
