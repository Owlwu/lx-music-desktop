declare namespace LX {
  namespace MediaMatch {
    /**
     * 播放时使用的歌词来源
     */
    type LyricSource = 'embedded' | 'lrc'

    /**
     * 在线歌词数据源 id
     */
    type LyricsSource = 'lrclib' | 'qq' | 'netease'

    interface MatchQuery {
      name: string
      singer: string
      albumName: string
      durationSec: number | null
      fileStem: string
      variants: string[]
    }

    interface LyricsCandidate {
      source: LyricsSource
      id: string
      name: string
      singer: string
      albumName: string
      durationSec: number | null
      /**
       * 是否带时间轴；null = 取词后才能确定（QQ 搜索阶段未知）
       */
      hasSynced: boolean | null
      /**
       * 推断值，仅供 UI 提示，不参与硬过滤（两源字段均不可靠）
       */
      instrumental: boolean
      score: number
      /**
       * 仅 provider 内部缓存用，不跨 IPC 传递
       */
      lyric?: string
      /**
       * 源内可用于取逐字数据的 id（QQ 为数字 songid）；无逐字能力的源为空
       */
      trackId?: string
      /**
       * 逐字可用性；null/undefined = 尚未探测，false = 已探测为仅行级
       */
      hasWordSync?: boolean | null
    }

    interface LyricResult {
      lyric: string
      isSynced: boolean
      /**
       * 行级中文翻译（清洗后的 `[mm:ss]正文` 行；空串/未提供 = 无翻译）
       */
      tlyric?: string | null
      /**
       * 行级罗马音（清洗后的 `[mm:ss]正文` 行；空串/未提供 = 无罗马音）
       */
      rlyric?: string | null
    }

    /**
     * 逐字数据（QQ QRC 转换结果）
     */
    interface WordSyncResult {
      /**
       * 与 lxlyric 同源的行级歌词（3 位毫秒时间标签），用于写入正文与 `lrc:` 段
       */
      lyric: string
      /**
       * LX 逐字格式：`[mm:ss.xxx]<相对行首毫秒,时长毫秒>字...`
       */
      lxlyric: string
    }

    interface GetWordSyncParams {
      candidate: LyricsCandidate
    }

    interface LyricsProvider {
      id: LyricsSource
      search: (query: MatchQuery, signal?: AbortSignal) => Promise<LyricsCandidate[]>
      getLyric: (candidate: LyricsCandidate, signal?: AbortSignal) => Promise<LyricResult | null>
    }

    interface SearchParams {
      musicInfo: LX.Music.MusicInfo
      /**
       * 用户手动修改后的搜索关键词；为空则用歌曲信息自动生成
       */
      keyword?: string
    }

    interface SearchResult {
      candidates: LyricsCandidate[]
    }

    interface GetLyricParams {
      candidate: LyricsCandidate
    }

    interface ApplyParams {
      musicInfo: LX.Music.MusicInfo
      candidate: LyricsCandidate
    }

    interface ApplyResult {
      lrcPath: string
      /**
       * 本次是否写入了逐字数据（`[awlrc:]`）
       */
      hasWordSync: boolean
      /**
       * 本次是否写入了翻译段（`tlrc:`）
       */
      hasTranslation?: boolean
      /**
       * 本次是否写入了罗马音段（`rlrc:`）
       */
      hasRomaji?: boolean
      /**
       * 应用时是否清理了该曲的 DB 歌词覆盖（手动编辑/歌词偏移快照）
       */
      clearedDbLyric?: boolean
    }

    interface FilePathParams {
      /**
       * 音频文件绝对路径（写入目标由主进程按同名规则生成）
       */
      filePath: string
    }

    /**
     * 单曲歌词/封面存在性（批次补全的缺失判定输入）
     */
    interface FileState {
      /**
       * 音频文件本身是否存在；false 时其余字段均为 false，批次按 skipped 处理
       */
      fileExists: boolean
      /**
       * 内嵌歌词（`common.lyrics` 或 native `LYRICS`/`USLT`）
       */
      hasEmbeddedLyric: boolean
      /**
       * 同目录同名 `.lrc` / `.LRC` / `.krc` / `.KRC`（>0 字节）
       */
      hasSidecarLyric: boolean
      /**
       * 内嵌封面（`common.picture`）
       */
      hasEmbeddedCover: boolean
      /**
       * 同目录同名 `.jpg` / `.png`（>0 字节）
       */
      hasSidecarCover: boolean
    }

    interface DeleteParams {
      /**
       * 音频文件绝对路径
       */
      filePath: string
      /**
       * 歌曲 id（本地曲为文件路径）；有值时删除成功后一并清理该曲的 DB 歌词覆盖
       */
      musicId?: string
    }

    interface DeleteResult {
      deleted: boolean
    }

    interface LrcState {
      lrcExists: boolean
      lrcSize?: number
      lrcMtime?: number
    }
  }
}
