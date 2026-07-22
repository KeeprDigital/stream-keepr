import type { DbArchetype, DbEvent, DbEventTalent, DbFeatureMatch, DbMatch, DbPhase, DbPlayer, DbPlayerDeck, DbPlayerList, DbRound, DbScreen } from '~~/server/db/schema';
import type { ArchetypeKeyCard } from '~~/server/services/archetypeCard';
import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import { mapArchetypeToResponse } from '~~/server/mappers/archetype';
import { mapEventToResponse } from '~~/server/mappers/event';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { mapMatchToResponse } from '~~/server/mappers/match';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { mapPlayerDeckSummary } from '~~/server/mappers/playerDeck';
import { mapPlayerListToResponse } from '~~/server/mappers/playerList';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { mapTalentToResponse } from '~~/server/mappers/talent';
import { featureMatchService } from '~~/server/services/featureMatch';
import { publishMessage, publishMessageStrict } from '~~/server/utils/ably';

interface PublicationInput {
	eventId: number;
	originConnectionId?: string;
}

interface EntityPublicationInput<T> extends PublicationInput {
	entity: T;
}

interface DeletedPublicationInput extends PublicationInput {
	id: number;
}

interface FeatureMatchSlotsUpdatedInput extends PublicationInput {
	slotIds: number[];
}

interface FeatureMatchSlotsReorderedInput extends PublicationInput {
	slots: { matchId: number; sortOrder: number }[];
}

interface PlayerListMembersChangedInput extends PublicationInput {
	listId: number;
	playerIds: number[];
	action: 'added' | 'removed' | 'reordered';
	memberCount: number;
}

interface ArchetypePublicationInput extends EntityPublicationInput<DbArchetype> {
	keyCards?: ArchetypeKeyCard[];
}

interface PlayerDeckPublicationInput extends EntityPublicationInput<DbPlayerDeck> {
	archetype?: DbArchetype | null;
}

interface ArchetypeKeyCardsUpdatedInput extends PublicationInput {
	archetypeId: number;
	keyCards: ArchetypeKeyCard[];
}

type EventEntity = DbEvent & { talents: DbEventTalent[] };

interface RoundMatchesRefreshedInput extends PublicationInput {
	roundId: number;
	matchCount: number;
	created: number;
	updated: number;
	staleDeleted: number;
}

interface DeckListsSyncedInput extends PublicationInput {
	playerCount: number;
	deckCount: number;
}

interface PlayersSyncedInput extends PublicationInput {
	playerCount: number;
}

interface StructureSyncedInput extends PublicationInput, MessagePayload<'melee:structureSynced'> {}

interface FeatureMatchesSyncedInput extends PublicationInput, MessagePayload<'melee:featureMatchesSynced'> {}

interface MeleeRoundSyncedInput extends PublicationInput, MessagePayload<'melee:roundSynced'> {}

interface MeleeDataResetInput extends PublicationInput, MessagePayload<'melee:dataReset'> {}

export class RealtimePublicationError extends Error {
	constructor(
		public readonly messageType: MessageType,
		options: { cause: unknown },
	) {
		super(`Failed to publish realtime message "${messageType}"`, options);
		this.name = 'RealtimePublicationError';
	}
}

async function publishSyncMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T>,
	originConnectionId?: string,
) {
	try {
		await publishMessageStrict(eventId, messageType, payload, originConnectionId);
	}
	catch (error) {
		throw new RealtimePublicationError(messageType, { cause: error });
	}
}

function mapArchetypeKeyCard(card: ArchetypeKeyCard) {
	return {
		id: card.id,
		name: card.name,
		game: card.game,
		scryfallId: card.scryfallId,
		cardType: card.cardType,
		colors: card.colors,
		cmc: card.cmc,
		manaCost: card.manaCost,
	};
}

function mapArchetypeKeyCardPublication(archetypeId: number, card: ArchetypeKeyCard) {
	return {
		archetypeId,
		...mapArchetypeKeyCard(card),
		sortOrder: card.sortOrder,
	};
}

