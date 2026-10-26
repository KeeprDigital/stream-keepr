import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '~~/server/db';
import {
	LOCAL_DEVELOPER_SESSION_ID_PREFIX,
	LOCAL_DEVELOPER_USER_ID,
	LOCAL_DEVELOPER_USER_NAME,
} from '~~/shared/utils/localDeveloperAuth';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

// What administrator readings call the actors they carry (ADR-0010): a person
// by their current name, a machine actor by its own spelling, and a pre-cutover
// session UUID as the anonymous era. On real D1, so a long page stays within
// its bound-parameter limit.

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', async importOriginal => ({
	...await importOriginal<object>(),
	db,
}));

const { ANONYMOUS_ERA_ACTOR_NAME, graphicsActorNames, sessionHolderName } = await import('~~/server/utils/actorNames');

const now = new Date('2026-01-01T00:00:00Z');
const ANONYMOUS_AUTHOR = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

beforeAll(async () => {
	await db.insert(schema.user).values([
		{
			id: 'named',
			name: 'Marcus Angel',
			email: 'named@example.test',
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		},
		{
			id: 'blank',
			name: '   ',
			email: 'blank@example.test',
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		},
	]);
	await db.insert(schema.session).values([
		{
			id: 'named-session',
			token: 'named-token',
			userId: 'named',
			expiresAt: now,
			createdAt: now,
			updatedAt: now,
		},
		{
			id: 'blank-session',
			token: 'blank-token',
			userId: 'blank',
			expiresAt: now,
			createdAt: now,
			updatedAt: now,
		},
	]);
});

afterAll(async () => await harness.dispose());

describe('graphicsActorNames', () => {
	it('names every actor it is asked about, by kind', async () => {
		expect(await graphicsActorNames([
			'named',
			'blank',
			ANONYMOUS_AUTHOR,
			'graphics-administrator',
			'graphics-retention-policy',
			LOCAL_DEVELOPER_USER_ID,
			'named',
		]))
			.toEqual({
				'named': 'Marcus Angel',
				'blank': 'blank@example.test',
				[ANONYMOUS_AUTHOR]: ANONYMOUS_ERA_ACTOR_NAME,
				'graphics-administrator': 'graphics-administrator',
				'graphics-retention-policy': 'graphics-retention-policy',
				[LOCAL_DEVELOPER_USER_ID]: LOCAL_DEVELOPER_USER_NAME,
			});
		expect(await graphicsActorNames([])).toEqual({});
	});

	it('names a page of more actors than D1 binds in one statement', async () => {
		const actors = [
			...Array.from({ length: 120 }, (_, index) => `machine-${index}`),
			'named',
		];

		const names = await graphicsActorNames(actors);

		expect(Object.keys(names)).toHaveLength(121);
		expect(names.named).toBe('Marcus Angel');
	});
});

describe('sessionHolderName', () => {
	it.each([
		['the person a session belongs to', 'named-session', 'Marcus Angel'],
		['nothing, rather than an address, for a holder with no name', 'blank-session', null],
		['nothing for a session that has ended', 'ended-session', null],
		['the local developer for a local-development browser', `${LOCAL_DEVELOPER_SESSION_ID_PREFIX}browser-a`, LOCAL_DEVELOPER_USER_NAME],
	])('answers %s', async (_case, sessionId, name) => {
		expect(await sessionHolderName(sessionId)).toBe(name);
	});
});
