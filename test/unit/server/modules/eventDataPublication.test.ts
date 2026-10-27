import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REALTIME_MESSAGE_BYTES, realtimeMessageBytes } from '~~/shared/types/messages';
import { lastCallTo } from '~~/test/helpers/lastCallTo';

/** The storage ceiling a Screen's `modeConfigs` is bounded by, from the Screen schema. */
const MAX_MODE_CONFIGS_BYTES = 512 * 1024;

const mockPublishMessage = vi.fn();
const mockPublishMessageStrict = vi.fn();
const mockFeatureMatchService = {
	findById: vi.fn(),
	findByEventId: vi.fn(),
};
const mockRefreshBindings = vi.fn();

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: mockRefreshBindings,
}));
vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
	publishMessageStrict: mockPublishMessageStrict,
}));
vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));

const { eventDataPublicationModule } = await import('~~/server/modules/event-data-publication');

const NOW = new Date('2026-01-01T00:00:00.000Z');
const origin = 'origin-1';

function row(overrides: Record<string, unknown>) {
	return {
		id: 1,
		eventId: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	} as any;
}

const phase = row({
	id: 2,
	name: 'Swiss',
	sortOrder: 0,
	externalId: null,
	externalSource: 'manual',
});
const round = row({
	id: 3,
	phaseId: 2,
	name: 'Round 3',
	roundNumber: 3,
	controlMode: 'default',
	externalId: null,
	externalSource: 'manual',
	lastSyncedAt: null,
});
const talent = row({
	id: 5,
	name: 'Casey',
	twitchHandle: 'CaseyLive',
	youtubeHandle: null,
	xHandle: null,
	instagramHandle: null,
	tiktokHandle: null,
	blueskyHandle: null,
});
const player = row({
	id: 6,
	name: 'Alice',
	pronouns: null,
	isActive: true,
	archetypeId: null,
	gameData: null,
	externalId: null,
	externalSource: null,
});
const playerList = row({ id: 10, name: 'Featured Players' });
const archetype = row({ id: 11, name: 'Izzet Prowess', colors: 'UR' });
const match = row({
	id: 7,
	roundId: 3,
	tableNumber: 12,
	player1Id: 101,
	player2Id: 102,
	player1Data: null,
	player2Data: null,
	player1Wins: 1,
	player2Wins: 0,
	draws: 0,
	status: 'pending',
	sortOrder: 0,
	externalId: null,
	externalSource: 'manual',
});
const slot = row({
	id: 4,
	matchId: 7,
	tableNumber: 12,
	player1Id: 101,
	player2Id: 102,
	player1Data: null,
	player2Data: null,
	bestOf: 3,
	sortOrder: 0,
	playerDisplayMode: 'score',
	activeSessionId: null,
	roundName: null,
	formatName: null,
	externalId: null,
	externalSource: null,
});
const assignment = row({
	id: 9,
	roundId: 3,
	slotId: 4,
	matchId: 7,
	note: 'Production note',
});
const screen = row({
	id: 8,
	name: 'Main Screen',
	slug: 'main-screen',
	currentMode: 'feature-match',
	modeConfigs: {},
	screenConfig: {},
	stateVersion: 3,
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('the realtime message each Event Data change sends', () => {
	const publication = () => eventDataPublicationModule();

	it.each([
		[
			'phaseCreated',
			{ entity: phase },
			'phase:created',
			{
				phase: expect.objectContaining({ id: 2 }),
			},
		],
		[
			'phaseUpdated',
			{ entity: phase },
			'phase:updated',
			{
				phase: expect.objectContaining({ id: 2 }),
			},
		],
		[
			'roundCreated',
			{ entity: round },
			'round:created',
			{
				round: expect.objectContaining({ id: 3 }),
			},
		],
		[
			'talentCreated',
			{ entity: talent },
			'talent:created',
			{
				talent: expect.objectContaining({ id: 5 }),
			},
		],
		[
			'playerCreated',
			{ entity: player },
			'player:created',
			{
				player: expect.objectContaining({ id: 6 }),
			},
		],
		[
			'playerUpdated',
			{ entity: player },
			'player:updated',
			{
				player: expect.objectContaining({ id: 6 }),
			},
		],
		[
			'playerDeleted',
			{ id: 6 },
			'player:deleted',
			{ playerId: 6 },
		],
		[
			'playerListCreated',
			{ entity: playerList },
			'playerList:created',
			{
				playerList: expect.objectContaining({ id: 10 }),
			},
		],
		[
			'archetypeUpdated',
			{ entity: archetype, keyCards: [] },
			'archetype:updated',
			{
				archetype: expect.objectContaining({ id: 11, keyCards: [] }),
			},
		],
		[
			'matchCreated',
			{ entity: match },
			'match:created',
			{
				match: expect.objectContaining({ id: 7 }),
			},
		],
		[
			'featureMatchSlotUpdated',
			{ entity: slot },
			'featureMatch:updated',
			{
				featureMatch: expect.objectContaining({ id: 4 }),
			},
		],
		[
			'featureMatchAssignmentCreated',
			{ entity: assignment },
			'featureMatchAssignment:created',
			{
				featureMatchAssignment: expect.objectContaining({ id: 9 }),
			},
		],
		[
			'phaseDeleted',
			{ id: 2 },
			'phase:deleted',
			{ phaseId: 2 },
		],
		[
			'roundUpdated',
			{ entity: round },
			'round:updated',
			{
				round: expect.objectContaining({ id: 3 }),
			},
		],
		[
			'roundDeleted',
			{ id: 3 },
			'round:deleted',
			{ roundId: 3 },
		],
		[
			'talentUpdated',
			{ entity: talent },
			'talent:updated',
			{
				talent: expect.objectContaining({
					id: 5,
					socialProfiles: { twitch: 'CaseyLive' },
				}),
			},
		],
		[
			'talentDeleted',
			{ id: 5 },
			'talent:deleted',
			{ talentId: 5 },
		],
		[
			'playerListUpdated',
			{ entity: playerList },
			'playerList:updated',
			{
				playerList: expect.objectContaining({ id: 10 }),
			},
		],
		[
			'playerListDeleted',
			{ id: 10 },
			'playerList:deleted',
			{ listId: 10 },
		],
		[
			'playerListMembersChanged',
			{
				listId: 10,
				playerIds: [101, 102],
				action: 'reordered',
				memberCount: 2,
			},
			'playerList:membersChanged',
			{
				listId: 10,
				playerIds: [101, 102],
				action: 'reordered',
				memberCount: 2,
			},
		],
		[
			'archetypeCreated',
			{ entity: archetype },
			'archetype:created',
			{
				archetype: expect.objectContaining({ id: 11, keyCards: [] }),
			},
		],
		[
			'archetypeDeleted',
			{ id: 11 },
			'archetype:deleted',
			{ archetypeId: 11 },
		],
		[
			'archetypeKeyCardsUpdated',
			{ archetypeId: 11, keyCards: [] },
			'archetype:keyCardsUpdated',
			{ archetypeId: 11, keyCards: [] },
		],
		[
			'matchUpdated',
			{ entity: match },
			'match:updated',
			{
				match: expect.objectContaining({ id: 7 }),
			},
		],
		[
			'matchDeleted',
			{ id: 7 },
			'match:deleted',
			{ matchId: 7 },
		],
		[
			'featureMatchSlotCreated',
			{ entity: slot },
			'featureMatch:created',
			{
				featureMatch: expect.objectContaining({ id: 4 }),
			},
		],
		[
			'featureMatchSlotDeleted',
			{ id: 4 },
			'featureMatch:deleted',
			{ featureMatchId: 4 },
		],
		[
			'featureMatchSlotsReordered',
			{
				slots: [
					{ matchId: 4, sortOrder: 1 },
				],
			},
			'featureMatch:reordered',
			{
				featureMatches: [
					{ featureMatchId: 4, sortOrder: 1 },
				],
			},
		],
		[
			'featureMatchAssignmentUpdated',
			{ entity: assignment },
			'featureMatchAssignment:updated',
			{
				featureMatchAssignment: expect.objectContaining({ id: 9, note: 'Production note' }),
			},
		],
		[
			'featureMatchAssignmentDeleted',
			{ id: 9 },
			'featureMatchAssignment:deleted',
			{ featureMatchAssignmentId: 9 },
		],
		[
			'eventDeleted',
			{},
			'event:deleted',
			{ eventId: 1 },
		],
		[
			'roundMatchesRefreshed',
			{
				roundId: 3,
				matchCount: 4,
				created: 2,
				updated: 1,
				staleDeleted: 1,
			},
			'round:matchesRefreshed',
			{
				roundId: 3,
				matchCount: 4,
				created: 2,
				updated: 1,
				staleDeleted: 1,
			},
		],
		[
			'meleeDataReset',
			{ reason: 'event-changed' },
			'melee:dataReset',
			{ reason: 'event-changed' },
		],
		[
			'playerDeckCardsResolved',
			{
				deckIds: [101, 102],
				playerIds: [7],
			},
			'playerDeck:cardsResolved',
			{
				deckIds: [101, 102],
				playerIds: [7],
			},
		],
	] as const)('%s sends %s under the writer\'s origin', async (method, input, type, payload) => {
		await (publication() as any)[method]({ eventId: 1, originConnectionId: origin, ...input });

		expect(mockPublishMessage).toHaveBeenCalledWith(1, type, payload, origin);
	});

	// A sync summary is published strictly, so the caller can report a lost notification.
	it.each([
		[
			'meleePlayersSynced',
			{ playerCount: 12 },
			'melee:playersSynced',
		],
		[
			'meleeDeckListsSynced',
			{ playerCount: 16, deckCount: 16 },
			'melee:decklistsSynced',
		],
		[
			'meleeStructureSynced',
			{
				phaseCount: 1,
				roundCount: 1,
				changes: {
					phases: {
						created: [2],
						updated: [],
						deleted: [],
					},
					rounds: { created: [], updated: [], deleted: [] },
				},
			},
			'melee:structureSynced',
		],
		[
			'meleeFeatureMatchesSynced',
			{
				slotIds: [7, 8],
			},
			'melee:featureMatchesSynced',
		],
		[
			'meleeMatchResultsSynced',
			{
				roundId: 3,
				matchIds: [11, 12],
			},
			'melee:matchResultsSynced',
		],
		[
			'meleePairingsSynced',
			{ roundId: 3 },
			'melee:pairingsSynced',
		],
		[
			'meleeRoundStandingsSynced',
			{ roundId: 3 },
			'melee:roundStandingsSynced',
		],
		[
			'meleeRoundSynced',
			{
				roundId: 3,
				matchCount: 4,
				created: 2,
				updated: 1,
				staleDeleted: 1,
			},
			'melee:roundSynced',
		],
	] as const)('%s sends %s strictly, carrying the summary as given', async (method, summary, type) => {
		await (publication() as any)[method]({ eventId: 1, originConnectionId: origin, ...summary });

		expect(mockPublishMessageStrict).toHaveBeenCalledWith(1, type, summary, origin);
	});

	it('names the message type when a strict Melee Sync notification fails', async () => {
		const cause = new Error('Ably unavailable');
		mockPublishMessageStrict.mockRejectedValueOnce(cause);

		await expect(publication().meleePlayersSynced({ eventId: 1, playerCount: 12 }))
			.rejects
			.toMatchObject({ name: 'RealtimePublicationError', messageType: 'melee:playersSynced', cause });
	});
});

it('publishes an Event without its Melee credentials', async () => {
	const event = await eventDataPublicationModule().eventUpdated({
		eventId: 1,
		entity: row({
			name: 'Regional Championship',
			game: 'mtg',
			meleeClientId: 'client-id',
			meleeClientSecret: 'client-secret',
			talents: [],
		}),
		originConnectionId: origin,
	});

	expect(event).toMatchObject({ meleeConfigured: true });
	expect(event).not.toHaveProperty('meleeClientId');
	expect(event).not.toHaveProperty('meleeClientSecret');
	const [, , payload] = lastCallTo(mockPublishMessage, call => call[1] === 'event:updated');
	expect(JSON.stringify(payload)).not.toContain('client-secret');
});

it('publishes a reviewed Deck List under its Archetype\'s name, keeping what was submitted', async () => {
	const deck = await eventDataPublicationModule().playerDeckReviewed({
		eventId: 1,
		entity: row({
			id: 20,
			playerId: 4,
			externalId: 'deck-20',
			externalSource: 'melee',
			formatExternalId: 'modern',
			name: 'Imported Deck',
			colors: 'UR',
			sortOrder: 0,
			isPrimary: true,
			archetypeId: 7,
			reviewedAt: NOW,
		}),
		archetype: row({ id: 7, name: 'Reviewed Control', colors: 'WU' }),
		originConnectionId: origin,
	});

	expect(deck).toMatchObject({
		name: 'Reviewed Control',
		colors: 'WU',
		submittedName: 'Imported Deck',
		submittedColors: 'UR',
	});
	expect(mockPublishMessage).toHaveBeenCalledWith(1, 'playerDeck:reviewed', { deck }, origin);
});

describe('a batch of Feature Match Slot updates', () => {
	it('reads the Event\'s Slots once and announces each one that still exists', async () => {
		mockFeatureMatchService.findByEventId.mockResolvedValueOnce([
			slot,
			{ ...slot, id: 6, matchId: null },
		]);

		const published = await eventDataPublicationModule().featureMatchSlotsUpdated({
			eventId: 1,
			slotIds: [4, 5, 6],
			originConnectionId: origin,
		});

		expect(mockFeatureMatchService.findByEventId).toHaveBeenCalledOnce();
		expect(mockFeatureMatchService.findById).not.toHaveBeenCalled();
		expect(published.map(entry => entry.id)).toEqual([4, 6]);
		expect(mockPublishMessage.mock.calls.map(call => [call[1], call[2].featureMatch.id])).toEqual([
			['featureMatch:updated', 4],
			['featureMatch:updated', 6],
		]);
	});

	it('reads nothing when no Slot was affected', async () => {
		await expect(eventDataPublicationModule().featureMatchSlotsUpdated({ eventId: 1, slotIds: [] })).resolves.toEqual([]);
		expect(mockFeatureMatchService.findByEventId).not.toHaveBeenCalled();
	});
});

describe('a Screen change is announced rather than shipped', () => {
	// modeConfigs may reach 512 KiB; a realtime message is far smaller (#95).
	const atStorageCeiling = row({
		...screen,
		modeConfigs: {
			'broadcast-graphics': {
				graphics: [
					{
						id: 'lower-third',
						items: [
							{
								id: 'bed',
								text: 'T'.repeat(MAX_MODE_CONFIGS_BYTES - 200),
							},
						],
					},
				],
			},
		},
	});

	it.each([
		['screenCreated', 'screen:created'],
		['screenUpdated', 'screen:updated'],
	] as const)('%s names the Screen so the notification fits the realtime limit', async (method, type) => {
		await eventDataPublicationModule()[method]({ eventId: 1, entity: atStorageCeiling });

		const [, , payload] = lastCallTo(mockPublishMessage, call => call[1] === type);
		expect(realtimeMessageBytes(1, type, payload as never)).toBeLessThan(MAX_REALTIME_MESSAGE_BYTES);
		expect(payload).toEqual({ screenId: 8 });
	});

	it('still answers its HTTP caller with the whole Screen', async () => {
		const answered = await eventDataPublicationModule().screenUpdated({ eventId: 1, entity: atStorageCeiling });

		expect(answered.modeConfigs).toEqual(atStorageCeiling.modeConfigs);
	});

	it('announces a deletion by id', async () => {
		await eventDataPublicationModule().screenDeleted({ eventId: 1, id: 8, originConnectionId: origin });

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'screen:deleted', { screenId: 8 }, origin);
	});
});

describe('broadcast Deck List notifications', () => {
	it('carry only identity and revision, while the caller gets the whole document', async () => {
		const entity = {
			id: 11,
			eventId: 1,
			revision: 7,
			sourceText: '1 Island\n'.repeat(8_000),
		} as any;

		await expect(eventDataPublicationModule().broadcastDeckListUpdated({ eventId: 1, entity, originConnectionId: origin })).resolves.toBe(entity);

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'broadcastDeckList:updated', { listId: 11, revision: 7 }, origin);
	});

	it.each([
		[
			'broadcastDeckListCreated',
			{
				entity: { id: 11, revision: 1 },
			},
			'broadcastDeckList:created',
			{ listId: 11, revision: 1 },
		],
		[
			'broadcastDeckListDeleted',
			{ id: 11 },
			'broadcastDeckList:deleted',
			{ listId: 11 },
		],
	] as const)('%s sends its lightweight shape', async (method, input, type, payload) => {
		await (eventDataPublicationModule() as any)[method]({ eventId: 1, ...input });

		expect(mockPublishMessage).toHaveBeenCalledWith(1, type, payload, undefined);
	});
});

