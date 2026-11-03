import type { Mock } from 'vitest';
import type { MeleeEventParsed } from '~~/server/schemas/external/melee';
import type { EventReferenceKind } from '~~/shared/screenModes';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Deleting a Phase, Round or Archetype releases every Screen reference to it in
 * the same write, and announces each released Screen first, without an origin.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

/** Every publication, each a spy answering the entity it announced. */
const publication = new Proxy({} as Record<string, Mock>, {
	get: (spies, name: string) => spies[name] ??= vi.fn(async (input?: { entity?: unknown }) => input?.entity),
});
vi.doMock('~~/server/modules/event-data-publication', async importOriginal => ({
	...await importOriginal<object>(),
	eventDataPublicationModule: () => publication,
}));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: vi.fn(() => ({})),
}));

const { screenService } = await import('~~/server/services/screen');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { phaseWriteModule } = await import('~~/server/modules/phase-write');
const { roundWriteModule } = await import('~~/server/modules/round-write');
const { archetypeWriteModule } = await import('~~/server/modules/archetype-write');
const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');
const { eventService } = await import('~~/server/services/event');

beforeEach(() => vi.clearAllMocks());

afterAll(async () => await harness.close());

type ReleasedKind = Extract<EventReferenceKind, 'phase' | 'round' | 'archetype'>;

/** Every declared Event Reference to a Phase, Round or Archetype. */
const declared = SCREEN_MODE_VALUES.flatMap(mode =>
	Object.entries(SCREEN_MODES[mode].eventReferences).flatMap(([field, kind]) =>
		kind === 'phase' || kind === 'round' || kind === 'archetype'
			? [
					{ mode, field, kind: kind as ReleasedKind },
				]
			: []));

interface Records { phase: number; round: number; archetype: number }

let seeded = 0;
/**
 * An Event holding a doomed Phase (with its Round) and Archetype, and a kept
 * set; a Screen per declared reference names each set.
 */
async function seed(imported: boolean) {
	const label = `seed-${++seeded}`;
	const [event] = await db.insert(schema.events).values({
		name: label,
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'melee-1',
	}).returning({ id: schema.events.id });
	const eventId = event!.id;
	const records = async (name: string, externalId: string | null): Promise<Records> => {
		const provenance = externalId
			? { externalId, externalSource: 'melee' as const }
			: { externalId: null, externalSource: 'manual' as const };
		const [phase] = await db.insert(schema.phases).values({ eventId, name: `${name} Phase`, ...provenance }).returning();
		const [round] = await db.insert(schema.rounds).values({
			eventId,
			phaseId: phase!.id,
			name: `${name} Round`,
			roundNumber: 1,
			...provenance,
		}).returning();
		const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: `${name} Archetype` }).returning();
		return { phase: phase!.id, round: round!.id, archetype: archetype!.id };
	};
	const doomed = await records('Doomed', imported ? 'doomed' : null);
	const kept = await records('Kept', null);
	const screens = async (role: string, named: Records) => Promise.all(declared.map(async ({ mode, field, kind }) =>
		({
			mode,
			field,
			kind,
			screen: await screenService().create(eventId, {
				name: `${role} ${mode}.${field}`,
				slug: `${label}-${role}-${mode}-${field}`.toLowerCase(),
				currentMode: mode,
				modeConfigs: {
					[mode]: { [field]: named[kind] },
				},
			} as never, {
				assetCapabilitySeed: `seed-${label}-${role}-${mode}-${field}`,
				assetCapabilityVersion: 1,
				assetCapabilityDigest: `digest-${label}-${role}-${mode}-${field}`,
			}),
		})));
	return {
		eventId,
		doomed,
		selecting: await screens('Selecting', doomed),
		bystanders: await screens('Bystander', kept),
	};
}

type Seeded = Awaited<ReturnType<typeof seed>>;

const syncContext = { originConnectionId: 'delete-origin' };
const meleeEventData = {
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-1',
	meleeClientId: 'client',
	meleeClientSecret: 'secret',
};