export function eventDataPublicationModule() {
	async function archetypeCreated({ eventId, entity, originConnectionId, keyCards = [] }: ArchetypePublicationInput) {
		const archetype = {
			...mapArchetypeToResponse(entity),
			keyCards: keyCards.map(mapArchetypeKeyCard),
		};
		await publishMessage(eventId, 'archetype:created', { archetype }, originConnectionId);
		return archetype;
	}

	async function archetypeUpdated({ eventId, entity, originConnectionId, keyCards = [] }: ArchetypePublicationInput) {
		const archetype = {
			...mapArchetypeToResponse(entity),
			keyCards: keyCards.map(mapArchetypeKeyCard),
		};
		await publishMessage(eventId, 'archetype:updated', { archetype }, originConnectionId);
		return archetype;
	}

	async function archetypeDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'archetype:deleted', { archetypeId: id }, originConnectionId);
	}

	async function archetypeKeyCardsUpdated({ eventId, archetypeId, keyCards, originConnectionId }: ArchetypeKeyCardsUpdatedInput) {
		const mappedKeyCards = keyCards.map(card => mapArchetypeKeyCardPublication(archetypeId, card));
		await publishMessage(eventId, 'archetype:keyCardsUpdated', {
			archetypeId,
			keyCards: mappedKeyCards,
		}, originConnectionId);
		return mappedKeyCards;
	}

	async function eventUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<EventEntity>) {
		const event = mapEventToResponse(entity);
		await publishMessage(eventId, 'event:updated', { event }, originConnectionId);
		return event;
	}

	async function eventDeleted({ eventId, originConnectionId }: PublicationInput) {
		await publishMessage(eventId, 'event:deleted', { eventId }, originConnectionId);
	}

	async function phaseCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPhase>) {
		const phase = mapPhaseToResponse(entity);
		await publishMessage(eventId, 'phase:created', { phase }, originConnectionId);
		return phase;
	}

	async function phaseUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPhase>) {
		const phase = mapPhaseToResponse(entity);
		await publishMessage(eventId, 'phase:updated', { phase }, originConnectionId);
		return phase;
	}

	async function phaseDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'phase:deleted', { phaseId: id }, originConnectionId);
	}

	async function playerCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPlayer>) {
		const player = mapPlayerToResponse(entity);
		await publishMessage(eventId, 'player:created', { player }, originConnectionId);
		return player;
	}

	async function playerUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPlayer>) {
		const player = mapPlayerToResponse(entity);
		await publishMessage(eventId, 'player:updated', { player }, originConnectionId);
		return player;
	}

	async function playerDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'player:deleted', { playerId: id }, originConnectionId);
	}

	async function playerListCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPlayerList>) {
		const playerList = mapPlayerListToResponse(entity);
		await publishMessage(eventId, 'playerList:created', { playerList }, originConnectionId);
		return playerList;
	}

	async function playerListUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPlayerList>) {
		const playerList = mapPlayerListToResponse(entity);
		await publishMessage(eventId, 'playerList:updated', { playerList }, originConnectionId);
		return playerList;
	}

	async function playerListDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'playerList:deleted', { listId: id }, originConnectionId);
	}

	async function playerListMembersChanged({ eventId, originConnectionId, ...payload }: PlayerListMembersChangedInput) {
		await publishMessage(eventId, 'playerList:membersChanged', payload, originConnectionId);
	}

	async function talentCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbEventTalent>) {
		const talent = mapTalentToResponse(entity);
		await publishMessage(eventId, 'talent:created', { talent }, originConnectionId);
		return talent;
	}

	async function talentUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbEventTalent>) {
		const talent = mapTalentToResponse(entity);
		await publishMessage(eventId, 'talent:updated', { talent }, originConnectionId);
		return talent;
	}

	async function talentDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'talent:deleted', { talentId: id }, originConnectionId);
	}

	async function roundCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbRound>) {
		const round = mapRoundToResponse(entity);
		await publishMessage(eventId, 'round:created', { round }, originConnectionId);
		return round;
	}

	async function roundUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbRound>) {
		const round = mapRoundToResponse(entity);
		await publishMessage(eventId, 'round:updated', { round }, originConnectionId);
		return round;
	}

	async function roundDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'round:deleted', { roundId: id }, originConnectionId);
	}

	async function matchCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbMatch>) {
		const match = mapMatchToResponse(entity);
		await publishMessage(eventId, 'match:created', { match }, originConnectionId);
		return match;
	}

	async function matchUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbMatch>) {
		const match = mapMatchToResponse(entity);
		await publishMessage(eventId, 'match:updated', { match }, originConnectionId);
		return match;
	}

	async function matchDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'match:deleted', { matchId: id }, originConnectionId);
	}

	async function featureMatchSlotCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbFeatureMatch>) {
		const featureMatch = mapFeatureMatchToResponse(entity);
		await publishMessage(eventId, 'featureMatch:created', { featureMatch }, originConnectionId);
		return featureMatch;
	}

	async function featureMatchSlotUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbFeatureMatch>) {
		const featureMatch = mapFeatureMatchToResponse(entity);
		await publishMessage(eventId, 'featureMatch:updated', { featureMatch }, originConnectionId);
		return featureMatch;
	}

	async function featureMatchSlotDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'featureMatch:deleted', { featureMatchId: id }, originConnectionId);
	}

	async function featureMatchSlotsReordered({ eventId, slots, originConnectionId }: FeatureMatchSlotsReorderedInput) {
		const featureMatches = slots.map(slot => ({ featureMatchId: slot.matchId, sortOrder: slot.sortOrder }));
		await publishMessage(eventId, 'featureMatch:reordered', { featureMatches }, originConnectionId);
		return featureMatches;
	}

	async function screenCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbScreen>) {
		const screen = mapScreenToResponse(entity);
		await publishMessage(eventId, 'screen:created', { screen }, originConnectionId);
		return screen;
	}

	async function screenUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbScreen>) {
		const screen = mapScreenToResponse(entity);
		await publishMessage(eventId, 'screen:updated', { screen }, originConnectionId);
		return screen;
	}

	async function screenDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'screen:deleted', { screenId: id }, originConnectionId);
	}

	async function featureMatchSlotsUpdated({ eventId, slotIds, originConnectionId }: FeatureMatchSlotsUpdatedInput) {
		if (slotIds.length === 0)
			return [];

		// One relational-load query for every Slot in the Event (capped at 50)
		// instead of a findById-per-Slot loop (each of which also issued its own
		// activeSession lookup). Slot order/skip semantics are preserved by
		// iterating slotIds and looking up each in the fetched map.
		const slots = await featureMatchService().findByEventId(eventId);
		const slotsById = new Map(slots.map(slot => [slot.id, slot]));
		const published = [];

		for (const slotId of slotIds) {
			const slot = slotsById.get(slotId);
			if (slot)
				published.push(await featureMatchSlotUpdated({ eventId, entity: slot, originConnectionId }));
		}

		return published;
	}

	async function roundMatchesRefreshed({ eventId, originConnectionId, ...payload }: RoundMatchesRefreshedInput) {
		await publishMessage(eventId, 'round:matchesRefreshed', payload, originConnectionId);
	}

	async function meleeDeckListsSynced({ eventId, originConnectionId, playerCount, deckCount }: DeckListsSyncedInput) {
		await publishSyncMessage(eventId, 'melee:decklistsSynced', { playerCount, deckCount }, originConnectionId);
	}

	async function meleePlayersSynced({ eventId, originConnectionId, playerCount }: PlayersSyncedInput) {
		await publishSyncMessage(eventId, 'melee:playersSynced', { playerCount }, originConnectionId);
	}

	async function meleeStructureSynced({ eventId, originConnectionId, ...payload }: StructureSyncedInput) {
		await publishSyncMessage(eventId, 'melee:structureSynced', payload, originConnectionId);
	}

	async function meleeFeatureMatchesSynced({ eventId, originConnectionId, ...payload }: FeatureMatchesSyncedInput) {
		await publishSyncMessage(eventId, 'melee:featureMatchesSynced', payload, originConnectionId);
	}

	async function meleeRoundSynced({ eventId, originConnectionId, ...payload }: MeleeRoundSyncedInput) {
		await publishSyncMessage(eventId, 'melee:roundSynced', payload, originConnectionId);
	}

	async function meleeDataReset({ eventId, originConnectionId, ...payload }: MeleeDataResetInput) {
		// Configuration persistence has already committed. Keep notification
		// best-effort so a delivery failure cannot turn a successful PUT into an
		// apparent failure that encourages a destructive retry.
		await publishMessage(eventId, 'melee:dataReset', payload, originConnectionId);
	}

	async function playerDeckReviewed({ eventId, entity, archetype, originConnectionId }: PlayerDeckPublicationInput) {
		const deck = mapPlayerDeckSummary(entity, archetype);
		await publishMessage(eventId, 'playerDeck:reviewed', { deck }, originConnectionId);
		return deck;
	}

	return {
		archetypeCreated,
		archetypeUpdated,
		archetypeDeleted,
		archetypeKeyCardsUpdated,
		eventUpdated,
		eventDeleted,
		phaseCreated,
		phaseUpdated,
		phaseDeleted,
		playerCreated,
		playerUpdated,
		playerDeleted,
		playerListCreated,
		playerListUpdated,
		playerListDeleted,
		playerListMembersChanged,
		talentCreated,
		talentUpdated,
		talentDeleted,
		roundCreated,
		roundUpdated,
		roundDeleted,
		matchCreated,
		matchUpdated,
		matchDeleted,
		featureMatchSlotCreated,
		featureMatchSlotUpdated,
		featureMatchSlotDeleted,
		featureMatchSlotsReordered,
		screenCreated,
		screenUpdated,
		screenDeleted,
		featureMatchSlotsUpdated,
		roundMatchesRefreshed,
		meleeDeckListsSynced,
		meleePlayersSynced,
		meleeStructureSynced,
		meleeFeatureMatchesSynced,
		meleeRoundSynced,
		meleeDataReset,
		playerDeckReviewed,
	};
}
