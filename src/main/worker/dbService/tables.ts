type Tables = 'db_info'
| 'my_list'
| 'my_list_music_info'
| 'index_my_list_music_info'
| 'my_list_music_info_order'
| 'index_my_list_music_info_order'
| 'lyric'
| 'dislike_list'

const tables = new Map<Tables, string>()


tables.set('db_info', `
  CREATE TABLE "db_info" (
    "id" INTEGER NOT NULL UNIQUE,
    "field_name" TEXT,
    "field_value" TEXT,
    PRIMARY KEY("id" AUTOINCREMENT)
  );
`)
tables.set('my_list', `
  CREATE TABLE "my_list" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "sourceListId" TEXT,
    "position" INTEGER NOT NULL,
    "locationUpdateTime" INTEGER,
    PRIMARY KEY("id")
  );
`)
tables.set('my_list_music_info', `
  CREATE TABLE "my_list_music_info" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interval" TEXT,
    "meta" TEXT NOT NULL,
    UNIQUE("id","listId")
  );
`)
tables.set('index_my_list_music_info', `
  CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
    "id",
    "listId"
  );
`)
tables.set('my_list_music_info_order', `
  CREATE TABLE "my_list_music_info_order" (
    "listId" TEXT NOT NULL,
    "musicInfoId" TEXT NOT NULL,
    "order" INTEGER NOT NULL
  );
`)
tables.set('index_my_list_music_info_order', `
  CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
    "listId",
    "musicInfoId"
  );
`)
tables.set('lyric', `
  CREATE TABLE "lyric" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL
  );
`)
tables.set('dislike_list', `
  CREATE TABLE "dislike_list" (
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT
  );
`)

export default tables

export const DB_VERSION = '3'