describe('deleting a Phase, Round or Archetype releases the Screens naming it', () => {
	it('covers every declared Phase, Round and Archetype reference', () => {
		expect(declared.map(({ mode, field, kind }) => `${mode}.${field}: ${kind}`)).toEqual([
			'standings.roundId: round',
			'top-cut.phaseId: phase',
			'pairings.roundId: round',
			'archetype-spotlight.archetypeId: archetype',
		]);
	});

	it.each([
		{
			name: 'deleting a Round',
			imported: false,
			released: ['round'],
			remove: ({ eventId, doomed }: Seeded) => roundWriteModule().remove({ eventId, roundId: doomed.round, originConnectionId: 'delete-origin' }),
			announcement: 'roundDeleted',
		},
		{
			name: 'deleting a Phase, with the Rounds it cascades away',
			imported: false,
			released: ['phase', 'round'],
			remove: ({ eventId, doomed }: Seeded) => phaseWriteModule().remove({ eventId, phaseId: doomed.phase, originConnectionId: 'delete-origin' }),
			announcement: 'phaseDeleted',
		},
		{
			name: 'deleting an Archetype',
			imported: false,
			released: ['archetype'],
			remove: ({ eventId, doomed }: Seeded) => archetypeWriteModule().deleteArchetype({ eventId, archetypeId: doomed.archetype, originConnectionId: 'delete-origin' }),
			announcement: 'archetypeDeleted',
		},
		{
			name: 'a Melee Sync removing stale imported structure',
			imported: true,
			released: ['phase', 'round'],
			remove: ({ eventId }: Seeded) => createMeleeSyncWorkflows().syncEventStructure(syncContext, eventId, meleeEventData, {
				ID: 1,
				Name: 'Open',
				Game: 'Magic: The Gathering',
				Phases: [],
			} as unknown as MeleeEventParsed),
			announcement: 'meleeStructureSynced',
		},
	] as const)('$name clears each reference in the same write and announces each Screen first', async ({ imported, released, remove, announcement }) => {
		const seeded = await seed(imported);

		await remove(seeded);

		const isReleased = (kind: ReleasedKind) => (released as readonly ReleasedKind[]).includes(kind);
		for (const { mode, field, kind, screen } of seeded.selecting) {
			const stored = await screenService().findById(screen.id, seeded.eventId);
			if (isReleased(kind)) {
				expect(stored?.stateVersion, `${mode}.${field}`).toBe(screen.stateVersion + 1);
				expect(stored?.modeConfigs?.[mode], `${mode}.${field}`).not.toHaveProperty(field);
			}
			else {
				expect(stored, `${mode}.${field}`).toMatchObject({ stateVersion: screen.stateVersion, modeConfigs: screen.modeConfigs });
			}
		}
		for (const { screen } of seeded.bystanders) {
			expect(await screenService().findById(screen.id, seeded.eventId))
				.toMatchObject({ stateVersion: screen.stateVersion, modeConfigs: screen.modeConfigs });
		}

		const releasedIds = seeded.selecting.filter(({ kind }) => isReleased(kind)).map(({ screen }) => screen.id);
		// The deleting client holds these Screens at their old version too, so no origin.
		expect(publication.screenUpdated!.mock.calls.map(([input]) => input).toSorted((a, b) => a.entity.id - b.entity.id))
			.toEqual(releasedIds.map(id => ({
				eventId: seeded.eventId,
				entity: expect.objectContaining({ id }),
			})));
		const announced = publication[announcement]!.mock.invocationCallOrder[0]!;
		for (const order of publication.screenUpdated!.mock.invocationCallOrder)
			expect(order).toBeLessThan(announced);

		for (const { screen } of seeded.selecting) {
			const stored = (await screenService().findById(screen.id, seeded.eventId))!;
			await expect(screenWriteModule().updateScreen({
				authoringSessionId: undefined,
				eventId: seeded.eventId,
				screenId: screen.id,
				input: { stateVersion: stored.stateVersion, modeConfigs: stored.modeConfigs } as never,
			})).resolves.toMatchObject({ stateVersion: stored.stateVersion + 1 });
		}
	});

	it.each([
		{
			name: 'Round',
			remove: (eventId: number, ids: Records) => roundWriteModule().remove({ eventId, roundId: ids.round }),
		},
		{
			name: 'Phase',
			remove: (eventId: number, ids: Records) => phaseWriteModule().remove({ eventId, phaseId: ids.phase }),
		},
		{
			name: 'Archetype',
			remove: (eventId: number, ids: Records) => archetypeWriteModule().deleteArchetype({ eventId, archetypeId: ids.archetype }),
		},
	])('deleting the Event\'s last $name leaves a Screen naming none of its kind alone', async ({ remove }) => {
		const [event] = await db.insert(schema.events).values({ name: 'Last', game: 'mtg', featureMatchOrientation: 'horizontal' }).returning();
		const eventId = event!.id;
		const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Only' }).returning();
		const [round] = await db.insert(schema.rounds).values({
			eventId,
			phaseId: phase!.id,
			name: 'Only',
			roundNumber: 1,
		}).returning();
		const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Only' }).returning();
		const screen = await screenService().create(eventId, {
			name: 'Unset',
			slug: `unset-${eventId}`,
			modeConfigs: { 'standings': {}, 'top-cut': {}, 'archetype-spotlight': {} },
		} as never, { assetCapabilitySeed: `seed-unset-${eventId}`, assetCapabilityVersion: 1, assetCapabilityDigest: `digest-unset-${eventId}` });

		await remove(eventId, { phase: phase!.id, round: round!.id, archetype: archetype!.id });

		expect(await screenService().findById(screen.id, eventId)).toMatchObject({ stateVersion: screen.stateVersion, modeConfigs: screen.modeConfigs });
		expect(publication.screenUpdated).not.toHaveBeenCalled();
	});

	it('the Melee data reset clears references to the imported structure it deletes, and answers each Screen once', async () => {
		const seeded = await seed(true);
		// Also showing an imported Player's deck, so both of the reset's releases rewrite it.
		const [player] = await db.insert(schema.players)
			.values({
				eventId: seeded.eventId,
				name: 'Imported',
				externalId: 'p-1',
				externalSource: 'melee',
			})
			.returning({ id: schema.players.id });
		const standings = seeded.selecting.find(({ mode }) => mode === 'standings')!.screen;
		await db.update(schema.screens)
			.set({
				modeConfigs: {
					...standings.modeConfigs,
					deck: {
						deckSource: { type: 'player', playerId: player!.id },
					},
				} as never,
			})
			.where(eq(schema.screens.id, standings.id));

		const reset = await eventService().updateMeleeConfig(seeded.eventId, {
			meleeEnabled: false,
			meleeEventId: null,
			meleeClientId: null,
		});

		expect(await db.select().from(schema.phases).where(eq(schema.phases.id, seeded.doomed.phase))).toEqual([]);
		const releasedIds = seeded.selecting.filter(({ kind }) => kind !== 'archetype').map(({ screen }) => screen.id);
		expect(reset?.clearedScreens.map(screen => screen.id).toSorted((a, b) => a - b)).toEqual(releasedIds);
		expect(reset?.clearedScreens.find(screen => screen.id === standings.id)).toMatchObject({
			stateVersion: standings.stateVersion + 2,
			modeConfigs: {
				standings: {},
				deck: {
					deckSource: { type: 'player', playerId: null },
				},
			},
		});
		for (const { mode, field, kind, screen } of seeded.selecting) {
			const stored = await screenService().findById(screen.id, seeded.eventId);
			expect(stored?.modeConfigs?.[mode]?.[field as never], `${mode}.${field}`)
				.toBe(kind === 'archetype'
					? seeded.doomed.archetype
					: undefined);
		}
	});
});
