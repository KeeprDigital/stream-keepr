import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Deleting a Feature Match Slot releases every Screen reference to it in the
// same write, and tells each released Screen to re-read itself, ahead of the
// delete's own announcement. Driven through the real writes; only Ably is faked.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { eventWriteModule } = await import('~~/server/modules/event-write');

beforeEach(() => ably.reset());
afterAll(async () => await harness.close());

let staged = 0;
/**
 * An Event of two Slots, the last in Slot order doomed, with a Screen per mode
 * naming the doomed Slot and an Overlay naming the kept one.
 */
async function stage() {
	const label = `release-${++staged}`;
	const [event] = await db.insert(schema.events)
		.values({
			name: label,
			game: 'op',
			featureMatchOrientation: 'horizontal',
			numFeatureMatches: 2,
		})
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [kept, doomed] = await db.insert(schema.featureMatches).values([
		{ eventId, tableNumber: 1, sortOrder: 0 },
		{ eventId, tableNumber: 2, sortOrder: 1 },
	]).returning({ id: schema.featureMatches.id });

	const screen = async (name: string, currentMode: ScreenMode, modeConfigs: ModeConfigsMap) => {
		const [row] = await db.insert(schema.screens)
			.values({
				eventId,
				name,
				slug: `${label}-${name}`,
				currentMode,
				modeConfigs,
				assetCapabilitySeed: `seed-${label}-${name}`,
				assetCapabilityDigest: `digest-${label}-${name}`,
			})
			.returning();
		return row!;
	};
	const naming = (slotId: number) => ({ featureMatchId: slotId });
	return {
		eventId,
		doomedSlotId: doomed!.id,
		released: {
			'overlay': await screen('overlay', 'feature-match-overlay', {
				'feature-match-overlay': naming(doomed!.id),
			}),
			'controls': await screen('controls', 'feature-match', {
				'feature-match': naming(doomed!.id),
			}),
			'head-to-head': await screen('head-to-head', 'head-to-head', {
				'head-to-head': {
					playerSource: 'featureMatchSlot',
					...naming(doomed!.id),
				},
			}),
			// A Deck Source and a reference at once: both releases rewrite this Screen.
			'deck': await screen('deck', 'deck', {
				deck: {
					deckSource: { type: 'featureMatchSlot', slotId: doomed!.id, side: 'player1' },
				},
				card: naming(doomed!.id),
			}),
		},
		bystander: await screen('bystander', 'feature-match-overlay', {
			'feature-match-overlay': naming(kept!.id),
		}),
	};
}

type Staged = Awaited<ReturnType<typeof stage>>;
type Heard = [type: string, payload: object];

const heardOn = (channel: string): Heard[] => ably.on(channel).map(({ type, payload }) => [type, payload]);
function screenUpdated(screenId: number): Heard {
	return [
		'screen:updated',
		{ screenId },
	];
}
const eventContextChanged: Heard = ['output:eventContextChanged', {}];

describe('deleting a Feature Match Slot releases the Screens naming it', () => {
	// Which mode configs name a Slot is the Screen Mode Definitions' to say (ADR-0038).
	it('covers every declared Feature Match Slot reference', () => {
		expect(SCREEN_MODE_VALUES.flatMap(mode => Object.entries(SCREEN_MODES[mode].eventReferences)
			.filter(([, kind]) => kind === 'featureMatchSlot')
			.map(([field]) => `${mode}.${field}`))).toEqual([
			'card.featureMatchId',
			'feature-match.featureMatchId',
			'feature-match-overlay.featureMatchId',
			'head-to-head.featureMatchId',
		]);
	});

	it.each<{
		name: string;
		remove: (staged: Staged) => Promise<unknown>;
		/** What the Event channel receives after the released Screens. */
		announced: (staged: Staged) => Heard[];
		/** What every Screen of the Event is told of the write itself, after its own release. */
		everyScreenTold: Heard[];
	}>([
		{
			name: 'deleting the Slot',
			remove: ({ eventId, doomedSlotId }) => featureMatchSlotWriteModule().remove({ eventId, slotId: doomedSlotId, originConnectionId: 'delete-origin' }),
			announced: ({ doomedSlotId }) => [
				[
					'featureMatch:deleted',
					{ featureMatchId: doomedSlotId, originConnectionId: 'delete-origin' },
				],
			],
			// Released, a Screen names no Slot: the delete itself is nothing it shows.
			everyScreenTold: [],
		},
		{
			name: 'lowering the Event\'s Slot count',
			remove: ({ eventId }) => eventWriteModule().updateEvent({
				eventId,
				input: { numFeatureMatches: 1 },
				originConnectionId: 'delete-origin',
			}),
			announced: () => [
				[
					'event:updated',
					expect.objectContaining({
						event: expect.objectContaining({ numFeatureMatches: 1 }),
					}),
				],
			],
			everyScreenTold: [eventContextChanged],
		},
	])('$name sets each reference to none in the same write and tells each Screen first', async ({ remove, announced, everyScreenTold }) => {
		const staged = await stage();
		const { eventId, doomedSlotId, released, bystander } = staged;

		await remove(staged);

		expect(await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.id, doomedSlotId))).toEqual([]);
		const stored = async (screenId: number) => (await db.select().from(schema.screens).where(eq(schema.screens.id, screenId)))[0]!;
		expect(Object.fromEntries(await Promise.all(Object.entries(released).map(async ([name, { id }]) => {
			const { stateVersion, modeConfigs } = await stored(id);
			return [
				name,
				{ stateVersion, modeConfigs },
			];
		})))).toEqual({
			'overlay': {
				stateVersion: released.overlay.stateVersion + 1,
				modeConfigs: {
					'feature-match-overlay': { featureMatchId: null },
				},
			},
			'controls': {
				stateVersion: released.controls.stateVersion + 1,
				modeConfigs: {
					'feature-match': { featureMatchId: null },
				},
			},
			'head-to-head': {
				stateVersion: released['head-to-head'].stateVersion + 1,
				modeConfigs: {
					'head-to-head': { playerSource: 'featureMatchSlot', featureMatchId: null },
				},
			},
			'deck': {
				stateVersion: released.deck.stateVersion + 2,
				modeConfigs: {
					deck: {
						deckSource: { type: 'featureMatchSlot', slotId: null, side: 'player1' },
					},
					card: { featureMatchId: null },
				},
			},
		});
		expect(await stored(bystander.id)).toEqual(bystander);

		// Each released Screen once, with no origin: the deleting client holds it at its old version too.
		const releasedIds = Object.values(released).map(({ id }) => id);
		const onEvent = heardOn(eventRealtimeChannel(eventId));
		expect(onEvent.slice(0, releasedIds.length).toSorted(([, a], [, b]) => (a as { screenId: number }).screenId - (b as { screenId: number }).screenId))
			.toEqual(releasedIds.map(screenUpdated));
		expect(onEvent.slice(releasedIds.length)).toEqual(announced(staged));

		expect(Object.fromEntries([...releasedIds, bystander.id].map(id => [
			id,
			heardOn(screenRealtimeChannel(eventId, id)),
		]))).toEqual({
			...Object.fromEntries(releasedIds.map(id => [
				id,
				[
					screenUpdated(id),
					...everyScreenTold,
				],
			])),
			[bystander.id]: everyScreenTold,
		});
	});
});
