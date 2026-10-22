import type { EventReferenceKind } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { getDisplayDefaultsForMode } from '~~/shared/types/screenConfig';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Screen write refuses an Event Reference naming something outside the
 * Screen's Event, for every field a Screen Mode Definition declares (ADR-0038).
 * Run against real SQLite so "belongs to another Event" is what the services
 * and the Deck Source guard triggers read, not what a mock says.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const mockPublication = {
	screenCreated: vi.fn(async ({ entity }: { entity: unknown }) => entity),
	screenUpdated: vi.fn(async ({ entity }: { entity: unknown }) => entity),
};
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

const { screenService } = await import('~~/server/services/screen');
const { screenWriteModule } = await import('~~/server/modules/screen-write');

const provideUnusedGraphicsAssets = () => ({ inspectGraphicAssetRevisions: vi.fn() });
const capability = {
	assetCapabilitySeed: 'seed',
	assetCapabilityVersion: 1,
	assetCapabilityDigest: 'digest',
};
/** A create these tests refuse never reaches for a signing key. */
function provideNoCapability(): never {
	throw new Error('A refused create must not prepare a Screen Output Asset Capability');
}

interface EventEntities {
	phaseId: number;
	roundId: number;
	playerId: number;
	playerListId: number;
	featureMatchSlotId: number;
	archetypeId: number;
	broadcastDeckListId: number;
}

async function seedEventEntities(eventId: number, label: string): Promise<EventEntities> {
	const [phase] = await db.insert(schema.phases).values({ eventId, name: `${label} Phase` }).returning({ id: schema.phases.id });
	const [round] = await db.insert(schema.rounds).values({ eventId, phaseId: phase!.id, name: `${label} Round`, roundNumber: 1 }).returning({ id: schema.rounds.id });
	const [player] = await db.insert(schema.players).values({ eventId, name: `${label} Player` }).returning({ id: schema.players.id });
	const [list] = await db.insert(schema.playerLists).values({ eventId, name: `${label} List` }).returning({ id: schema.playerLists.id });
	const [slot] = await db.insert(schema.featureMatchSlots).values({ eventId }).returning({ id: schema.featureMatchSlots.id });
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: `${label} Archetype` }).returning({ id: schema.archetypes.id });
	const [deckList] = await db.insert(schema.broadcastDeckLists).values({
		eventId,
		name: `${label} Deck List`,
		normalizedName: `${label.toLowerCase()} deck list`,
		sourceText: '1 Island',
	}).returning({ id: schema.broadcastDeckLists.id });
	return {
		phaseId: phase!.id,
		roundId: round!.id,
		playerId: player!.id,
		playerListId: list!.id,
		featureMatchSlotId: slot!.id,
		archetypeId: archetype!.id,
		broadcastDeckListId: deckList!.id,
	};
}

let eventId: number;
let screenId: number;
let own: EventEntities;
let foreign: EventEntities;

interface Sample {
	name: string;
	/** The field's value naming one Event's entity; read once the Events are seeded. */
	naming: (entities: EventEntities) => unknown;
	/** How naming another Event's entity is refused. */
	refusal: Record<string, unknown>;
}

/** For each kind of Event Reference, the values a declared field may hold. A new kind fails to compile here until it has some. */
const SAMPLES: Record<EventReferenceKind, Sample[]> = {
	phase: [{ name: 'Phase', naming: e => e.phaseId, refusal: { statusCode: 404, message: 'Phase not found' } }],
	round: [{ name: 'Round', naming: e => e.roundId, refusal: { statusCode: 404, message: 'Round not found' } }],
	player: [{ name: 'Player', naming: e => e.playerId, refusal: { statusCode: 404, message: 'Player not found' } }],
	playerList: [{ name: 'Player List', naming: e => e.playerListId, refusal: { statusCode: 404, message: 'Player list not found' } }],
	featureMatchSlot: [{ name: 'Feature Match Slot', naming: e => e.featureMatchSlotId, refusal: { statusCode: 404, message: 'Feature match slot not found' } }],
	archetype: [{ name: 'Archetype', naming: e => e.archetypeId, refusal: { statusCode: 404, message: 'Archetype not found' } }],
	deckSource: [
		{ name: 'Player Deck Source', naming: e => ({ type: 'player', playerId: e.playerId }), refusal: { statusCode: 404, message: 'Player not found' } },
		{ name: 'Broadcast Deck Source', naming: e => ({ type: 'broadcast', broadcastDeckListId: e.broadcastDeckListId }), refusal: { statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' } },
	],
};

beforeAll(async () => {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{ name: 'Screen Event', game: 'mtg', featureMatchOrientation: 'horizontal', broadcastDeckListsEnabled: true },
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal', broadcastDeckListsEnabled: true },
	]).returning({ id: schema.events.id });
	eventId = event!.id;
	own = await seedEventEntities(eventId, 'Own');
	foreign = await seedEventEntities(otherEvent!.id, 'Foreign');

	const screen = await screenService().create(eventId, { name: 'Screen', slug: 'screen' } as never, capability);
	screenId = screen.id;
});

