import type { H3Event } from 'h3'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import { defineEventHandler, getQuery } from 'h3'

const VALID_QUERY_COLUMNS: (keyof OpCardData)[] = [
  'name',
  'rarity',
  'type',
  'cost',
  'color',
]
const PARTIAL_MATCH_COLUMNS: (keyof OpCardData)[] = ['name']
const NUMERIC_COLUMNS: (keyof OpCardData)[] = ['cost']

const dbPath = path.resolve(process.cwd(), 'server/db/op.sqlite')
let db: Database.Database

try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true })
}
catch (error) {
  console.error('Failed to connect to SQLite database:', error)
}

export default defineEventHandler(async (event: H3Event): Promise<OpCardData[] | { error: string, details?: string }> => {
  if (!db || !db.open) {
    event.node.res.statusCode = 503
    return { error: 'Database connection not established or closed.' }
  }

  const queryParams = getQuery(event)
  const conditions: string[] = []
  const values: (string | number)[] = []

  for (const key in queryParams) {
    if (VALID_QUERY_COLUMNS.includes(key as keyof OpCardData)) {
      const value = queryParams[key]
      const columnName = key

      if (value !== undefined && value !== null) {
        if (NUMERIC_COLUMNS.includes(columnName as keyof OpCardData)) {
          if (typeof value === 'string') {
            const numValue = Number.parseInt(value, 10)
            if (!Number.isNaN(numValue)) {
              conditions.push(`${columnName} = ?`)
              values.push(numValue)
            }
            else {
              console.warn(`Invalid numeric value for parameter '${columnName}': ${value}. Skipping.`)
            }
          }
          else if (typeof value === 'number') {
            conditions.push(`${columnName} = ?`)
            values.push(value)
          }
        }
        else if (typeof value === 'string') {
          if (PARTIAL_MATCH_COLUMNS.includes(columnName as keyof OpCardData)) {
            conditions.push(`${columnName} LIKE ?`)
            values.push(`%${value}%`)
          }
          else if (columnName === 'image_url' || columnName === 'counter') {
            conditions.push(`${columnName} = ?`)
            values.push(value)
          }
          else {
            conditions.push(`${columnName} = ?`)
            values.push(value)
          }
        }
      }
    }
  }

  let sql = 'SELECT * FROM cards'
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }

  try {
    const stmt = db.prepare(sql)
    const cardsResult: unknown[] = stmt.all(...values)
    return cardsResult as OpCardData[]
  }
  catch (error: any) {
    console.error('Error executing query:', error)
    event.node.res.statusCode = 500
    return { error: 'Failed to retrieve cards from the database.', details: error.message }
  }
})

function cleanup() {
  if (db && db.open) {
    db.close()
  }
  process.exit()
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
