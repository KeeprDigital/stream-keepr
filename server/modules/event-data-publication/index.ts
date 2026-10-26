import type { DbArchetype, DbEvent, DbEventTalent, DbFeatureMatch, DbFeatureMatchAssignment, DbMatch, DbPhase, DbPlayer, DbPlayerDeck, DbPlayerList, DbRound, DbScreen } from '~~/server/db/schema';
import type { ArchetypeKeyCard } from '~~/server/services/archetypeCard';
import type { BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import type { EventDataMessage } from './messages';
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
import { refreshBroadcastGraphicsBindings } from '~~/server/modules/broadcast-graphics-live-session';
import { featureMatchService } from '~~/server/services/featureMatch';
import { publishMessage, publishMessageStrict } from '~~/server/utils/ably';
import { featureMatchMessages } from './messages';

export type { EventDataMessage } from './messages';

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

interface FeatureMatchSlotPromotedInput extends PublicationInput {
	messages: readonly EventDataMessage[];
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

interface PlayerDeckCardsResolvedInput extends PublicationInput, MessagePayload<'playerDeck:cardsResolved'> {}

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

/**
 * Announce one Event Data change, and let anything resolving against it catch up.
 *
 * Every message published through here is Event Data a **Graphic Input Binding** may
 * read, which is the whole difference between this and `publishMessage`: a Screen or
 * a Player List moving changes nothing a binding resolves, so those publish plainly.
 *
 * This is the server-side counterpart of the Realtime Event Session — the one place
 * every Event Data change an operator's browser would be told about passes through —
 * which is why the re-resolution the settled rule requires is triggered from here
 * rather than from a watcher in one Live Control. A Broadcast Graphic on air with a
 * live On-air Update Policy binding then re-resolves whichever graphic the operator
 * has selected, and with no client connected at all.
 *
 * The re-resolution is best-effort in exactly the way realtime delivery already is:
 * the Event Data write has committed, and a failure to catch a Broadcast Graphic up
 * must not turn a successful write into an apparent failure that invites a retry.
 */
async function publishEventDataChange<T extends MessageType>(
	eventId: number,
	messageType: T,
	// Spelled as `publishMessage`'s own payload-carrying overload spells it, so a
	// message type with no payload cannot reach this wrapper by inference alone.
	payload: MessagePayload<T> extends undefined ? never : MessagePayload<T>,
	originConnectionId?: string,
): Promise<void> {
	await publishMessage(eventId, messageType, payload, originConnectionId);
	await refreshBroadcastGraphicsBindings(eventId);
}

/**
 * Announce a run of related Event Data changes, in order, and let anything resolving
 * against them catch up once.
 *
 * The re-resolution is per Event rather than per message, so a caller that publishes
 * several in one operation catches its Broadcast Graphics up once at the end instead
 * of once per message — the same work, done once. Every caller that publishes exactly
 * one change uses `publishEventDataChange` and never sees this.
 */
async function publishEventDataMessages(
	eventId: number,
	messages: readonly EventDataMessage[],
	originConnectionId?: string,
): Promise<void> {
	if (messages.length === 0)
		return;
	for (const message of messages) {
		// The pairing of type and payload is what `EventDataMessage` guarantees; a
		// union cannot carry it through `publishMessage`'s per-type overloads.
		await publishMessage(eventId, message.type, message.payload as never, originConnectionId);
	}
	await refreshBroadcastGraphicsBindings(eventId);
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

	// A Melee Sync reports what it changed as a count rather than per entity, so this is
	// the only notice a Broadcast Graphic bound to a synced Player or Round ever gets.
	await refreshBroadcastGraphicsBindings(eventId);
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
	async function broadcastDeckListCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<BroadcastDeckListResponse>) {
		await publishMessage(eventId, 'broadcastDeckList:created', {
			listId: entity.id,
			revision: entity.revision,
		}, originConnectionId);
		return entity;
	}

	async function broadcastDeckListUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<BroadcastDeckListResponse>) {
		await publishMessage(eventId, 'broadcastDeckList:updated', {
			listId: entity.id,
			revision: entity.revision,
		}, originConnectionId);
		return entity;
	}

	async function broadcastDeckListDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishMessage(eventId, 'broadcastDeckList:deleted', { listId: id }, originConnectionId);
	}

	async function archetypeCreated({ eventId, entity, originConnectionId, keyCards = [] }: ArchetypePublicationInput) {
		const archetype = {
			...mapArchetypeToResponse(entity),
			keyCards: keyCards.map(mapArchetypeKeyCard),
		};
		await publishEventDataChange(eventId, 'archetype:created', { archetype }, originConnectionId);
		return archetype;
	}

	async function archetypeUpdated({ eventId, entity, originConnectionId, keyCards = [] }: ArchetypePublicationInput) {
		const archetype = {
			...mapArchetypeToResponse(entity),
			keyCards: keyCards.map(mapArchetypeKeyCard),
		};
		await publishEventDataChange(eventId, 'archetype:updated', { archetype }, originConnectionId);
		return archetype;
	}

	async function archetypeDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'archetype:deleted', { archetypeId: id }, originConnectionId);
	}

	async function archetypeKeyCardsUpdated({ eventId, archetypeId, keyCards, originConnectionId }: ArchetypeKeyCardsUpdatedInput) {
		const mappedKeyCards = keyCards.map(card => mapArchetypeKeyCardPublication(archetypeId, card));
		await publishEventDataChange(eventId, 'archetype:keyCardsUpdated', {
			archetypeId,
			keyCards: mappedKeyCards,
		}, originConnectionId);
		return mappedKeyCards;
	}

	async function eventUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<EventEntity>) {
		const event = mapEventToResponse(entity);
		await publishEventDataChange(eventId, 'event:updated', { event }, originConnectionId);
		return event;
	}

	async function eventDeleted({ eventId, originConnectionId }: PublicationInput) {
		await publishMessage(eventId, 'event:deleted', { eventId }, originConnectionId);
	}

	async function phaseCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPhase>) {
		const phase = mapPhaseToResponse(entity);
		await publishEventDataChange(eventId, 'phase:created', { phase }, originConnectionId);
		return phase;
	}

	async function phaseUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPhase>) {
		const phase = mapPhaseToResponse(entity);
		await publishEventDataChange(eventId, 'phase:updated', { phase }, originConnectionId);
		return phase;
	}

	async function phaseDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'phase:deleted', { phaseId: id }, originConnectionId);
	}

	async function playerCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPlayer>) {
		const player = mapPlayerToResponse(entity);
		await publishEventDataChange(eventId, 'player:created', { player }, originConnectionId);
		return player;
	}

	async function playerUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbPlayer>) {
		const player = mapPlayerToResponse(entity);
		await publishEventDataChange(eventId, 'player:updated', { player }, originConnectionId);
		return player;
	}

	async function playerDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'player:deleted', { playerId: id }, originConnectionId);
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
		await publishEventDataChange(eventId, 'talent:created', { talent }, originConnectionId);
		return talent;
	}

	async function talentUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbEventTalent>) {
		const talent = mapTalentToResponse(entity);
		await publishEventDataChange(eventId, 'talent:updated', { talent }, originConnectionId);
		return talent;
	}

	async function talentDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'talent:deleted', { talentId: id }, originConnectionId);
	}

	async function roundCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbRound>) {
		const round = mapRoundToResponse(entity);
		await publishEventDataChange(eventId, 'round:created', { round }, originConnectionId);
		return round;
	}

	async function roundUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbRound>) {
		const round = mapRoundToResponse(entity);
		await publishEventDataChange(eventId, 'round:updated', { round }, originConnectionId);
		return round;
	}

	async function roundDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'round:deleted', { roundId: id }, originConnectionId);
	}

	async function matchCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbMatch>) {
		const match = mapMatchToResponse(entity);
		await publishEventDataChange(eventId, 'match:created', { match }, originConnectionId);
		return match;
	}

	async function matchUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbMatch>) {
		const match = mapMatchToResponse(entity);
		await publishEventDataChange(eventId, 'match:updated', { match }, originConnectionId);
		return match;
	}

	async function matchDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'match:deleted', { matchId: id }, originConnectionId);
	}

	async function featureMatchSlotCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbFeatureMatch>) {
		const featureMatch = mapFeatureMatchToResponse(entity);
		await publishEventDataChange(eventId, 'featureMatch:created', { featureMatch }, originConnectionId);
		return featureMatch;
	}

	async function featureMatchSlotUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbFeatureMatch>) {
		const message = featureMatchMessages.slotUpdated(entity);
		await publishEventDataMessages(eventId, [message], originConnectionId);
		return message.payload.featureMatch;
	}

	async function featureMatchSlotDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataChange(eventId, 'featureMatch:deleted', { featureMatchId: id }, originConnectionId);
	}

	async function featureMatchSlotsReordered({ eventId, slots, originConnectionId }: FeatureMatchSlotsReorderedInput) {
		const featureMatches = slots.map(slot => ({ featureMatchId: slot.matchId, sortOrder: slot.sortOrder }));
		await publishEventDataChange(eventId, 'featureMatch:reordered', { featureMatches }, originConnectionId);
		return featureMatches;
	}

	async function featureMatchAssignmentCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbFeatureMatchAssignment>) {
		const message = featureMatchMessages.assignmentCreated(entity);
		await publishEventDataMessages(eventId, [message], originConnectionId);
		return message.payload.featureMatchAssignment;
	}

	async function featureMatchAssignmentUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbFeatureMatchAssignment>) {
		const message = featureMatchMessages.assignmentUpdated(entity);
		await publishEventDataMessages(eventId, [message], originConnectionId);
		return message.payload.featureMatchAssignment;
	}

	async function featureMatchAssignmentDeleted({ eventId, id, originConnectionId }: DeletedPublicationInput) {
		await publishEventDataMessages(eventId, [
			featureMatchMessages.assignmentDeleted(id),
		], originConnectionId);
	}

	/*
	 * A Screen change is announced by name; the Screen itself travels over the API.
	 *
	 * The mapped entity carries `modeConfigs`, which storage bounds at 512 KiB while
	 * one realtime message is bounded by `MAX_REALTIME_MESSAGE_BYTES` — so shipping
	 * it made the notification undeliverable at exactly the authored sizes worth
	 * having, and undeliverable silently, because `publishMessage` logs and swallows.
	 * The write still succeeded, so the author saw their change saved while every
	 * other operator's editor quietly went stale.
	 *
	 * Both still return the mapped Screen: it is the write's own HTTP response, which
	 * has no per-message ceiling, and it is the authority a notified client reloads.
	 * See #95, and #60's settled rule that realtime is notification and snapshots are
	 * authority.
	 */
	async function screenCreated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbScreen>) {
		const screen = mapScreenToResponse(entity);
		await publishMessage(eventId, 'screen:created', { screenId: screen.id }, originConnectionId);
		return screen;
	}

	async function screenUpdated({ eventId, entity, originConnectionId }: EntityPublicationInput<DbScreen>) {
		const screen = mapScreenToResponse(entity);
		await publishMessage(eventId, 'screen:updated', { screenId: screen.id }, originConnectionId);
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
		const messages = slotIds.flatMap((slotId) => {
			const slot = slotsById.get(slotId);
			return slot
				? [
						featureMatchMessages.slotUpdated(slot),
					]
				: [];
		});

		// Announced one by one, because each message names one Slot, and caught up once,
		// because re-resolution is per Event and not per Slot. Fifty Slots moving in one
		// operation is one Event Data change as far as a Graphic Input Binding is
		// concerned, and sweeping per Slot would repeat the whole Event's work fifty
		// times inside one request.
		await publishEventDataMessages(eventId, messages, originConnectionId);

		return messages.map(message => message.payload.featureMatch);
	}

	/**
	 * Publish a Feature Match Slot Promotion's messages, decided before any is
	 * published, as one change: Graphic Input Bindings re-resolve once for the lot.
	 */
	async function featureMatchSlotPromoted({ eventId, messages, originConnectionId }: FeatureMatchSlotPromotedInput) {
		await publishEventDataMessages(eventId, messages, originConnectionId);
	}

	async function roundMatchesRefreshed({ eventId, originConnectionId, ...payload }: RoundMatchesRefreshedInput) {
		await publishEventDataChange(eventId, 'round:matchesRefreshed', payload, originConnectionId);
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
		await publishEventDataChange(eventId, 'melee:dataReset', payload, originConnectionId);
	}

	async function playerDeckReviewed({ eventId, entity, archetype, originConnectionId }: PlayerDeckPublicationInput) {
		const deck = mapPlayerDeckSummary(entity, archetype);
		await publishEventDataChange(eventId, 'playerDeck:reviewed', { deck }, originConnectionId);
		return deck;
	}

	async function playerDeckCardsResolved({ eventId, originConnectionId, ...payload }: PlayerDeckCardsResolvedInput) {
		// Published plainly: no Graphic Input Binding reads a Deck List's cards.
		await publishMessage(eventId, 'playerDeck:cardsResolved', payload, originConnectionId);
	}

	return {
		broadcastDeckListCreated,
		broadcastDeckListUpdated,
		broadcastDeckListDeleted,
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
		featureMatchAssignmentCreated,
		featureMatchAssignmentUpdated,
		featureMatchAssignmentDeleted,
		screenCreated,
		screenUpdated,
		screenDeleted,
		featureMatchSlotsUpdated,
		featureMatchSlotPromoted,
		roundMatchesRefreshed,
		meleeDeckListsSynced,
		meleePlayersSynced,
		meleeStructureSynced,
		meleeFeatureMatchesSynced,
		meleeRoundSynced,
		meleeDataReset,
		playerDeckReviewed,
		playerDeckCardsResolved,
	};
}