beforeEach(() => {
	mockPublication.screenCreated.mockClear();
	mockPublication.screenUpdated.mockClear();
});

afterAll(async () => await harness.close());

async function current() {
	return (await screenService().findById(screenId, eventId))!;
}

function saveModeConfig(mode: ScreenMode, config: Record<string, unknown>, stateVersion: number) {
	return screenWriteModule().updateModeConfig({
		authoringSessionId: undefined,
		eventId,
		screenId,
		mode,
		config,
		stateVersion,
		graphicsAssets: provideUnusedGraphicsAssets,
	});
}

const declaredFields = SCREEN_MODE_VALUES.flatMap(mode =>
	Object.entries(SCREEN_MODES[mode].eventReferences).map(([field, kind]) => ({ mode, field, kind, declared: `${mode}.${field}: ${kind}` })));

describe('screen Mode Event References', () => {
	it('declares every config field naming something in the Event', () => {
		expect(declaredFields.map(({ declared }) => declared)).toEqual([
			'card.featureMatchId: featureMatchSlot',
			'deck.deckSource: deckSource',
			'standings.roundId: round',
			'standings.playerListId: playerList',
			'top-cut.phaseId: phase',
			'feature-match.featureMatchId: featureMatchSlot',
			'feature-match-overlay.featureMatchId: featureMatchSlot',
			'metagame.playerListId: playerList',
			'top-cards.playerListId: playerList',
			'player-history.playerId: player',
			'pairings.roundId: round',
			'archetype-spotlight.archetypeId: archetype',
			'archetype-spotlight.playerListId: playerList',
			'head-to-head.featureMatchId: featureMatchSlot',
			'head-to-head.player1Id: player',
			'head-to-head.player2Id: player',
		]);
	});

	it('keeps every Event Reference through a display reset', () => {
		const reset = declaredFields.filter(({ mode, field }) => field in getDisplayDefaultsForMode(mode));
		expect(reset.map(({ declared }) => declared)).toEqual([]);
	});

	it('refuses saving a Most Played Cards Screen whose Player List belongs to another Event, as for Metagame', async () => {
		for (const mode of ['top-cards', 'metagame'] as const) {
			const before = await current();
			await expect(saveModeConfig(mode, { playerListId: foreign.playerListId }, before.stateVersion))
				.rejects
				.toMatchObject({ statusCode: 404, message: 'Player list not found' });
			expect((await current()).modeConfigs?.[mode]).toEqual(before.modeConfigs?.[mode]);
		}
		expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
	});

	describe.each(declaredFields)('$declared', ({ mode, field, kind }) => {
		it.each(SAMPLES[kind].map((sample, index) => ({ ...sample, index })))(
			'refuses a $name from another Event on every Screen write',
			async ({ naming, refusal, index }) => {
				const value = naming(foreign);
				const before = await current();
				const modeConfigs = { [mode]: { [field]: value } };

				await expect(saveModeConfig(mode, { [field]: value }, before.stateVersion)).rejects.toMatchObject(refusal);
				await expect(screenWriteModule().updateScreen({
					authoringSessionId: undefined,
					eventId,
					screenId,
					input: { stateVersion: before.stateVersion, modeConfigs } as never,
				})).rejects.toMatchObject(refusal);
				await expect(screenWriteModule().createScreen({
					eventId,
					input: { name: 'Refused', slug: `refused-${mode}-${field}-${index}`, modeConfigs } as never,
					screenOutputAssetCapabilities: provideNoCapability as never,
				})).rejects.toMatchObject(refusal);

				expect((await current()).stateVersion).toBe(before.stateVersion);
				expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
				expect(mockPublication.screenCreated).not.toHaveBeenCalled();
			},
		);

		it.each(SAMPLES[kind])('accepts a $name from the Screen\'s own Event', async ({ naming }) => {
			const before = await current();
			const saved = await saveModeConfig(mode, { [field]: naming(own) }, before.stateVersion);
			expect(saved.stateVersion).toBe(before.stateVersion + 1);
		});
	});
});
