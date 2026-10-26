import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Screen service's versioned writes over real SQL: a write lands only on
// the version it read, carries its companion statements with it, and merges
// configuration rather than replacing it.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { screenService } = await import('~~/server/services/screen');

let eventId: number;
const capability = { assetCapabilitySeed: 'seed-1', assetCapabilityVersion: 1, assetCapabilityDigest: 'digest-1' };

beforeAll(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
});

afterAll(async () => await harness.close());

let screenCount = 0;
async function createScreen(values: Record<string, unknown> = {}) {
	screenCount += 1;
	return await screenService().create(
		eventId,
		{ name: 'Main', slug: `screen-${screenCount}`, ...values } as never,
		{ ...capability, assetCapabilityDigest: `digest-${screenCount}` },
	);
}

async function stored(id: number) {
	return (await db.query.screens.findFirst({
		where: eq(schema.screens.id, id),
	}))!;
}

describe('screenService', () => {
	it('stores the Screen Output Asset Capability with the created Screen', async () => {
		const screen = await createScreen();

		expect(await stored(screen.id)).toMatchObject({
			eventId,
			...capability,
			assetCapabilityDigest: `digest-${screenCount}`,
			stateVersion: 0,
		});
	});

	it('rotates the capability only from the version the caller read', async () => {
		const screen = await createScreen();
		const next = { assetCapabilitySeed: 'seed-2', assetCapabilityVersion: 2, assetCapabilityDigest: 'rotated-digest' };

		expect(await screenService().replaceAssetCapability(screen.id, eventId, next, 1)).toMatchObject(next);
		await expect(screenService().replaceAssetCapability(screen.id, eventId, { ...next, assetCapabilityVersion: 3 }, 1))
			.rejects
			.toMatchObject({ statusCode: 409 });
		expect(await screenService().replaceAssetCapability(999_999, eventId, next, 2)).toBeUndefined();
	});

	it('writes only on the version it read, advancing it', async () => {
		const screen = await createScreen();

		expect(await screenService().update(screen.id, eventId, { name: 'Renamed' }, 0)).toMatchObject({ name: 'Renamed', stateVersion: 1 });
		await expect(screenService().update(screen.id, eventId, { name: 'Stale' }, 0)).rejects.toMatchObject({ statusCode: 409 });
		expect((await stored(screen.id)).name).toBe('Renamed');
		expect(await screenService().update(999_999, eventId, { name: 'Missing' }, 0)).toBeUndefined();
	});

	it('commits the statements a caller sends with the write in the same batch', async () => {
		const screen = await createScreen();

		await screenService().update(screen.id, eventId, { name: 'With Companion' }, 0, [
			db.update(schema.events).set({ name: 'Touched By Companion' }).where(eq(schema.events.id, eventId)),
		]);

		expect((await db.query.events.findFirst({
			where: eq(schema.events.id, eventId),
		}))?.name).toBe('Touched By Companion');
	});

	it('merges a mode\'s configuration and the Screen configuration into what is stored', async () => {
		const screen = await createScreen({
			modeConfigs: {
				standings: { pageSize: 8, showRecord: true },
			},
			screenConfig: { padding: 10 },
		});

		await screenService().updateModeConfig(screen.id, eventId, 'standings', { pageSize: 12 });
		await screenService().updateScreenConfig(screen.id, eventId, { background: '#000000' });

		const after = await stored(screen.id);
		expect(after.modeConfigs?.standings).toMatchObject({ pageSize: 12, showRecord: true });
		expect(after.screenConfig).toMatchObject({ padding: 10, background: '#000000' });
		expect(after.stateVersion).toBe(2);
	});

	it('answers whether a slug is taken, excluding the Screen being renamed', async () => {
		const screen = await createScreen();

		expect(await screenService().slugExists(eventId, screen.slug)).toBe(true);
		expect(await screenService().slugExists(eventId, screen.slug, screen.id)).toBe(false);
		expect(await screenService().slugExists(eventId, 'unused-slug')).toBe(false);
	});

	it('answers whether a removal found the Screen', async () => {
		const screen = await createScreen();

		expect(await screenService().remove(screen.id, eventId)).toBe(true);
		expect(await screenService().remove(screen.id, eventId)).toBe(false);
	});
});
