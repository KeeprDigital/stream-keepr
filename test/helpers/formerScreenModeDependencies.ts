import type { BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import type { MetagameScope } from '~~/shared/types/enums';
import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type {
	ScreenOutputHeadToHeadResponse,
	ScreenOutputPairingsResponse,
	ScreenOutputRoundClockResponse,
	ScreenOutputStandingsResponse,
	ScreenOutputTalentResponse,
	ScreenOutputTopCutResponse,
} from '~~/shared/types/screenOutputReads';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import type { Player } from '~/types';

/**
 * What each Screen Mode's rendering re-read on, message by message, while it
 * heard its Event's channel through a map of its own. Kept as the record
 * `screenOutputInterestParity.test.ts` holds the shared rule to: a rendering
 * now re-reads by `screenHears` alone, which must hear everything these did.
 * Nothing in the app reads them.
 */

type HeldHeadToHead = ScreenOutputHeadToHeadResponse | null;
type HeldPairings = ScreenOutputPairingsResponse | null;
type StandingsRead = ScreenOutputStandingsResponse;
type LoadedDeckSource
	= { type: 'player'; playerId: number }
		| { type: 'broadcast'; broadcastDeckListId: number };
type DeckSourceRead
	= { type: 'player'; player: Player; deck: PlayerDeckResponse | null }
		| { type: 'broadcast'; list: BroadcastDeckListResponse };

interface MetagameBreakdownScoping {
	scope: MetagameScope;
	playerListId?: number;
}

function deckSourceStamp(updatedAt: Date | string | null | undefined): number | null {
	return updatedAt == null
		? null
		: new Date(updatedAt).getTime();
}

/**
 * The Event Data a Head-to-Head is read from: its Feature Match Slot, which
 * Players the Slot seats and on which sides its Session shows them, those
 * Players (whose own records it shows) and their Archetypes, the Matches
 * between them, and the Round Standings shown for a Player holding no record
 * of their own. Melee's wholesale syncs re-read.
 */
export function headToHeadDependencies(boundSlotId: () => number | null): ScreenModeDependencies<HeldHeadToHead> {
	const isBoundSlot = (slotId: number) => slotId === boundSlotId();
	const heldPlayerIds = (held: HeldHeadToHead) => [held?.player1?.id, held?.player2?.id].filter((id): id is number => id != null);
	const holdsPlayer = (held: HeldHeadToHead, playerId: number) => heldPlayerIds(held).includes(playerId);
	const seatsBoth = (held: HeldHeadToHead, match: { player1Id: number | null; player2Id: number | null }) => {
		const ids = heldPlayerIds(held);
		return ids.length === 2 && match.player1Id != null && match.player2Id != null
			&& ids.includes(match.player1Id) && ids.includes(match.player2Id);
	};
	const holdsEarlierMatch = (held: HeldHeadToHead, matchId: number) => held?.earlierMatches.some(earlierMatch => earlierMatch.matchId === matchId) ?? false;
	/** The Slot's Session seats a held Player on the other side, as `SwapPlayers` does (ADR-0058). */
	const seatsHeldOpposite = (held: HeldHeadToHead, snapshot: FeatureMatchSourceSnapshot) =>
		(held?.player1 != null && held.player1.id === snapshot.player2?.playerId)
		|| (held?.player2 != null && held.player2.id === snapshot.player1?.playerId);

	return {
		'featureMatch:updated': ({ featureMatch }) => isBoundSlot(featureMatch.id),
		'featureMatchSession:eventApplied': ({ slotId, sourceSnapshot }, held) => isBoundSlot(slotId) && seatsHeldOpposite(held, sourceSnapshot),
		'featureMatch:deleted': ({ featureMatchId }) => isBoundSlot(featureMatchId),
		'melee:featureMatchesSynced': ({ slotIds }) => slotIds.some(isBoundSlot),
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'match:created': ({ match }, held) => seatsBoth(held, match),
		'match:updated': ({ match }, held) => seatsBoth(held, match) || holdsEarlierMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsEarlierMatch(held, matchId),
		'round:updated': ({ round }, held) => held?.earlierMatches.some(earlierMatch => earlierMatch.roundId === round.id) ?? false,
		'round:deleted': true,
		'round:matchesRefreshed': true,
		'phase:updated': true,
		'phase:deleted': true,
		'archetype:updated': true,
		'archetype:deleted': true,
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:matchResultsSynced': true,
		'melee:pairingsSynced': true,
		'melee:roundStandingsSynced': true,
		'melee:playersSynced': true,
		'melee:decklistsSynced': true,
	};
}

/** A Talent Screen reads its Talents, so an edit or delete of one it shows re-reads (#782). */
export function talentDependencies(shows: (talentId: number) => boolean): ScreenModeDependencies<ScreenOutputTalentResponse> {
	return {
		'talent:updated': ({ talent }) => shows(talent.id),
		'talent:deleted': ({ talentId }) => shows(talentId),
	};
}

/**
 * The Event Data a Round's pairings are read from: the Round, its Matches, and
 * the Players they seat. Melee's wholesale syncs of structure and Players
 * re-read; a Round's synced Match Results or pairings re-read only for this
 * Round.
 */
export function pairingsDependencies(roundId: () => number | undefined): ScreenModeDependencies<HeldPairings> {
	const isRound = (id: number) => id === roundId();
	const holdsMatch = (held: HeldPairings, matchId: number) => held?.matches.some(row => row.matchId === matchId) ?? false;
	const holdsPlayer = (held: HeldPairings, playerId: number) =>
		held?.matches.some(row => row.player1?.id === playerId || row.player2?.id === playerId) ?? false;

	return {
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'match:created': ({ match }) => isRound(match.roundId),
		'match:updated': ({ match }, held) => isRound(match.roundId) || holdsMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsMatch(held, matchId),
		'round:updated': ({ round }) => isRound(round.id),
		'round:deleted': ({ roundId: id }) => isRound(id),
		'round:matchesRefreshed': ({ roundId: id }) => isRound(id),
		'melee:matchResultsSynced': ({ roundId: id }) => isRound(id),
		'melee:pairingsSynced': ({ roundId: id }) => isRound(id),
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:playersSynced': true,
	};
}

/**
 * The Event Data a Round Clock is read from. A picked Round re-reads on its own
 * update. The Current Round can move with any Round, Phase, Match or Melee
 * pairing, so following it re-reads on each. Melee's wholesale syncs re-read either way.
 */
export function roundClockDependencies(roundId: () => number | undefined): ScreenModeDependencies<ScreenOutputRoundClockResponse> {
	const follows = (id: number, held: ScreenOutputRoundClockResponse) => roundId() == null || id === roundId() || id === held.round?.id;
	const followsCurrent = () => roundId() == null;

	return {
		'round:created': followsCurrent,
		'round:updated': ({ round }, held) => follows(round.id, held),
		'round:deleted': ({ roundId: id }, held) => follows(id, held),
		'round:matchesRefreshed': followsCurrent,
		'match:created': followsCurrent,
		'match:deleted': followsCurrent,
		'phase:updated': followsCurrent,
		'phase:deleted': followsCurrent,
		'melee:pairingsSynced': followsCurrent,
		'melee:dataReset': true,
		'melee:structureSynced': true,
	};
}

/**
 * The Event Data Standings are read from: the roster, the Round they are fixed
 * at and its snapshot, the watchlist they filter to, and, while the Position
 * Change column shows, the previous Round in the Event's Round order. Every
 * Player is a row, and Melee syncs rewrite records and snapshots wholesale, so
 * any sync of Players or Round Standings re-reads; a synced Match Result or
 * pairing does not, since Standings show only stored Round Standings. Any
 * Round or Phase edit may reorder the Event's Rounds, so while that column
 * shows, each one re-reads. A new Round holds no Round Standings until a Melee
 * sync stores them, which re-reads already.
 */
export function standingsDependencies(
	watchlistId: () => number | null,
	showsPositionChange: () => boolean,
): ScreenModeDependencies<StandingsRead> {
	const holdsRound = (held: StandingsRead, roundId: number) => held.round?.id === roundId;
	const isWatchlist = (listId: number) => listId === watchlistId();

	return {
		'player:created': true,
		'player:updated': true,
		'player:deleted': true,
		'round:updated': ({ round }, held) => holdsRound(held, round.id) || showsPositionChange(),
		'round:deleted': ({ roundId }, held) => holdsRound(held, roundId) || showsPositionChange(),
		'phase:updated': () => showsPositionChange(),
		'phase:deleted': () => showsPositionChange(),
		'playerList:updated': ({ playerList }) => isWatchlist(playerList.id),
		'playerList:deleted': ({ listId }) => isWatchlist(listId),
		'playerList:membersChanged': ({ listId }) => isWatchlist(listId),
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:roundStandingsSynced': true,
		'melee:playersSynced': true,
	};
}

function holdsRound(held: ScreenOutputTopCutResponse, roundId: number): boolean {
	return held.bracket.columns.some(column => column.roundId === roundId);
}

function holdsMatch(held: ScreenOutputTopCutResponse, matchId: number): boolean {
	return held.bracket.columns.some(column => column.positions.some(position => position.matchId === matchId));
}

function holdsPlayer(held: ScreenOutputTopCutResponse, playerId: number): boolean {
	return held.bracket.columns.some(column => column.positions.some(position =>
		position.entrants.some(entrant => entrant?.playerId === playerId)));
}

/**
 * The Event Data a Top Cut bracket is read from: its Phase, that Phase's
 * Rounds, their Matches, and the Players they seat. A reported result is a
 * `match:updated`, so it re-reads the bracket (#752). Melee's wholesale syncs
 * of structure and Players re-read; a Round's synced Match Results or pairings
 * re-read only for a Round the bracket shows.
 *
 * Seeds place the bracket whether or not they show (#906), so it reads the
 * Round Standings before the Phase too (#759): a sync of any Round may store
 * them, and any Round or Phase edit may reorder the Event's Rounds, so each
 * one re-reads. While Archetypes show, so do the Archetypes and Deck Lists
 * naming them. A Player's assigned Archetype is a `player:updated`, which
 * already re-reads.
 */
export function topCutDependencies(
	phaseId: () => number | undefined,
	showsArchetypes: () => boolean,
): ScreenModeDependencies<ScreenOutputTopCutResponse> {
	const isPhase = (id: number) => id === phaseId();

	return {
		'phase:updated': true,
		'phase:deleted': true,
		'round:created': ({ round }) => isPhase(round.phaseId),
		'round:updated': true,
		'round:deleted': true,
		'round:matchesRefreshed': ({ roundId }, held) => holdsRound(held, roundId),
		'match:created': ({ match }, held) => holdsRound(held, match.roundId),
		'match:updated': ({ match }, held) => holdsRound(held, match.roundId) || holdsMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsMatch(held, matchId),
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'archetype:updated': showsArchetypes,
		'archetype:deleted': showsArchetypes,
		'melee:matchResultsSynced': ({ roundId }, held) => holdsRound(held, roundId),
		'melee:pairingsSynced': ({ roundId }, held) => holdsRound(held, roundId),
		'melee:roundStandingsSynced': true,
		'melee:decklistsSynced': showsArchetypes,
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:playersSynced': true,
	};
}

/**
 * The Event Data a Manual Bracket is read from (ADR-0075): the Players its
 * Seeds name, and while Archetypes show, the Archetypes and Deck Lists naming
 * them. Its Seeds and results are the Screen's own config, so an edit to them
 * re-reads through the read's source.
 */
export function manualBracketDependencies(showsArchetypes: () => boolean): ScreenModeDependencies<ScreenOutputTopCutResponse> {
	return {
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'archetype:updated': showsArchetypes,
		'archetype:deleted': showsArchetypes,
		'tcgplus:imported': true,
		'melee:decklistsSynced': showsArchetypes,
		'melee:dataReset': true,
		'melee:playersSynced': true,
	};
}

function readRevision(read: DeckSourceRead | null): number | null | undefined {
	if (!read)
		return undefined;
	return read.type === 'player'
		? deckSourceStamp(read.player.updatedAt)
		: read.list.revision;
}

/**
 * The Event Data a Deck Source is read from. An edit to a Player's deck rolls
 * their `updatedAt` (#483), and a Broadcast Deck List carries its revision, so
 * an announcement at the revision already held carries nothing new. A Melee
 * sync, a TCG+ Import, a deck review or a resolved deck card changes what a
 * Player's deck shows without one.
 */
export function deckDependencies(selected: () => LoadedDeckSource | null): ScreenModeDependencies<DeckSourceRead | null> {
	const selectedPlayerId = () => {
		const source = selected();
		return source?.type === 'player'
			? source.playerId
			: null;
	};
	const selectedListId = () => {
		const source = selected();
		return source?.type === 'broadcast'
			? source.broadcastDeckListId
			: null;
	};
	const showsPlayer = () => selectedPlayerId() !== null;
	const showsArchetype = (archetypeId: number, held: DeckSourceRead | null) =>
		held?.type === 'player' && held.deck?.archetypeId === archetypeId;

	return {
		'player:updated': ({ player }, held) =>
			player.id === selectedPlayerId() && deckSourceStamp(player.updatedAt) !== readRevision(held),
		'playerDeck:reviewed': ({ deck }) => deck.playerId === selectedPlayerId(),
		'playerDeck:cardsResolved': ({ playerIds }) => {
			const playerId = selectedPlayerId();
			return playerId !== null && playerIds.includes(playerId);
		},
		// A reviewed deck shows its Archetype's name and colours.
		'archetype:updated': ({ archetype }, held) => showsArchetype(archetype.id, held),
		'archetype:deleted': ({ archetypeId }, held) => showsArchetype(archetypeId, held),
		'melee:dataReset': showsPlayer,
		'melee:playersSynced': showsPlayer,
		'melee:decklistsSynced': showsPlayer,
		'tcgplus:imported': showsPlayer,
		'broadcastDeckList:updated': ({ listId, revision }, held) =>
			listId === selectedListId() && revision !== readRevision(held),
	};
}

/**
 * The Event Data a Screen Output's Metagame breakdown is read from, for Screen
 * Mode Data Freshness: the Players in scope (their standing, activity and
 * Archetype), their reviewed Deck Lists and the cards in them, the Archetypes,
 * and the Player List scoping it. Melee syncs rewrite Players, Deck Lists and
 * Round Standings in bulk.
 *
 * These are the breakdown's own invalidations, not the Player store's: a deck
 * review, a resolved deck card or a Player List membership change re-reads
 * without any Player record changing (#602, #648).
 */
export function metagameBreakdownDependencies(scoping: () => MetagameBreakdownScoping): ScreenModeDependencies<unknown> {
	// The server scopes by a Player List only while the scope names one.
	const scopesOutput = (listId: number) => {
		const { scope, playerListId } = scoping();
		return scope === 'playerList' && listId === playerListId;
	};

	return {
		'player:created': true,
		'player:updated': true,
		'player:deleted': true,
		'playerDeck:reviewed': true,
		'playerDeck:cardsResolved': true,
		'archetype:created': true,
		'archetype:updated': true,
		'archetype:deleted': true,
		'archetype:keyCardsUpdated': true,
		'playerList:membersChanged': ({ listId }) => scopesOutput(listId),
		'playerList:deleted': ({ listId }) => scopesOutput(listId),
		'melee:dataReset': true,
		'melee:playersSynced': true,
		'melee:decklistsSynced': true,
		'tcgplus:imported': true,
		'melee:roundStandingsSynced': true,
	};
}
