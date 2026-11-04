import type { DbPlayer } from '~~/server/db/schema';
import type { OpPlayerDeckListContents } from '~~/server/services/opPlayerDeckList';
import type { OpDeckListView } from '~~/shared/types/opDeckList';
import type { TcgPlusImportAnswer, TcgPlusImportHeldPlayer, TcgPlusImportLeader, TcgPlusImportPreview } from '~~/shared/types/tcgPlusImport';
import type { TcgPlusExportEntry } from './parse';
import { eventDataPublicationModule, publishSyncAfterCommit } from '~~/server/modules/event-data-publication';
import { opDeckListWriteModule } from '~~/server/modules/op-deck-list-write';
import { opDeckListLeaderCard } from '~~/server/modules/op-deck-list-write/paste';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { opPlayerDeckListService } from '~~/server/services/opPlayerDeckList';
import { playerService } from '~~/server/services/player';
import { tcgPlusImportService } from '~~/server/services/tcgPlusImport';
import { requireOpEvent } from '~~/server/utils/routeGuards';
import { playerDisplayName, playerMemberNumber } from '~~/shared/utils/playerName';
import { parseTcgPlusExport, TcgPlusExportError } from './parse';

/**
 * The TCG+ Import (ADR-0074): a One Piece Card Game Event's Players, their
 * Nicknames and their Deck Lists, from a Bandai TCG+ deck list export.
 *
 * A preview reads what the export would change and saves no Player or Deck
 * List, though its card lookup fills the card catalogue. An import upserts
 * Players by Bandai member number, refreshing each Nickname and leaving the
 * operator's name; replaces each Deck List whose cards changed through the OP
 * Deck List write, keeping a hand-edited one, though an Unresolved Deck Card
 * it holds that the catalogue now knows is named; and marks imported Players the
 * export misses inactive. Players added by hand are never touched. The card
 * lookup runs before any write, so a failed one saves nothing.
 */

interface ImportParams {
	eventId: number;
	csv: string;
}

/** One export entry, its Deck List as it would save, and the Player it names, if the Event has them. */
interface PlannedEntry {
	exported: TcgPlusExportEntry;
	deckList: OpDeckListView;
	held: DbPlayer | null;
	heldDeckList: OpPlayerDeckListContents | null;
	/** A hand-edited saved Deck List holding an Unresolved Deck Card, resolved again; `null` for any other. */
	handEditResolved: OpDeckListView | null;
}

interface ImportPlan {
	entries: PlannedEntry[];
	eventPlayers: DbPlayer[];
}

function readExport(csv: string): TcgPlusExportEntry[] {
	try {
		return parseTcgPlusExport(csv);
	}
	catch (error) {
		if (!(error instanceof TcgPlusExportError))
			throw error;
		throw createError({
			statusCode: 422,
			message: error.message,
			data: { code: error.code },
		});
	}
}

function contentKey(leaderNumber: string | null, entries: ReadonlyArray<{ number: string; quantity: number }>): string {
	return `${leaderNumber ?? ''}|${entries.map(entry => `${entry.quantity}x${entry.number}`).toSorted().join(',')}`;
}

/** Whether the export's Deck List holds other cards, or another Leader, than the one saved. */
function deckListDiffers({ deckList, heldDeckList }: PlannedEntry): boolean {
	return heldDeckList === null
		|| contentKey(deckList.leaderNumber, deckList.entries) !== contentKey(heldDeckList.leaderNumber, heldDeckList.entries);
}

/** Whether the saved Deck List holds an Unresolved Deck Card `resolved` names, so rewriting it names the card. */
function namesUnresolvedCard(heldDeckList: OpPlayerDeckListContents | null, resolved: OpDeckListView): boolean {
	const known = new Set(resolved.entries.filter(entry => entry.card !== null).map(entry => entry.number));
	return heldDeckList?.entries.some(entry => !entry.resolved && known.has(entry.number)) ?? false;
}

/**
 * The Deck List the import writes for an entry, if any: the export's, when
 * its cards changed or it names a card the saved one left unresolved; for a
 * hand-edited one, only the hand edit itself, when the catalogue now names a
 * card it left unresolved, which keeps it hand-edited.
 */
