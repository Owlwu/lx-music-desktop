import type Database from 'better-sqlite3'
import tables, { DB_VERSION } from './tables'

const migrateV1 = (db: Database.Database) => {
  // 修复 v2.4.0 的默认数据库版本号不对的问题
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'dislike_list\';').get()
  if (!existsTable) {
    const sql = tables.get('dislike_list')!
    db.exec(sql)
  }
}

const migrateV2 = (db: Database.Database) => {
  // v3：移除在线音源/下载功能后遗留的历史表（数据已不再使用）
  db.exec(`
    DROP TABLE IF EXISTS "main"."music_url";
    DROP TABLE IF EXISTS "main"."music_info_other_source";
    DROP TABLE IF EXISTS "main"."download_list";
  `)
}

export default (db: Database.Database) => {
  let version = (db.prepare<[string]>('SELECT "field_value" FROM "main"."db_info" WHERE "field_name" = ?').get('version') as { field_value: string }).field_value

  if (version === '1') {
    migrateV1(db)
    version = '2'
    db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: version })
  }

  if (version === '2') {
    migrateV2(db)
    db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
  }
}
