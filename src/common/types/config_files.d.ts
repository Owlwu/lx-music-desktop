declare namespace LX {
  namespace ConfigFile {
    interface MyListInfoPart {
      type: 'playListPart_v2'
      data: LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull
    }

    /**
     * 本地音乐文件同步的「同步范围」导出文件。
     *
     * 刻意用**明文 JSON**（不是 gzip 的 `.lxmc`）：内容只是路径列表，
     * 明文便于阅读、手改与版本比对。导入端兼容 `scope` 与旧结构的 `data.scope`。
     */
    interface MusicFileScope {
      type: 'musicFileScope'
      version: number
      root: string
      exportedAt: string
      count: number
      scope: string[]
    }

  }
}
