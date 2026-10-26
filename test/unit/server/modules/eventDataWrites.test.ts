import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The Event Data write modules are glue: guard the references, write through the
 * service, then publish. The integration suite proves each write lands; this table
 * proves the three rules the glue itself owns across every module — a missing
 * entity is a 404 that publishes nothing, a refused reference never reaches the
 * write, and a committed write is published under the caller's origin.
 */

function serviceMock(...methods: string[]) {
	return Object.fromEntries(methods.map(method => [
		method,
		vi.fn(),
	])) as Record<string, ReturnType<typeof vi.fn>>;
}

const services = {
	phase: serviceMock('create', 'update', 'remove'),
	round: serviceMock('create', 'update', 'remove'),
	talent: serviceMock('create', 'update', 'remove'),
	match: serviceMock('create', 'update', 'remove'),
	slot: serviceMock('create', 'update', 'remove', 'swapMatchOrder'),
	playerList: serviceMock('create', 'update', 'remove', 'addMembers', 'removeMember', 'batchRemoveMembers', 'reorderMembers', 'getMemberCount'),
	featureMatchState: serviceMock('createSessionForSlot', 'applyCommand'),
};
const guards = serviceMock('requirePhaseInEvent', 'requireRoundInEvent', 'requirePlayersInEvent', 'validateFeatureMatchReferences');
const publication = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
	get: (target, name: string) => (target[name] ??= vi.fn(async (input: { entity?: unknown }) => ({ published: input.entity }))),
});
const refreshBroadcastGraphicsBindings = vi.fn();

vi.mock('~~/server/services/phase', () => ({
	phaseService: () => services.phase,
}));
vi.mock('~~/server/services/round', () => ({
	roundService: () => services.round,
}));
vi.mock('~~/server/services/talent', () => ({
	talentService: () => services.talent,
}));
vi.mock('~~/server/services/match', () => ({
	matchService: () => services.match,
}));
vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => services.slot,
}));
vi.mock('~~/server/services/playerList', () => ({
	playerListService: () => services.playerList,
}));
vi.mock('~~/server/services/featureMatchState', () => ({
	featureMatchStateService: () => services.featureMatchState,
}));
vi.mock('~~/server/utils/routeGuards', () => guards);
vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => publication,
}));
vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({ refreshBroadcastGraphicsBindings }));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string }) =>
	Object.assign(new Error(input.message), { statusCode: input.statusCode }));

const { phaseWriteModule } = await import('~~/server/modules/phase-write');
const { roundWriteModule } = await import('~~/server/modules/round-write');
const { talentWriteModule } = await import('~~/server/modules/talent-write');
const { matchWriteModule } = await import('~~/server/modules/match-write');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { playerListWriteModule } = await import('~~/server/modules/player-list-write');
const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');

const origin = 'origin-1';
const matchInput = { roundId: 2, player1Id: 3, player2Id: 4 } as never;

beforeEach(() => {
	for (const service of Object.values(services)) {
		for (const method of Object.values(service)) {
			method.mockResolvedValue({ id: 9 });
		}
	}
	services.playerList.getMemberCount!.mockResolvedValue(5);
	for (const guard of Object.values(guards)) {
		guard.mockResolvedValue(undefined);
	}
});

describe('a write to an entity the Event does not hold', () => {
	it.each([
		[
			'update a Phase',
			'phase',
			'update',
			() => phaseWriteModule().update({
				eventId: 1,
				phaseId: 9,
				input: {},
				originConnectionId: origin,
			}),
		],
		[
			'remove a Phase',
			'phase',
			'remove',
			() => phaseWriteModule().remove({ eventId: 1, phaseId: 9, originConnectionId: origin }),
		],
		[
			'update a Round',
			'round',
			'update',
			() => roundWriteModule().update({
				eventId: 1,
				roundId: 9,
				input: {} as never,
				originConnectionId: origin,
			}),
		],
		[
			'remove a Round',
			'round',
			'remove',
			() => roundWriteModule().remove({ eventId: 1, roundId: 9, originConnectionId: origin }),
		],
		[
			'update a Talent',
			'talent',
			'update',
			() => talentWriteModule().updateTalent({
				eventId: 1,
				talentId: 9,
				input: {},
				originConnectionId: origin,
			}),
		],
		[
			'delete a Talent',
			'talent',
			'remove',
			() => talentWriteModule().deleteTalent({ eventId: 1, talentId: 9, originConnectionId: origin }),
		],
		[
			'update a Match',
			'match',
			'update',
			() => matchWriteModule().update({
				eventId: 1,
				matchId: 9,
				input: matchInput,
				originConnectionId: origin,
			}),
		],
		[
			'remove a Match',
			'match',
			'remove',
			() => matchWriteModule().remove({ eventId: 1, matchId: 9, originConnectionId: origin }),
		],
		[
			'edit a Feature Match Slot',
			'slot',
			'update',
			() => featureMatchSlotWriteModule().updateSetup({
				eventId: 1,
				slotId: 9,
				input: {} as never,
				originConnectionId: origin,
			}),
		],
		[
			'remove a Feature Match Slot',
			'slot',
			'remove',
			() => featureMatchSlotWriteModule().remove({ eventId: 1, slotId: 9, originConnectionId: origin }),
		],
		[
			'update a player list',
			'playerList',
			'update',
			() => playerListWriteModule().updatePlayerList({
				eventId: 1,
				listId: 9,
				input: {},
				originConnectionId: origin,
			}),
		],
		[
			'delete a player list',
			'playerList',
			'remove',
			() => playerListWriteModule().deletePlayerList({ eventId: 1, listId: 9, originConnectionId: origin }),
		],
		[
			'remove a player list member',
			'playerList',
			'removeMember',
			() => playerListWriteModule().removePlayerListMember({
				eventId: 1,
				listId: 9,
				playerId: 3,
				originConnectionId: origin,
			}),
		],
	] as const)('refuses to %s with a 404 and publishes nothing', async (_label, service, method, write) => {
		services[service][method]!.mockResolvedValue(undefined);

		await expect(write()).rejects.toMatchObject({ statusCode: 404 });

		for (const publish of Object.values(publication)) {
			expect(publish).not.toHaveBeenCalled();
		}
	});
});

