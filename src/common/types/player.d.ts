declare namespace LX {
  namespace Player {
    interface ProgressBarOptions {
      progress: number
      mode?: Electron.ProgressBarOptions['mode']
    }

    type StatusButtonActions = 'unCollect'
    | 'collect'
    | 'prev'
    | 'pause'
    | 'play'
    | 'next'
    | 'seek'
    | 'volume'
    | 'mute'

    interface LyricInfo extends LX.Music.LyricInfo {
      rawlrcInfo: LX.Music.LyricInfo
      /**
       * true = 来自 DB 的「已编辑/已调偏移」歌词（用户手动改过）；
       * false/undefined = 直接来自文件（内嵌或同名 .lrc）的歌词
       */
      isEdited?: boolean
    }

    interface Status {
      status: 'playing' | 'paused' | 'error' | 'stoped'
      name: string
      singer: string
      albumName: string
      picUrl: string
      progress: number
      duration: number
      playbackRate: number
      lyricLineText: string
      lyricLineAllText: string
      lyric: string
      tlyric: string
      rlyric: string
      lxlyric: string
      collect: boolean
      volume: number
      mute: boolean
    }
  }
}
