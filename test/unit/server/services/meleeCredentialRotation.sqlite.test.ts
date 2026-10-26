import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A re-wrapped Melee secret replaces only the envelope that was read, so a
// rotation racing an operator's new credential never overwrites it.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret: async (plaintext: string) => `wrapped:${plaintext}`,
}));

const { rewrapMeleeClientSecret } = await import('~~/server/services/meleeCredentialRotation');

afterAll(async () => await harness.close());

async function stageEvent(meleeClientSecret: string) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal', meleeClientSecret })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function storedSecret(eventId: number) {
	return (await db.query.events.findFirst({ where: eq(schema.events.id, eventId) }))?.meleeClientSecret;
}

describe('rewrapMeleeClientSecret', () => {
	it('replaces the envelope it read', async () => {
		const eventId = await stageEvent('old-envelope');

		await expect(rewrapMeleeClientSecret(eventId, 'old-envelope', 'plaintext')).resolves.toBe(true);

		expect(await storedSecret(eventId)).toBe('wrapped:plaintext');
	});

	it('leaves a credential written since the read, and says so', async () => {
		const eventId = await stageEvent('newer-envelope');

		await expect(rewrapMeleeClientSecret(eventId, 'old-envelope', 'plaintext')).resolves.toBe(false);

		expect(await storedSecret(eventId)).toBe('newer-envelope');
	});
});
