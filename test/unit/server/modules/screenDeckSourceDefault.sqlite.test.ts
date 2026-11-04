import type { Game, ScreenMode } from '~~/shared/types/enums';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Deck List Screen on a One Piece Card Game Event with no Deck Source chosen
 * starts on the Event's first Slot, left side (ADR-0057); a Player chosen stays
 * (ADR-0074). A Magic Deck List Screen keeps its Player source.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({
		screenCreated: async ({ entity }: { entity: unknown }) => entity,
		screenUpdated: async ({ entity }: { entity: unknown }) => entity,
	}),
}));

const { screenWriteModule } = await import('~~/server/modules/screen-write');

let screens = 0;

/** Each Screen's own capability: its digest is unique. */
const capability = {
	prepare: async () => ({
		persisted: { assetCapabilitySeed: 'seed', assetCapabilityVersion: 1, assetCapabilityDigest: `digest-${screens}` },
	}),
};

/** Each Event, by what it plays and how many Slots it has; the first Slot by sort order is the second inserted. */
const events: Record<'mtg' | 'op' | 'opNoSlots', { id: number; firstSlotId: number | null; otherSlotId: number | null }> = {} as never;

async function seedEvent(game: Game, slots: boolean) {
	const [event] = await db.insert(schema.events).values({
		name: `${game} Event`,
		game,
		featureMatchOrientation: 'horizontal',
	}).returning({ id: schema.events.id });
	if (!slots)
		return { id: event!.id, firstSlotId: null, otherSlotId: null };
	const [other, first] = await db.insert(schema.featureMatchSlots).values([
		{ eventId: event!.id, sortOrder: 1 },
		{ eventId: event!.id, sortOrder: 0 },
	]).returning({ id: schema.featureMatchSlots.id });
	return { id: event!.id, firstSlotId: first!.id, otherSlotId: other!.id };
}

beforeAll(async () => {
	events.mtg = await seedEvent('mtg', true);
	events.op = await seedEvent('op', true);
	events.opNoSlots = await seedEvent('op', false);
});

afterAll(async () => await harness.close());

function createScreen(event: keyof typeof events, currentMode: ScreenMode, modeConfigs: Record<string, unknown> | null = null) {
	screens += 1;
	return screenWriteModule().createScreen({
		eventId: events[event].id,
		input: {
			name: `Screen ${screens}`,
			slug: `screen-${screens}`,
			currentMode,
			modeConfigs,
		} as never,
		screenOutputAssetCapabilities: () => capability as never,
	});
}

const firstSlotLeft = (event: keyof typeof events) => ({ type: 'featureMatchSlot', slotId: events[event].firstSlotId, side: 'player1' });

describe('a new Deck List Screen\'s Deck Source', () => {
	it.each([
		{
			event: 'op',
			shown: 'its first Slot, left side',
			expected: () => firstSlotLeft('op'),
		},
		{
			event: 'opNoSlots',
			shown: 'no Slot, left side',
			expected: () => firstSlotLeft('opNoSlots'),
		},
		{
			event: 'mtg',
			shown: 'the Player default',
			expected: () => undefined,
		},
	] as const)('on the $event Event starts on $shown', async ({ event, expected }) => {
		const screen = await createScreen(event, 'deck');

		expect(screen.modeConfigs?.deck?.deckSource).toEqual(expected());
	});

	it('defaults on a One Piece Event when an existing Screen switches to Deck', async () => {
		const background = await createScreen('op', 'background');
		expect(background.modeConfigs?.deck).toBeUndefined();

		const deck = await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId: events.op.id,
			screenId: background.id,
			input: { stateVersion: background.stateVersion, currentMode: 'deck' } as never,
		});

		expect(deck.modeConfigs?.deck?.deckSource).toEqual(firstSlotLeft('op'));
		expect(deck.currentMode).toBe('deck');
	});

	// A Deck List Screen already on air moves only when the operator moves it.
	it('leaves an existing Deck List Screen\'s source alone on any other save', async () => {
		const [stored] = await db.insert(schema.screens).values({
			eventId: events.op.id,
			name: 'Older Deck',
			slug: 'older-deck',
			currentMode: 'deck',
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: null },
				},
			},
			assetCapabilitySeed: 'seed',
			assetCapabilityVersion: 1,
			assetCapabilityDigest: 'older-deck-digest',
		}).returning();

		const renamed = await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId: events.op.id,
			screenId: stored!.id,
			input: { stateVersion: stored!.stateVersion, name: 'Renamed Deck' } as never,
		});

		expect(renamed.modeConfigs?.deck?.deckSource).toEqual({ type: 'player', playerId: null });
	});

	it.each([
		{
			name: 'on a new Screen',
			save: async (deckSource: unknown) => await createScreen('op', 'deck', {
				deck: { deckSource },
			}),
		},
		{
			name: 'when an existing Screen switches to Deck',
			save: async (deckSource: unknown) => {
				const background = await createScreen('op', 'background', {
					deck: { deckSource },
				});
				return await screenWriteModule().updateScreen({
					authoringSessionId: undefined,
					eventId: events.op.id,
					screenId: background.id,
					input: { stateVersion: background.stateVersion, currentMode: 'deck' } as never,
				});
			},
		},
	])('keeps a Player the operator chose $name', async ({ save }) => {
		const [player] = await db.insert(schema.players).values({ eventId: events.op.id, name: '', nickname: 'ana' }).returning({ id: schema.players.id });
		const chosen = { type: 'player', playerId: player!.id };

		const screen = await save(chosen);

		expect(screen.modeConfigs?.deck?.deckSource).toEqual(chosen);
	});

	it('keeps a Slot side the operator chose', async () => {
		const chosen = { type: 'featureMatchSlot', slotId: events.op.otherSlotId, side: 'player2' };

		const screen = await createScreen('op', 'deck', {
			deck: { deckSource: chosen, showCostCurve: false },
		});

		expect(screen.modeConfigs?.deck).toEqual({ deckSource: chosen, showCostCurve: false });
	});
});