function plannedWrite(entry: PlannedEntry): { deckList: OpDeckListView; source: 'import' | 'resolution' } | null {
	const { deckList, heldDeckList, handEditResolved } = entry;
	if (!heldDeckList?.handEdited) {
		return deckListDiffers(entry) || namesUnresolvedCard(heldDeckList, deckList)
			? { deckList, source: 'import' }
			: null;
	}
	return handEditResolved && namesUnresolvedCard(heldDeckList, handEditResolved)
		? { deckList: handEditResolved, source: 'resolution' }
		: null;
}

function heldPlayer(player: DbPlayer): TcgPlusImportHeldPlayer {
	return {
		playerId: player.id,
		shownAs: playerDisplayName(player),
		memberNumber: playerMemberNumber(player),
	};
}

function comparable(value: string | null | undefined): string {
	return (value ?? '').trim().toLocaleLowerCase();
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1
		? ''
		: 's'}`;
}

export function tcgPlusImportModule() {
	const deckListWrite = opDeckListWriteModule();

	/**
	 * The export read against the Event: who it names, and every Deck List
	 * resolved in one bulk lookup, with the hand-edited ones it names that
	 * hold an Unresolved Deck Card, so the lookup retries their numbers too.
	 */
	async function plan(eventId: number, csv: string): Promise<ImportPlan> {
		await requireOpEvent(eventId);
		const exported = readExport(csv);
		const [eventPlayers, heldDeckLists] = await Promise.all([
			playerService().findAll({ eventId, includeInactive: true }),
			opPlayerDeckListService().findContentsByEvent(eventId),
		]);
		const imported = new Map(eventPlayers.filter(player => player.externalSource === 'tcgplus').map(player => [player.externalId, player]));
		const named = exported.map((entry) => {
			const held = imported.get(entry.memberNumber) ?? null;
			return {
				entry,
				held,
				heldDeckList: held
					? heldDeckLists.get(held.id) ?? null
					: null,
			};
		});
		const unresolvedHandEdits = named.flatMap(({ heldDeckList }) =>
			heldDeckList?.handEdited && heldDeckList.entries.some(entry => !entry.resolved)
				? [heldDeckList]
				: []);
		const views = await deckListWrite.previewMany({
			eventId,
			inputs: [
				...exported,
				...unresolvedHandEdits,
			],
		});
		const handEditViews = new Map(unresolvedHandEdits.map((deckList, index) => [deckList, views[exported.length + index]!]));
		return {
			eventPlayers,
			entries: named.map(({ entry, held, heldDeckList }, index) => ({
				exported: entry,
				deckList: views[index]!,
				held,
				heldDeckList,
				handEditResolved: heldDeckList
					? handEditViews.get(heldDeckList) ?? null
					: null,
			})),
		};
	}

	/** What importing the export would change, and what it warns of. Saves no Player or Deck List. */
	async function preview({ eventId, csv }: ImportParams): Promise<TcgPlusImportPreview> {
		const { entries, eventPlayers } = await plan(eventId, csv);
		const incoming = (entry: PlannedEntry) => ({
			memberNumber: entry.exported.memberNumber,
			nickname: entry.exported.nickname,
			leaderNumber: entry.deckList.leaderNumber,
		});
		const handEditConflicts = entries.filter(entry => entry.held && entry.heldDeckList?.handEdited && deckListDiffers(entry));
		const named = new Set(entries.map(entry => entry.exported.memberNumber));

		const leaders = new Map<string, TcgPlusImportLeader>();
		const unknown = new Map<string, number>();
		for (const { deckList } of entries) {
			if (deckList.leaderNumber !== null) {
				const card = opDeckListLeaderCard(deckList);
				const leader = leaders.get(deckList.leaderNumber)
					?? {
						number: deckList.leaderNumber,
						name: card?.name ?? null,
						colors: card?.colors ?? [],
						playerCount: 0,
					};
				leader.playerCount++;
				leaders.set(leader.number, leader);
			}
			for (const entry of deckList.entries.filter(entry => entry.card === null))
				unknown.set(entry.number, (unknown.get(entry.number) ?? 0) + 1);
		}

		const handAdded = eventPlayers.filter(player => player.externalSource !== 'tcgplus');
		const possibleDuplicates = entries.flatMap(entry => handAdded
			.filter(player => [player.name, player.nickname].some(shown => comparable(shown) !== '' && comparable(shown) === comparable(entry.exported.nickname)))
			.map(player => ({
				...heldPlayer(player),
				nickname: entry.exported.nickname,
				incomingMemberNumber: entry.exported.memberNumber,
			})));

		return {
			playerCount: entries.length,
			added: entries.filter(entry => !entry.held).map(incoming),
			deckListChanged: entries.filter(entry => entry.held && plannedWrite(entry)).map(entry => heldPlayer(entry.held!)),
			deactivated: eventPlayers
				.filter(player => player.externalSource === 'tcgplus' && player.isActive && !named.has(player.externalId ?? ''))
				.map(heldPlayer),
			leaders: [
				...leaders.values(),
			].toSorted((left, right) => right.playerCount - left.playerCount || left.number.localeCompare(right.number)),
			warnings: {
				ruleBreaches: entries.flatMap((entry) => {
					const warnings = entry.deckList.warnings.filter(warning => warning.code !== 'UNKNOWN_CARD');
					return warnings.length > 0
						? [
								{
									...incoming(entry),
									warnings,
								},
							]
						: [];
				}),
				unknownCards: [...unknown].map(([number, playerCount]) => ({ number, playerCount })),
				handEditConflicts: handEditConflicts.map(entry => heldPlayer(entry.held!)),
				possibleDuplicates,
			},
		};
	}

	/** Imports the export: its Players, their Nicknames, and every Deck List it changes. */
	async function commit({ eventId, csv }: ImportParams): Promise<TcgPlusImportAnswer> {
		const { entries } = await plan(eventId, csv);
		const seenAt = new Date();
		const reconciled = await tcgPlusImportService().reconcile(eventId, entries.map(({ exported }) => ({
			memberNumber: exported.memberNumber,
			nickname: exported.nickname,
			deckList: { leaderNumber: exported.leaderNumber, entries: exported.entries },
		})), seenAt);
		const byMember = new Map(reconciled.players.map(player => [player.externalId, player]));

		const kept = entries.filter(entry => entry.heldDeckList?.handEdited && deckListDiffers(entry));
		const writes = entries.flatMap((entry) => {
			const write = plannedWrite(entry);
			return write
				? [
						{ playerId: byMember.get(entry.exported.memberNumber)!.id, ...write },
					]
				: [];
		});
		// After the Players: every Player written stands even if this write fails, and a re-import finishes it.
		const written = await deckListWrite.writeMany({ eventId, writes });

		const writtenIds = new Set(written.map(player => player.id));
		// A Player whose Nickname changed or who came back, with no Deck List written: their Slots follow them too.
		const refreshed = reconciled.players.filter(player => !writtenIds.has(player.id) && player.updatedAt.getTime() === seenAt.getTime());
		const warnings: string[] = [];
		const { created, updated, deactivated } = reconciled;
		if (created + updated + deactivated + written.length > 0) {
			await publishSyncAfterCommit(warnings, async () => {
				if (refreshed.length > 0) {
					await playerUpdateModule().publishPlayerSnapshotUpdates({
						eventId,
						playerIds: refreshed.map(player => player.id),
					});
				}
				await eventDataPublicationModule().tcgPlusImported({
					eventId,
					playerCount: reconciled.players.length,
					deckCount: written.length,
				});
			}, 'tcgplus_import_realtime_publish_failed');
		}

		return {
			success: true,
			message: [
				`Imported ${plural(entries.length, 'Player')} from TCG+`,
				...(written.length > 0
					? [`${plural(written.length, 'Deck List')} written`]
					: []),
				...(deactivated > 0
					? [`${deactivated} marked inactive`]
					: []),
				...(kept.length > 0
					? [`${plural(kept.length, 'hand-edited Deck List')} kept`]
					: []),
			].join('; '),
			results: {
				created,
				updated,
				deactivated,
				deckListsWritten: written.length,
				handEditsKept: kept.length,
			},
			...(warnings.length > 0
				? { warnings }
				: {}),
		};
	}

	/**
	 * Drops a Player's hand edit for the Deck List the last import brought them,
	 * written as an import's, so the next import replaces it again.
	 */
	async function useImportedDeckList({ eventId, playerId }: { eventId: number; playerId: number }) {
		await requireOpEvent(eventId);
		const imported = await tcgPlusImportService().findImportedDeckList(eventId, playerId);
		if (!imported)
			throw createError({ statusCode: 404, message: 'No TCG+ Import has brought this Player a Deck List' });
		return await deckListWrite.write({
			eventId,
			owner: { kind: 'player', playerId },
			input: imported,
			source: 'import',
		});
	}

	return { preview, commit, useImportedDeckList };
}
