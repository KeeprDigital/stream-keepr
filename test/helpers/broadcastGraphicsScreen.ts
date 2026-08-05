import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import * as schema from '~~/server/db/schema';

/**
 * One Event and one Broadcast Graphics Screen, seeded against a real catalogue.
 *
 * A Broadcast Graphics Live Session is loaded for an Event's Screen, so a test of one
 * needs both rows before it can issue a single command — and the rows carry fields no
 * test cares about (`game`, `featureMatchOrientation`, the asset capability pair) that
 * are nonetheless not nullable. Two suites were carrying that block each: the reference
 * index proof under the unit suite and the publish → store protocol proof under the
 * Nuxt suite (#207).
 *
 * `as never` on the inserts is the same cast both call sites used. Drizzle's inferred
 * insert type for these tables is wider than what a test supplies, and narrowing it
 * here would mean enumerating columns the schema is free to add.
 */

export interface SeededBroadcastGraphicsScreen {
	eventId: number;
	screenId: number;
	/** What a Screen Output presents when it asks whether it may fetch an asset. */
	assetCapabilityDigest: string;
}

export interface SeedBroadcastGraphicsScreenOptions {
	/** The authored Broadcast Graphics stack the Screen's mode configuration holds. */
	stack: BroadcastGraphicsModeConfig;
	eventName?: string;
}

/**
 * The derivation from the Event's own id is what lets one database hold several of
 * these, and the column it exists for is `assetCapabilityDigest`:
 * `screens_asset_capability_digest_idx` is unique over that column **alone**, so two
 * Screens carrying one digest collide however many Events they belong to. `slug` is
 * derived for legibility rather than for uniqueness — `screens_slug_idx` is composite
 * over (`event_id`, `slug`) and every call here inserts a fresh Event, so a constant
 * slug would be accepted. Both directions were run before this was written down.
 */
export async function seedBroadcastGraphicsScreen(
	db: DrizzleD1Database<typeof schema>,
	{ stack, eventName = 'Broadcast Graphics' }: SeedBroadcastGraphicsScreenOptions,
): Promise<SeededBroadcastGraphicsScreen> {
	const [event] = await db.insert(schema.events).values({
		name: eventName,
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
	} as never).returning();
	const eventId = event!.id;

	const [screen] = await db.insert(schema.screens).values({
		eventId,
		name: 'Program',
		slug: `program-${eventId}`,
		currentMode: 'broadcast-graphics',
		modeConfigs: { 'broadcast-graphics': stack },
		assetCapabilitySeed: `seed-${eventId}`,
		assetCapabilityDigest: `digest-${eventId}`,
	} as never).returning();

	return {
		eventId,
		screenId: screen!.id,
		assetCapabilityDigest: `digest-${eventId}`,
	};
}

/**
 * `command-1`, `command-2`, … — the ids a Live Control client stamps on the commands
 * it issues.
 *
 * The sequenced live state replays an already-committed command id idempotently and
 * answers a reused id carrying different content with a 409, so a test that repeats an
 * id is not issuing a second command. The counter is what keeps them distinct.
 */
export function createCommandIdSequence(): () => string {
	let issued = 0;
	return () => `command-${++issued}`;
}
