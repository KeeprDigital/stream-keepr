import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs these against the last migration's snapshot and writes
// the next migration beside it. `wrangler.jsonc` and `wrangler.dev.jsonc` apply
// them from the same directory.
export default defineConfig({
	dialect: 'sqlite',
	schema: ['server/db/schema.ts', 'server/db/schema/*.ts'],
	out: 'server/db/migrations/sqlite',
});
