import type { FeatureMatchSessionCommand } from '~~/shared/types/featureMatchSession';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
import { LAW, ZORO } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The Feature Match Session owns which side each player sits on; the Slot keeps
 * its pairing order (ADR-0058). Whatever the operator does after `SwapPlayers`,
 * the Overlay and the controls pair each player with their own live state.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

afterAll(async () => {
	await harness.close();
});

/** Ana and Ben seated by promoting a Melee Match. */
async function stageMtg() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Magic Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', sortOrder: 0 }).returning();
	const [round] = await db.insert(schema.rounds)
		.values({
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
		})
		.returning();
	const [ana, ben] = await db.insert(schema.players)
		.values([
			{ eventId, name: 'Ana' },
			{ eventId, name: 'Ben' },
		])
		.returning();
	const [match] = await db.insert(schema.matches)
		.values({
			eventId,
			roundId: round!.id,
			tableNumber: 1,
			sortOrder: 0,
			player1Id: ana!.id,
			player2Id: ben!.id,
		})
		.returning();
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: slot.id, matchId: match!.id });
	return { eventId, slotId: slot.id };
}

/** Ana and Ben typed into the Slot, as a One Piece Event seats them (ADR-0057). */
async function stageOp() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'One Piece Regional', game: 'op', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [slot] = await db.insert(schema.featureMatches)
		.values({
			eventId,
			player1Data: {
				name: 'Ana',
				gameData: { type: 'op', leader: ZORO },
			},
			player2Data: {
				name: 'Ben',
				gameData: { type: 'op', leader: LAW },
			},
		})
		.returning();
	await featureMatchStateService().createSessionForSlot(slot!.id, eventId);
	return { eventId, slotId: slot!.id };
}

type Staged = Awaited<ReturnType<typeof stageMtg>>;

async function command({ eventId, slotId }: Staged, type: FeatureMatchSessionCommand['type'], payload: object = {}) {
	await featureMatchStateService().applyCommandToActiveSession(slotId, eventId, session => ({
		commandId: `${type}-${crypto.randomUUID()}`,
		type,
		payload,
		baseSequence: session.sequence,
	}) as FeatureMatchSessionCommand);
}

/** A setup save as the form sends it: sides in Slot order, Ana's pronouns edited. */
async function saveSetupEditingAna(staged: Staged) {
	const slot = (await featureMatchService().findById(staged.slotId, staged.eventId))!;
	const anaSide = slot.player1Data?.name === 'Ana'
		? 'player1Data'
		: 'player2Data';
	await featureMatchSlotWriteModule().updateSetup({
		eventId: staged.eventId,
		slotId: staged.slotId,
		input: {
			tableNumber: 9,
			[anaSide]: { ...slot[anaSide], pronouns: 'she/her' },
		},
	});
}

async function saveSetupWithNoSide(staged: Staged) {
	await featureMatchSlotWriteModule().updateSetup({
		eventId: staged.eventId,
		slotId: staged.slotId,
		input: { tableNumber: 9 },
	});
}

/** Each side, left then right, as the Overlay and as the controls show it. */
async function seats({ eventId, slotId }: Staged) {
	const slot = mapFeatureMatchToResponse((await featureMatchService().findById(slotId, eventId))!);
	const { sourceSnapshot, currentState } = slot.activeSession!;
	const tokens = featureMatchTokenValues({
		event: {
			name: 'Open',
			game: 'mtg',
			displayRecordSeparator: '-',
			displayHideZeroDraws: true,
			displayPositionFormat: 'ordinal',
		},
		featureMatch: slot,
		sourceMatch: null,
		round: null,
		phase: null,
	});
	const named = (name?: string | null, pronouns?: string | null) => pronouns
		? `${name} (${pronouns})`
		: name;
	const live = (side: 'player1' | 'player2') => [
		`life ${currentState[side].lifeTotal}`,
		`wins ${currentState[side].gameWins}`,
		...currentState.activePlayer === side
			? ['active']
			: [],
		...currentState.firstPlayer === side
			? ['first']
			: [],
	].join(' ');
	return {
		overlay: (['player1', 'player2'] as const).map(side =>
			`${named(tokens[`${side}Name`], tokens[`${side}Pronouns`])}: ${live(side)}`),
		controls: (['player1', 'player2'] as const).map(side =>
			`${named(sourceSnapshot[side].data?.name, sourceSnapshot[side].data?.pronouns)}: ${live(side)}`),
	};
}

const ANA = 'Ana: life 7 wins 1 active first';
const ANA_EDITED = 'Ana (she/her): life 7 wins 1 active first';
const BEN = 'Ben: life 13 wins 0';

describe.each([
	{ game: 'mtg', stage: stageMtg },
	{ game: 'op', stage: stageOp },
])('side order on a $game Event', ({ stage }) => {
	it.each([
		{
			path: 'a swap',
			steps: ['swap'],
			order: [BEN, ANA],
		},
		{
			path: 'a swap then a setup save editing a side',
			steps: ['swap', 'saveEditingAna'],
			order: [BEN, ANA_EDITED],
		},
		{
			path: 'a swap then a setup save sending no side',
			steps: ['swap', 'saveWithNoSide'],
			order: [BEN, ANA],
		},
		{
			path: 'a swap, a setup save, then a second swap',
			steps: ['swap', 'saveEditingAna', 'swap'],
			order: [ANA_EDITED, BEN],
		},
	] as const)('pairs each player with their own state after $path', async ({ steps, order }) => {
		const staged = await stage();
		await command(staged, 'RecordGameWin', { player: 'player1' });
		await command(staged, 'SetLife', { player: 'player1', lifeTotal: 7 });
		await command(staged, 'SetLife', { player: 'player2', lifeTotal: 13 });
		await command(staged, 'SetFirstPlayer', { player: 'player1' });
		await command(staged, 'SetActivePlayer', { player: 'player1' });

		for (const step of steps) {
			if (step === 'swap')
				await command(staged, 'SwapPlayers');
			else if (step === 'saveEditingAna')
				await saveSetupEditingAna(staged);
			else
				await saveSetupWithNoSide(staged);
		}

		expect(await seats(staged)).toEqual({ overlay: order, controls: order });
	});
});
