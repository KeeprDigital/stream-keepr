import type { OpLeader } from '~~/shared/types/game';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
import { fakeOpCardBulkLookup, knownOpCard, LAW, LUFFY, mockOpWriteBoundaries, NAMI, ZORO } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Slot side's Leader is picked on a One Piece Event and references the card
 * catalogue by number (ADR-0074). Changing it during a Feature Match Session
 * reaches that Session's source snapshot, and a swap keeps it with its player.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
const runtimeConfig = { bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' };
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const asKnownLeader = (leader: OpLeader) => knownOpCard({ ...leader, category: 'leader' });
const ZORO_CHARACTER = knownOpCard({
	number: 'OP01-025',
	name: 'Roronoa Zoro',
	category: 'character',
	colors: ['Red'],
});
const KNOWN = [
	asKnownLeader(ZORO),
	asKnownLeader(LAW),
	asKnownLeader(NAMI),
	asKnownLeader(LUFFY),
	ZORO_CHARACTER,
];
let upstream = fakeOpCardBulkLookup(KNOWN);
mockOpWriteBoundaries(db, () => upstream);

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

beforeEach(async () => {
	upstream = fakeOpCardBulkLookup(KNOWN);
	runtimeConfig.bandaiKeeprApiKey = 'test-key';
	// The catalogue is global, so each test starts it empty.
	await db.delete(schema.cards);
});

afterAll(async () => {
	await harness.close();
});

function side(name: string, sideLeader: OpLeader | null) {
	return {
		name,
		gameData: { type: 'op' as const, leader: sideLeader },
	};
}

/** Ana on Zoro and Ben on Law, both picked, in a Slot with an active Session. */
async function stageSession() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'One Piece Regional', game: 'op', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchSlotWriteModule().updateSetup({
		eventId,
		slotId: slot.id,
		input: {
			player1Data: side('Ana', ZORO),
			player2Data: side('Ben', LAW),
		},
	});
	upstream.reset();
	const session = (await featureMatchService().findById(slot.id, eventId))!.activeSession!;
	return { eventId, slotId: slot.id, session };
}

async function pickForAna(eventId: number, slotId: number, leader: OpLeader | null) {
	return await featureMatchSlotWriteModule().updateSetup({
		eventId,
		slotId,
		input: {
			player1Data: side('Ana', leader),
		},
	});
}

async function storedSides(slotId: number) {
	const slot = await db.query.featureMatches.findFirst({
		where: eq(schema.featureMatches.id, slotId),
	});
	return [slot!.player1Data?.gameData, slot!.player2Data?.gameData];
}

/** Which Leader each side of the Session shows, by player name. */
async function sessionLeaders(slotId: number, eventId: number) {
	const slot = await db.query.featureMatches.findFirst({
		where: and(eq(schema.featureMatches.id, slotId), eq(schema.featureMatches.eventId, eventId)),
	});
	const session = (await db.query.featureMatchSessions.findFirst({
		where: eq(schema.featureMatchSessions.id, slot!.activeSessionId!),
	}))!;
	const { player1, player2 } = session.sourceSnapshot;
	return {
		sessionId: session.id,
		player1: [player1.data?.name, player1.data?.gameData],
		player2: [player2.data?.name, player2.data?.gameData],
	};
}

