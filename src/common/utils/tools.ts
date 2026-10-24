// 业务工具方法

export const toNewMusicInfo = (oldMusicInfo: any): LX.Music.MusicInfo | null => {
  // 只迁移本地歌曲；旧数据里的在线条目已无法播放，直接丢弃
  if (oldMusicInfo.source !== 'local') return null
  const filePath: string = oldMusicInfo.filePath ?? oldMusicInfo.songmid ?? ''
  return {
    id: `${oldMusicInfo.source}_${oldMusicInfo.songmid}`,
    name: oldMusicInfo.name,
    singer: oldMusicInfo.singer,
    source: 'local',
    interval: oldMusicInfo.interval ?? null,
    meta: {
      songId: oldMusicInfo.songmid,
      albumName: oldMusicInfo.albumName ?? '',
      picUrl: oldMusicInfo.img ?? null,
      filePath,
      ext: oldMusicInfo.ext ?? /\.(\w+)$/.exec(filePath)?.[1] ?? '',
    },
  }
}

export const convertLegacyMusicList = (list: any[]): LX.Music.MusicInfo[] => {
  const infos: LX.Music.MusicInfo[] = []
  for (const item of list) {
    const info = toNewMusicInfo(item)
    if (info) infos.push(info)
  }
  return filterMusicList(infos)
}

export const filterMusicList = <T extends LX.Music.MusicInfo>(list: T[]): T[] => {
  const ids = new Set<string>()
  return list.filter(s => {
    if (!s.id || ids.has(s.id) || !s.name) return false
    if (s.singer == null) s.singer = ''
    ids.add(s.id)
    return true
  })
}


const MAX_NAME_LENGTH = 80
const MAX_FILE_NAME_LENGTH = 150
export const clipNameLength = (name: string) => {
  if (name.length <= MAX_NAME_LENGTH || !name.includes('、')) return name
  const names = name.split('、')
  let newName = names.shift()!
  for (const name of names) {
    if (newName.length + name.length > MAX_NAME_LENGTH) break
    newName = newName + '、' + name
  }
  return newName
}
export const clipFileNameLength = (name: string) => {
  return name.length > MAX_FILE_NAME_LENGTH ? name.substring(0, MAX_FILE_NAME_LENGTH) : name
}

export const formatMusicName = (format: string, name: string, singer: string) => {
  return format.replace('歌手', singer).replace('歌名', name)
}
