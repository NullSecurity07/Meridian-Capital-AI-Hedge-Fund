// lib/db-singleton.ts
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import path from 'path'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'meridian.db')
    _db = new Database(dbPath)
    initDb(_db)
  }
  return _db
}