describe('a write naming a reference outside the Event', () => {
	it.each([
		[
			'create a Round',
			'requirePhaseInEvent',
			'round',
			'create',
			() => roundWriteModule().create({
				eventId: 1,
				input: { phaseId: 2 } as never,
			}),
		],
		[
			'update a Round',
			'requirePhaseInEvent',
			'round',
			'update',
			() => roundWriteModule().update({
				eventId: 1,
				roundId: 9,
				input: { phaseId: 2 } as never,
			}),
		],
		[
			'create a Match',
			'requireRoundInEvent',
			'match',
			'create',
			() => matchWriteModule().create({ eventId: 1, input: matchInput }),
		],
		[
			'update a Match',
			'requirePlayersInEvent',
			'match',
			'update',
			() => matchWriteModule().update({ eventId: 1, matchId: 9, input: matchInput }),
		],
		[
			'create a Feature Match Slot',
			'validateFeatureMatchReferences',
			'slot',
			'create',
			() => featureMatchSlotWriteModule().create({ eventId: 1, input: {} as never }),
		],
		[
			'edit a Feature Match Slot',
			'validateFeatureMatchReferences',
			'slot',
			'update',
			() => featureMatchSlotWriteModule().updateSetup({ eventId: 1, slotId: 9, input: {} as never }),
		],
	] as const)('cannot %s: the guard\'s refusal stops the write', async (_label, guard, service, method, write) => {
		guards[guard]!.mockRejectedValue(Object.assign(new Error('Not in this Event'), { statusCode: 404 }));

		await expect(write()).rejects.toMatchObject({ statusCode: 404 });
		expect(services[service][method]).not.toHaveBeenCalled();
	});
});

