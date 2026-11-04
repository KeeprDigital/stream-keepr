import type { DbPlayer } from '~~/server/db/schema';
import type { FeatureMatchResponse, ManualPlayerSlotData, PlayerResponse } from '~~/shared/api';
import type { OpCatalogueCard } from '~~/shared/types/card/op';
import type { PlayerSide } from '~~/shared/types/enums';
import type { SavedFeatureMatchDeckList } from '~~/shared/types/featureMatchDeckList';
import type { OpDeckListEntry, OpDeckListView, SavedOpPlayerDeckList, WriteOpPlayerDeckListAnswer } from '~~/shared/types/opDeckList';
import type { LeaderArchetype } from './archetypes';
import type { PastedDeckListLine } from './paste';
import { and, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { playerDecks, players } from '~~/server/db/schema';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { opCardCatalogueModule } from '~~/server/modules/op-card-catalogue';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { featureMatchService } from '~~/server/services/featureMatch';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { opPlayerDeckListService } from '~~/server/services/opPlayerDeckList';
import { bandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import { inJsonArray } from '~~/server/utils/db';
import { runCompensation } from '~~/server/utils/errors';
import { requireOpEvent } from '~~/server/utils/routeGuards';
import { catalogueOpLeader } from '~~/shared/utils/card/op';
import { getOpGameData } from '~~/shared/utils/gameData';
import { deriveLeaderArchetype, removeEmptiedLeaderArchetypes } from './archetypes';
import { opDeckListText, opDeckListView, parseOpDeckListText } from './paste';

/**
 * The OP Deck List write (ADR-0074): every One Piece Card Game Deck List write
 * goes through here, whoever makes it. It takes an owner, the Deck List as
 * paste text or as entries, and where the write came from, and answers the
 * saved Deck List with its warnings.
 *
 * Behind it, card numbers are resolved through the card catalogue, the ones
 * it lacks in one bulk lookup; a failed lookup saves nothing. A number
 * bandai-keepr does not know is kept number-only, as an Unresolved Deck Card.
 * The paste rules and deck-rule warnings are ADR-0057's, and a breach never
 * refuses. Every write is a new Deck List id, so whoever reads it by
 * reference (a Session snapshot, a Deck List Screen) sees it change.
 *
 * A Player's write also marks a hand-made Deck List as hand-edited,
 * re-derives the Player's Leader Archetype, deletes an emptied derived
 * Archetype unless customised, corrects every Session showing the Player
 * through Reverse Sync, and announces it all. A Slot side with no linked
 * Player holds its own Feature Match Deck List, written through the Slot
 * setup write, which corrects its Session and announces the Slot.
 */

export type OpDeckListOwner
	= | { kind: 'player'; playerId: number }
		/** A Slot side, in the Slot's own order: a swap is the Session's, never the Slot's. */
		| { kind: 'slotSide'; slotId: number; side: PlayerSide };

export type OpDeckListInput
	/** Paste text. A Leader line sets the Leader; with none, `leaderNumber` is the Leader picked. */
	= | { text: string; leaderNumber?: string | null }
		/** Entries, a number given twice added together, with the Leader marked, as a TCG+ export does. */
		| { entries: readonly PastedDeckListLine[]; leaderNumber: string | null };

/**
 * Where a write came from: a TCG+ Import, an operator's hand (which a later
 * import keeps), or an Unresolved Deck Card's retry or resolution, which
 * keeps whether the Deck List was hand-edited.
 */
export type OpDeckListWriteSource = 'import' | 'hand' | 'resolution';

interface WriteParams<TOwner extends OpDeckListOwner> {
	eventId: number;
	owner: TOwner;
	input: OpDeckListInput;
	source: OpDeckListWriteSource;
	originConnectionId?: string;
}

export interface SlotSideDeckListAnswer {
	deckList: SavedFeatureMatchDeckList;
	featureMatch: FeatureMatchResponse;
}

export type OpDeckListWriteAnswer<TOwner extends OpDeckListOwner> = TOwner extends { kind: 'player' }
	? WriteOpPlayerDeckListAnswer<PlayerResponse>
	: SlotSideDeckListAnswer;

const SIDE_DATA_KEY = { player1: 'player1Data', player2: 'player2Data' } as const satisfies Record<PlayerSide, string>;
const SIDE_PLAYER_KEY = { player1: 'player1Id', player2: 'player2Id' } as const satisfies Record<PlayerSide, string>;

function inputLines(input: OpDeckListInput): PastedDeckListLine[] {
	if ('text' in input)
		return parseOpDeckListText(input.text);
	const byNumber = new Map<string, PastedDeckListLine>();
	for (const { number, quantity } of input.entries) {
		const held = byNumber.get(number);
		if (held)
			held.quantity += quantity;
		else
			byNumber.set(number, { number, quantity });
	}
	return [
		...byNumber.values(),
	];
}

interface ResolvedInput {
	entries: OpDeckListEntry[];
	/** The Leader picked or marked, when the entries' own Leader line does not overrule it. */
	marked: string | null;
}

function inputNumbers(input: OpDeckListInput, lines: readonly PastedDeckListLine[]): string[] {
	const given = input.leaderNumber ?? null;
	return [
		...lines.map(line => line.number),
		...(given === null
			? []
			: [given]),
	];
}

/** The input's entries with the cards resolved for them. */
function withCards(input: OpDeckListInput, lines: readonly PastedDeckListLine[], cards: ReadonlyMap<string, OpCatalogueCard | null>): ResolvedInput {
	const given = input.leaderNumber ?? null;
	const entries = lines.map(line => ({ ...line, card: cards.get(line.number) ?? null }));
	// ADR-0057: a pasted Leader line sets the Leader, and only a paste with none keeps the one picked.
	const pastedLeader = 'text' in input && entries.some(entry => entry.card?.category === 'leader');
	const marked = pastedLeader ? null : given;
	if (marked !== null && !entries.some(entry => entry.number === marked))
		entries.unshift({ number: marked, quantity: 1, card: cards.get(marked) ?? null });
	return { entries, marked };
}

/** The inputs' entries with their cards, through the catalogue and at most one bulk lookup for them all. */
async function resolveInputs(inputs: readonly OpDeckListInput[]): Promise<ResolvedInput[]> {
	const lineSets = inputs.map(inputLines);
	const cards = await opCardCatalogueModule().resolve(
		bandaiKeeprConfig,
		inputs.flatMap((input, index) => inputNumbers(input, lineSets[index]!)),
	);
	return inputs.map((input, index) => withCards(input, lineSets[index]!, cards));
}

async function resolveInput(input: OpDeckListInput): Promise<ResolvedInput> {
	const [resolved] = await resolveInputs([input]);
	return resolved!;
}

function leaderCardOf(view: OpDeckListView): OpCatalogueCard | null {
	return view.entries.find(entry => entry.number === view.leaderNumber)?.card ?? null;
}

export function opDeckListWriteModule() {
	const publication = eventDataPublicationModule();
	const playerDeckLists = opPlayerDeckListService();

	async function requirePlayer(eventId: number, playerId: number) {
		const player = await db.query.players.findFirst({
			where: and(eq(players.id, playerId), eq(players.eventId, eventId)),
			columns: { id: true, archetypeId: true },
		});
		if (!player)
			throw createError({ statusCode: 404, message: 'Player not found' });
		return player;
	}

	async function isHandEdited(eventId: number, playerId: number, source: OpDeckListWriteSource): Promise<boolean> {
		if (source !== 'resolution')
			return source === 'hand';
		const deck = await db.query.playerDecks.findFirst({
			where: and(eq(playerDecks.eventId, eventId), eq(playerDecks.playerId, playerId), eq(playerDecks.isPrimary, true)),
			columns: { handEdited: true },
		});
		return deck?.handEdited ?? false;
	}

	// Announced with no origin: the writing client applied none of it, so it follows the messages too.
	async function writePlayer(
		{ eventId, owner, input, source }: WriteParams<{ kind: 'player'; playerId: number }>,
	): Promise<WriteOpPlayerDeckListAnswer<PlayerResponse>> {
		const { playerId } = owner;
		await requirePlayer(eventId, playerId);
		const { entries, marked } = await resolveInput(input);
		const view = opDeckListView(entries, marked);

		const leader = leaderCardOf(view);
		const derived = leader && view.leaderNumber !== null
			? await deriveLeaderArchetype(eventId, view.leaderNumber, leader)
			: null;
		// Read after the lookup, so the Archetype the cleanup checks is the one this write replaces.
		const previous = await requirePlayer(eventId, playerId);
		const written = await playerDeckLists.replace({
			eventId,
			playerId,
			view,
			archetypeId: derived?.archetype.id ?? null,
			handEdited: await isHandEdited(eventId, playerId, source),
		});
		if (!written) {
			await removeEmptiedLeaderArchetypes(eventId, derived?.created
				? [derived.created.id]
				: []);
			throw createError({ statusCode: 404, message: 'Player not found' });
		}

		// The Archetypes go out first, so a client applying the Player knows its Archetype.
		if (derived?.created)
			await publication.archetypeCreated({ eventId, entity: derived.created });
		for (const renamed of derived?.renamed ?? [])
			await publication.archetypeUpdated({ eventId, entity: renamed });
		const player = await publication.playerUpdated({ eventId, entity: written });
		await playerUpdateModule().publishPlayerSnapshotUpdates({
			eventId,
			playerIds: [playerId],
		});

		const emptied = previous.archetypeId !== null && previous.archetypeId !== written.archetypeId
			? [previous.archetypeId]
			: [];
		const { deletedIds, releasedScreens } = await removeEmptiedLeaderArchetypes(eventId, emptied);
		for (const screen of releasedScreens)
			await publication.screenUpdated({ eventId, entity: screen });
		for (const id of deletedIds)
			await publication.archetypeDeleted({ eventId, id });

		const deckList = await playerDeckLists.findByPlayer(eventId, playerId);
		if (!deckList)
			throw createError({ statusCode: 409, message: 'The Deck List was replaced while it was saved' });
		return { deckList, player };
	}

	async function writeSlotSide(
		{ eventId, owner, input, originConnectionId }: WriteParams<{ kind: 'slotSide'; slotId: number; side: PlayerSide }>,
	): Promise<SlotSideDeckListAnswer> {
		const { slotId, side } = owner;
		const slots = featureMatchService();
		const deckLists = featureMatchDeckListService();
		const held = await slots.findById(slotId, eventId);
		if (!held)
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		// A linked side shows its Player's Deck List, edited as the Player's (ADR-0074).
		if (held[SIDE_PLAYER_KEY[side]] != null)
			throw createError({ statusCode: 409, message: 'This side shows its Player\'s Deck List: edit the Player\'s Deck List instead' });

		const { entries } = await resolveInput('text' in input
			? { text: input.text }
			: { entries: input.entries, leaderNumber: null });
		const view = opDeckListView(entries);
		const sourceText = 'text' in input
			? input.text
			: opDeckListText(view.entries, view.leaderNumber);
		const deckListId = await deckLists.create(eventId, slotId, sourceText, view);

		// Read after the lookup, so an edit to the side made meanwhile is kept.
		const slot = await slots.findById(slotId, eventId);
		const key = SIDE_DATA_KEY[side];
		// Provenance is never written by an operator save; an OP Slot carries none.
		const { externalId: _externalId, externalSource: _externalSource, ...current } = slot?.[key] ?? {};
		const currentGameData = getOpGameData(current.gameData);
		const leader = leaderCardOf(view);
		const sideData: ManualPlayerSlotData = {
			...current,
			gameData: {
				...currentGameData,
				// ADR-0057: a paste with no Leader keeps the side's.
				leader: leader && view.leaderNumber !== null
					? catalogueOpLeader(view.leaderNumber, leader)
					: currentGameData.leader,
				featureMatchDeckList: { id: deckListId, mainboardCount: view.mainboardCount },
			},
		};

		let featureMatch: FeatureMatchResponse;
		try {
			featureMatch = await featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId,
				input: { [key]: sideData },
				originConnectionId,
			});
		}
		catch (error) {
			await runCompensation(error, () => deckLists.remove(slotId, [deckListId]));
			throw error;
		}
		// A save of the same side that started first but landed later leaves its Deck List held by nothing.
		await deckLists.removeUnheldBefore(slotId, deckListId, [featureMatch.player1Data, featureMatch.player2Data]);

		const saved = await deckLists.findById(deckListId, slotId, eventId);
		if (!saved)
			throw createError({ statusCode: 409, message: 'The Deck List was replaced while it was saved' });
		return { deckList: saved, featureMatch };
	}

	/** Writes a Deck List for its owner, or nothing when a lookup fails. */
	async function write<TOwner extends OpDeckListOwner>(params: WriteParams<TOwner>): Promise<OpDeckListWriteAnswer<TOwner>> {
		await requireOpEvent(params.eventId);
		const { owner } = params;
		const answer = owner.kind === 'player'
			? await writePlayer({ ...params, owner })
			: await writeSlotSide({ ...params, owner });
		return answer as OpDeckListWriteAnswer<TOwner>;
	}

	/** A Player's Deck List as saved, or `null` for a Player with none. */
	async function readPlayer({ eventId, playerId }: { eventId: number; playerId: number }): Promise<SavedOpPlayerDeckList | null> {
		await requireOpEvent(eventId);
		await requirePlayer(eventId, playerId);
		return await playerDeckLists.findByPlayer(eventId, playerId);
	}

	/**
	 * The Deck Lists `inputs` would save, each with its Leader and warnings,
	 * resolved in one bulk lookup for them all. It saves no Deck List, though
	 * the lookup fills the card catalogue, whose rows are never wrong.
	 */
	async function previewMany({ eventId, inputs }: { eventId: number; inputs: readonly OpDeckListInput[] }): Promise<OpDeckListView[]> {
		await requireOpEvent(eventId);
		const resolved = await resolveInputs(inputs);
		return resolved.map(({ entries, marked }) => opDeckListView(entries, marked));
	}

	/**
	 * Writes many Players' Deck Lists at once, as previewed by `previewMany`:
	 * one batch for them all, each Leader's Archetype derived once, every
	 * Session showing them corrected, and emptied Archetypes removed. The
	 * Archetypes it creates or renames are announced; the Players are not, one
	 * by one, so the caller announces them as a count. Answers the Players as
	 * written.
	 */
	async function writeMany({ eventId, writes, source }: {
		eventId: number;
		writes: ReadonlyArray<{ playerId: number; deckList: OpDeckListView }>;
		/** A resolution rewrites one Deck List at a time, keeping its flag, so it is not offered here. */
		source: Exclude<OpDeckListWriteSource, 'resolution'>;
	}): Promise<DbPlayer[]> {
		if (writes.length === 0)
			return [];
		await requireOpEvent(eventId);
		const derived = new Map<string, LeaderArchetype>();
		for (const { deckList } of writes) {
			const leader = leaderCardOf(deckList);
			if (leader && deckList.leaderNumber !== null && !derived.has(deckList.leaderNumber))
				derived.set(deckList.leaderNumber, await deriveLeaderArchetype(eventId, deckList.leaderNumber, leader));
		}
		const created = [
			...derived.values(),
		].flatMap(({ created }) => created ?? []);
		const playerIds = writes.map(({ playerId }) => playerId);
		const previous = await db.select({ archetypeId: players.archetypeId })
			.from(players)
			.where(and(eq(players.eventId, eventId), inJsonArray(players.id, playerIds)));

		let written: DbPlayer[];
		try {
			written = await playerDeckLists.replaceMany(eventId, writes.map(({ playerId, deckList }) => ({
				eventId,
				playerId,
				view: deckList,
				archetypeId: deckList.leaderNumber === null
					? null
					: derived.get(deckList.leaderNumber)?.archetype.id ?? null,
				handEdited: source === 'hand',
			})));
		}
		catch (error) {
			await runCompensation(error, () => removeEmptiedLeaderArchetypes(eventId, created.map(archetype => archetype.id)));
			throw error;
		}

		for (const archetype of created)
			await publication.archetypeCreated({ eventId, entity: archetype });
		// A later Leader's clash may rename one created or renamed earlier: the last name stands.
		const renamed = new Map([
			...derived.values(),
		].flatMap(({ renamed }) => renamed).map(archetype => [archetype.id, archetype]));
		for (const archetype of renamed.values())
			await publication.archetypeUpdated({ eventId, entity: archetype });
		await playerUpdateModule().publishPlayerSnapshotUpdates({
			eventId,
			playerIds: written.map(player => player.id),
		});

		const held = new Set(written.map(player => player.archetypeId));
		const emptied = [
			...new Set(previous.flatMap(({ archetypeId }) => archetypeId !== null && !held.has(archetypeId)
				? [archetypeId]
				: [])),
		];
		const { deletedIds, releasedScreens } = await removeEmptiedLeaderArchetypes(eventId, emptied);
		for (const screen of releasedScreens)
			await publication.screenUpdated({ eventId, entity: screen });
		for (const id of deletedIds)
			await publication.archetypeDeleted({ eventId, id });
		return written;
	}

	return {
		write,
		readPlayer,
		previewMany,
		writeMany,
	};
}
