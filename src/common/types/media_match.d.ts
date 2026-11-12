declare namespace LX {
  namespace MediaMatch {
    /**
     * 播放时使用的歌词来源
     */
    type LyricSource = 'embedded' | 'lrc'

    /**
     * 在线歌词数据源 id
     */
    type LyricsSource = 'lrclib' | 'qq'

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
    }

    interface LyricResult {
      lyric: string
      isSynced: boolean
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
      backupCreated: boolean
    }

    interface FilePathParams {
      /**
       * 音频文件绝对路径（写入目标由主进程按同名规则生成）
       */
      filePath: string
    }

    interface RollbackResult {
      restored: boolean
    }

    interface LrcState {
      lrcExists: boolean
      backupExists: boolean
      lrcSize?: number
      lrcMtime?: number
    }
  }
}