describe('picking a Slot side\'s Leader', () => {
	it.each([
		{
			held: 'not yet catalogued',
			catalogued: [],
			lookups: [
				['OP01-016'],
			],
		},
		{
			held: 'already catalogued',
			catalogued: [NAMI],
			lookups: [],
		},
	])('saves a Leader $held to the catalogue, and the side references it by number', async ({ catalogued, lookups }) => {
		const { eventId, slotId } = await stageSession();
		for (const leader of catalogued)
			await pickForAna(eventId, slotId, leader);
		upstream.reset();

		// The form's copy of the card is not what the catalogue keeps: bandai-keepr's answer is.
		const answer = await pickForAna(eventId, slotId, { ...NAMI, name: 'Nami (stale form)' });

		expect(upstream.batches()).toEqual(lookups);
		expect(await storedSides(slotId)).toEqual([
			{
				type: 'op',
				leader: { number: 'OP01-016' },
			},
			{
				type: 'op',
				leader: { number: 'OP01-002' },
			},
		]);
		expect(answer.player1Data?.gameData).toEqual({ type: 'op', leader: NAMI });
	});

	it.each([
		{
			refused: 'a card that is not a Leader',
			leader: { ...ZORO, number: 'OP01-025' },
			configured: true,
			statusCode: 400,
		},
		{
			refused: 'a number bandai-keepr does not know',
			leader: { ...ZORO, number: 'OP99-999' },
			configured: true,
			statusCode: 400,
		},
		{
			refused: 'an uncatalogued Leader with no bandai-keepr configured',
			leader: NAMI,
			configured: false,
			statusCode: 503,
		},
	])('refuses $refused, keeping the side\'s Leader', async ({ leader, configured, statusCode }) => {
		const { eventId, slotId } = await stageSession();
		if (!configured)
			runtimeConfig.bandaiKeeprApiKey = '';

		await expect(pickForAna(eventId, slotId, leader)).rejects.toMatchObject({ statusCode });

		expect(await storedSides(slotId)).toEqual([
			{
				type: 'op',
				leader: { number: 'OP01-001' },
			},
			{
				type: 'op',
				leader: { number: 'OP01-002' },
			},
		]);
	});

	it.each([
		{ save: 'clears the side\'s Leader', leader: null },
		{ save: 'keeps a catalogued Leader', leader: ZORO },
	])('$save with no lookup, even with no bandai-keepr configured', async ({ leader }) => {
		const { eventId, slotId } = await stageSession();
		runtimeConfig.bandaiKeeprApiKey = '';

		const answer = await pickForAna(eventId, slotId, leader);

		expect(upstream.batches()).toEqual([]);
		expect(answer.player1Data?.gameData).toEqual({ type: 'op', leader });
	});

	it('shows on the Overlay\'s Deck, Deck Colours and Leader Image tokens as the picked card', async () => {
		const { eventId, slotId } = await stageSession();
		await pickForAna(eventId, slotId, LUFFY);

		const tokens = featureMatchTokenValues({
			event: {
				name: 'Regional',
				game: 'op',
				displayRecordSeparator: '-',
				displayHideZeroDraws: true,
				displayPositionFormat: 'ordinal',
			},
			featureMatch: mapFeatureMatchToResponse((await featureMatchService().findById(slotId, eventId))!),
			sourceMatch: null,
			round: null,
			phase: null,
		});

		expect([tokens.player1Deck, tokens.player1DeckColors, tokens.player1LeaderImage]).toEqual([
			'Monkey.D.Luffy',
			'Red/Green',
			'https://cards-img.keepr.digital/OP01-003.png',
		]);
	});
});

describe('a Slot side\'s Leader during a Feature Match Session', () => {
	it('reaches the Session\'s snapshot when changed, without reopening it', async () => {
		const { eventId, slotId, session } = await stageSession();

		await pickForAna(eventId, slotId, NAMI);

		expect(await sessionLeaders(slotId, eventId)).toEqual({
			sessionId: session.id,
			player1: [
				'Ana',
				{ type: 'op', leader: NAMI },
			],
			player2: [
				'Ben',
				{ type: 'op', leader: LAW },
			],
		});
	});

	it('stays with its player through a swap and a later change', async () => {
		const { eventId, slotId, session } = await stageSession();

		await featureMatchStateService().applyCommand(session.id, eventId, {
			commandId: 'swap',
			type: 'SwapPlayers',
			payload: {},
			baseSequence: session.sequence,
		});
		// The setup form saves in Slot order; the Session keeps the swap (ADR-0058).
		await pickForAna(eventId, slotId, NAMI);

		const leaders = await sessionLeaders(slotId, eventId);
		expect([leaders.player1, leaders.player2]).toEqual([
			[
				'Ben',
				{ type: 'op', leader: LAW },
			],
			[
				'Ana',
				{ type: 'op', leader: NAMI },
			],
		]);
	});
});