describe('a committed write', () => {
	it.each([
		[
			'creating a Phase',
			'phaseCreated',
			() => phaseWriteModule().create({ eventId: 1, input: {} as never, originConnectionId: origin }),
		],
		[
			'updating a Phase',
			'phaseUpdated',
			() => phaseWriteModule().update({
				eventId: 1,
				phaseId: 9,
				input: {},
				originConnectionId: origin,
			}),
		],
		[
			'removing a Phase',
			'phaseDeleted',
			() => phaseWriteModule().remove({ eventId: 1, phaseId: 9, originConnectionId: origin }),
		],
		[
			'creating a Round',
			'roundCreated',
			() => roundWriteModule().create({ eventId: 1, input: {} as never, originConnectionId: origin }),
		],
		[
			'updating a Round',
			'roundUpdated',
			() => roundWriteModule().update({
				eventId: 1,
				roundId: 9,
				input: {} as never,
				originConnectionId: origin,
			}),
		],
		[
			'removing a Round',
			'roundDeleted',
			() => roundWriteModule().remove({ eventId: 1, roundId: 9, originConnectionId: origin }),
		],
		[
			'creating a Talent',
			'talentCreated',
			() => talentWriteModule().createTalent({ eventId: 1, input: {} as never, originConnectionId: origin }),
		],
		[
			'updating a Talent',
			'talentUpdated',
			() => talentWriteModule().updateTalent({
				eventId: 1,
				talentId: 9,
				input: {},
				originConnectionId: origin,
			}),
		],
		[
			'deleting a Talent',
			'talentDeleted',
			() => talentWriteModule().deleteTalent({ eventId: 1, talentId: 9, originConnectionId: origin }),
		],
		[
			'creating a Match',
			'matchCreated',
			() => matchWriteModule().create({ eventId: 1, input: matchInput, originConnectionId: origin }),
		],
		[
			'updating a Match',
			'matchUpdated',
			() => matchWriteModule().update({
				eventId: 1,
				matchId: 9,
				input: matchInput,
				originConnectionId: origin,
			}),
		],
		[
			'removing a Match',
			'matchDeleted',
			() => matchWriteModule().remove({ eventId: 1, matchId: 9, originConnectionId: origin }),
		],
		[
			'creating a Feature Match Slot',
			'featureMatchSlotCreated',
			() => featureMatchSlotWriteModule().create({ eventId: 1, input: {} as never, originConnectionId: origin }),
		],
		[
			'editing a Feature Match Slot',
			'featureMatchSlotUpdated',
			() => featureMatchSlotWriteModule().updateSetup({
				eventId: 1,
				slotId: 9,
				input: {} as never,
				originConnectionId: origin,
			}),
		],
		[
			'removing a Feature Match Slot',
			'featureMatchSlotDeleted',
			() => featureMatchSlotWriteModule().remove({ eventId: 1, slotId: 9, originConnectionId: origin }),
		],
		[
			'reordering Feature Match Slots',
			'featureMatchSlotsReordered',
			() => featureMatchSlotWriteModule().reorder({
				eventId: 1,
				slotId: 9,
				direction: 'up',
				originConnectionId: origin,
			}),
		],
		[
			'creating a player list',
			'playerListCreated',
			() => playerListWriteModule().createPlayerList({ eventId: 1, input: {} as never, originConnectionId: origin }),
		],
		[
			'updating a player list',
			'playerListUpdated',
			() => playerListWriteModule().updatePlayerList({
				eventId: 1,
				listId: 9,
				input: {},
				originConnectionId: origin,
			}),
		],
		[
			'deleting a player list',
			'playerListDeleted',
			() => playerListWriteModule().deletePlayerList({ eventId: 1, listId: 9, originConnectionId: origin }),
		],
	] as const)('is published to the Event under the writer\'s origin after %s', async (_label, published, write) => {
		await write();

		expect(publication[published]).toHaveBeenCalledOnce();
		expect(publication[published]).toHaveBeenCalledWith(expect.objectContaining({ eventId: 1, originConnectionId: origin }));
	});

	it('answers with what publication returned, so callers see the published shape', async () => {
		await expect(phaseWriteModule().create({ eventId: 1, input: {} as never })).resolves.toEqual({
			published: { id: 9 },
		});
	});
});

describe('a player list membership change', () => {
	it.each([
		[
			'adding members',
			'added',
			[3, 4],
			() => playerListWriteModule().addPlayerListMembers({
				eventId: 1,
				listId: 9,
				playerIds: [3, 4],
				originConnectionId: origin,
			}),
		],
		[
			'removing one member',
			'removed',
			[3],
			() => playerListWriteModule().removePlayerListMember({
				eventId: 1,
				listId: 9,
				playerId: 3,
				originConnectionId: origin,
			}),
		],
		[
			'removing members in a batch',
			'removed',
			[3, 4],
			() => playerListWriteModule().batchRemovePlayerListMembers({
				eventId: 1,
				listId: 9,
				playerIds: [3, 4],
				originConnectionId: origin,
			}),
		],
		[
			'reordering members',
			'reordered',
			[4, 3],
			() => playerListWriteModule().reorderPlayerListMembers({
				eventId: 1,
				listId: 9,
				playerIds: [4, 3],
				originConnectionId: origin,
			}),
		],
	] as const)('announces and answers the count read after %s', async (_label, action, playerIds, write) => {
		const result = await write();

		expect(result).toMatchObject({ memberCount: 5 });
		expect(publication.playerListMembersChanged).toHaveBeenCalledWith(expect.objectContaining({
			listId: 9,
			playerIds,
			action,
			memberCount: 5,
			originConnectionId: origin,
		}));
	});
});

describe('the Feature Match Session module', () => {
	it('catches bound Broadcast Graphics up after a Session command, since that change bypasses Event Data publication', async () => {
		const result = { sequence: 2 };
		services.featureMatchState.applyCommand!.mockResolvedValue(result);

		await expect(featureMatchSessionModule().applyCommand(10, 1, {} as never, origin)).resolves.toBe(result);

		expect(refreshBroadcastGraphicsBindings).toHaveBeenCalledWith(1);
	});

	it('answers no Session when the Slot could not open one', async () => {
		services.featureMatchState.createSessionForSlot!.mockResolvedValue(null);

		await expect(featureMatchSessionModule().createSessionForSlot(2, 1, origin)).resolves.toBeNull();
	});
});
