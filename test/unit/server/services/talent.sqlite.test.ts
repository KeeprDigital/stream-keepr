import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Talent's Social Profiles live in fixed columns: a supplied set replaces
// them all, and an update that omits the set leaves them alone.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { talentService } = await import('~~/server/services/talent');

afterAll(async () => await harness.close());

async function stored(id: number) {
	const talent = (await db.query.eventTalents.findFirst({ where: eq(schema.eventTalents.id, id) }))!;
	const { twitchHandle, youtubeHandle, xHandle, instagramHandle, tiktokHandle, blueskyHandle } = talent;
	return { name: talent.name, twitchHandle, youtubeHandle, xHandle, instagramHandle, tiktokHandle, blueskyHandle };
}

describe('talentService Social Profiles', () => {
	it('stores the supplied subset, keeps it through an update without one, and replaces it whole when one is supplied', async () => {
		const [event] = await db.insert(schema.events).values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' }).returning();
		const none = { twitchHandle: null, youtubeHandle: null, xHandle: null, instagramHandle: null, tiktokHandle: null, blueskyHandle: null };

		const talent = await talentService().create(event!.id, { name: 'Caster', socialProfiles: { twitch: 'Caster', bluesky: 'caster.bsky.social' } });
		expect(await stored(talent.id)).toEqual({ ...none, name: 'Caster', twitchHandle: 'Caster', blueskyHandle: 'caster.bsky.social' });

		await talentService().update(talent.id, event!.id, { name: 'Renamed' });
		expect(await stored(talent.id)).toEqual({ ...none, name: 'Renamed', twitchHandle: 'Caster', blueskyHandle: 'caster.bsky.social' });

		await talentService().update(talent.id, event!.id, { socialProfiles: { youtube: 'Caster' } });
		expect(await stored(talent.id)).toEqual({ ...none, name: 'Renamed', youtubeHandle: 'Caster' });
	});
});