describe('re-resolving Broadcast Graphic bindings', () => {
	it('catches bound graphics up on Event Data a binding may read, without the writer\'s origin', async () => {
		// The re-resolution is nobody's edit, so the writer's own client must hear it too.
		await eventDataPublicationModule().roundUpdated({ eventId: 1, entity: round, originConnectionId: origin });

		expect(mockRefreshBindings.mock.calls).toEqual([
			[1],
		]);
	});

	it('catches them up on a Melee Sync summary', async () => {
		await eventDataPublicationModule().meleePlayersSynced({ eventId: 1, playerCount: 120 });

		expect(mockRefreshBindings).toHaveBeenCalledWith(1);
	});

	it('catches them up once for a whole batch of Feature Match Slots', async () => {
		mockFeatureMatchService.findByEventId.mockResolvedValue([
			slot,
			{ ...slot, id: 5 },
			{ ...slot, id: 6 },
		]);

		await eventDataPublicationModule().featureMatchSlotsUpdated({
			eventId: 1,
			slotIds: [4, 5, 6],
		});

		expect(mockRefreshBindings.mock.calls).toEqual([
			[1],
		]);
	});

	it.each([
		[
			'a Screen',
			'screenUpdated',
			{ entity: screen },
		],
		[
			'a player list',
			'playerListUpdated',
			{ entity: playerList },
		],
		[
			'resolved deck cards',
			'playerDeckCardsResolved',
			{
				deckIds: [1],
				playerIds: [1],
			},
		],
	] as const)('leaves them alone for %s, which no binding can read', async (_label, method, input) => {
		await (eventDataPublicationModule() as any)[method]({ eventId: 1, ...input });

		expect(mockRefreshBindings).not.toHaveBeenCalled();
	});
});
