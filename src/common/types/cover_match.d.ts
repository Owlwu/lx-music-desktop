declare namespace LX {
  namespace CoverMatch {
    /**
     * 在线封面数据源 id
     */
    type CoverSource = 'qq' | 'itunes'

    /**
     * 封面候选；同一专辑只保留一条（专辑维度去重）
     */
    interface CoverCandidate {
      source: CoverSource
      /**
       * 源内唯一 id（QQ albummid / iTunes collectionId）
       */
      id: string
      name: string
      singer: string
      albumName: string
      durationSec: number | null
      /**
       * 大图 URL（QQ R500 / iTunes 600x600）
       */
      coverUrl: string
      /**
       * 缩略图 URL（QQ R150 / iTunes 100x100）
       */
      thumbnailUrl: string
      /**
       * 0..1，标题/歌手/时长 + 专辑加分
       */
      score: number
    }

    interface SearchParams {
      musicInfo: LX.Music.MusicInfo
      /**
       * 用户手动修改后的搜索关键词；为空则用歌曲信息自动生成
       */
      keyword?: string
    }

    interface SearchResult {
      candidates: CoverCandidate[]
    }

    interface ApplyParams {
      musicInfo: LX.Music.MusicInfo
      candidate: CoverCandidate
    }

    interface ApplyResult {
      /**
       * 实际写入的同名图片路径
       */
      imagePath: string
      format: 'jpg' | 'png'
      /**
       * 本次是否新建了 `.bak`
       */
      backupCreated: boolean
    }

    interface FilePathParams {
      /**
       * 音频文件绝对路径（封面路径由主进程按同名规则生成）
       */
      filePath: string
    }

    interface CoverState {
      imagePath?: string
      imageFormat?: 'jpg' | 'png'
      imageExists: boolean
      backupExists: boolean
      imageSize?: number
      imageMtime?: number
    }

    interface RollbackResult {
      restored: boolean
    }
  }
}
