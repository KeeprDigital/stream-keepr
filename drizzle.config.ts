import process from 'node:process'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/*',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
})
