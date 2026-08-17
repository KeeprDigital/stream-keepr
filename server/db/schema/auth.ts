import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Better Auth's tables (#393), maintained by hand at the shape the pinned
 * library derives from this installation's options — see
 * `test/unit/server/db/authSchema.test.ts`, which holds this file to that
 * contract and is the tripwire a version bump trips when it changes a field.
 *
 * TypeScript property keys are load-bearing: the Drizzle adapter resolves
 * columns by property key, which must equal the Better Auth field name. The
 * SQL names underneath follow this repo's snake_case convention, and the table
 * names stay singular because they must equal the Better Auth model names.
 *
 * Better Auth issues its own string ids and writes every timestamp itself, so
 * no column here carries a database-side default.
 */

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	// Admin-plugin fields: admin-created accounts, banning, roles.
	role: text('role'),
	banned: integer('banned', { mode: 'boolean' }),
	banReason: text('ban_reason'),
	banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
	// Admin-plugin field: which admin, if any, this session impersonates as.
	impersonatedBy: text('impersonated_by'),
}, table => [
	index('session_user_id_idx').on(table.userId),
]);

export const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [
	index('account_user_id_idx').on(table.userId),
]);

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [
	index('verification_identifier_idx').on(table.identifier),
]);
