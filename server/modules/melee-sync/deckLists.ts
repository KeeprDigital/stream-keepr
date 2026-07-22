import type { MappedMeleePlayer, ParsedDeckList } from '~~/server/mappers/melee';
import type { importedMtgCardResolverService } from '~~/server/services/importedMtgCardResolver';
import type { mtgCardService, UpsertCardInput } from '~~/server/services/mtgCard';
import type {
	ImportedCompanionMutation,
	MeleeDeckCardSnapshot,
	MeleeDeckUnresolvedCardSnapshot,
	MeleePlayerDeckReplacement,
	MeleePlayerDeckSnapshot,
} from '~~/server/services/playerDeck';
import type { Game } from '~~/shared/types/enums';
import { playerDeckService } from '~~/server/services/playerDeck';
import { DeckCompanionValidationError, validateImportedCompanionSnapshot } from '~~/server/services/playerDeckCompanion';
import { normalizeImportedCardName, normalizeImportedSetCode } from '~~/server/utils/cardNameNormalization';
import { createCardKey } from '~~/server/utils/scryfall';

type CardResolutionMap = Awaited<ReturnType<ReturnType<typeof importedMtgCardResolverService>['resolveBatch']>>['resolutions'];
type PersistedCardsByName = Awaited<ReturnType<ReturnType<typeof mtgCardService>['batchUpsert']>>;
type ResolveImportedCard = ReturnType<typeof createImportedCardResolver>;

interface PersistedPlayer {
	id: number;
	externalId: string | null;
}

export interface ImportedDeckCardReference {
	name: string;
	setCode: string | null;
}

export interface PlayerWithDeckLists {
	playerData: {
		eventId: number;
		externalId: string;
		externalSource: 'melee';
		name: string;
	};
	rawDeckLists: ParsedDeckList[];
	deckLists: Array<{
		externalId: string;
		formatId: string;
		name: string;
		colors: string;
	}>;
}

export interface DeckListPersistenceResult {
	skippedPlayers: number;
	unresolvedCards: number;
}

export function collectImportedDeckCards(players: MappedMeleePlayer[]): { cards: ImportedDeckCardReference[]; totalDeckLists: number } {
	const cards: ImportedDeckCardReference[] = [];
	let totalDeckLists = 0;

	for (const player of players) {
		if (!player.deckLists)
			continue;

		totalDeckLists += player.deckLists.length;
		for (const deckList of player.deckLists) {
			for (const card of deckList.cards) {
				cards.push({ name: card.name, setCode: card.setCode ?? null });
			}
			if (deckList.companion) {
				cards.push({ name: deckList.companion.name, setCode: deckList.companion.setCode ?? null });
			}
		}
	}

	return { cards, totalDeckLists };
}

export function createImportedCardResolver(resolutionMap: CardResolutionMap) {
	return (name: string, setCode: string | null) => {
		const resolution = resolutionMap.get(createCardKey(name, setCode));
		return resolution?.status === 'resolved' ? resolution : null;
	};
}

export function buildResolvedCardUpserts(players: MappedMeleePlayer[], resolutionMap: CardResolutionMap): Map<string, UpsertCardInput> {
	const cardUpsertMap = new Map<string, UpsertCardInput>();

	const addResolvedCard = (card: { name: string; setCode?: string | null; cardType?: string | null }) => {
		const resolution = resolutionMap.get(createCardKey(card.name, card.setCode ?? null));
		if (!resolution || resolution.status !== 'resolved') {
			return;
		}

		const key = resolution.resolvedName.toLowerCase();
		if (cardUpsertMap.has(key)) {
			return;
		}

		cardUpsertMap.set(key, {
			name: resolution.resolvedName,
			game: 'mtg',
			scryfallId: resolution.cardData?.id ?? resolution.overrideCard?.scryfallId ?? null,
			oracleId: resolution.cardData?.oracleId ?? resolution.overrideCard?.oracleId ?? null,
			cardType: resolution.cardData?.typeLine ?? resolution.overrideCard?.cardType ?? card.cardType ?? null,
			colors: resolution.cardData?.colors ?? resolution.overrideCard?.colors ?? null,
			cmc: resolution.cardData?.cmc ?? resolution.overrideCard?.cmc ?? null,
			manaCost: resolution.cardData?.manaCost ?? resolution.overrideCard?.manaCost ?? null,
			deckCounterTypes: resolution.cardData?.deckCounterTypes ?? resolution.overrideCard?.deckCounterTypes ?? [],
			deckTokens: resolution.cardData?.deckTokens ?? resolution.overrideCard?.deckTokens ?? [],
		});
	};

	for (const player of players) {
		if (!player.deckLists)
			continue;
		for (const deckList of player.deckLists) {
			for (const card of deckList.cards) {
				addResolvedCard(card);
			}
			if (deckList.companion) {
				addResolvedCard(deckList.companion);
			}
		}
	}

	return cardUpsertMap;
}

export function buildPlayersWithDeckLists(
	eventId: number,
	players: MappedMeleePlayer[],
): PlayerWithDeckLists[] {
	return players
		.map((player) => {
			const rawDeckLists = player.deckLists ?? [];
			const playerDeckLists = rawDeckLists.map(deckList => ({
				externalId: deckList.externalId,
				formatId: deckList.formatId,
				name: deckList.name,
				colors: deckList.colors,
			}));

			return {
				playerData: {
					eventId,
					externalId: player.externalId,
					externalSource: player.externalSource,
					name: player.name,
				},
				rawDeckLists,
				deckLists: playerDeckLists,
			};
		});
}

export async function persistPlayerDeckLists(args: {
	eventId: number;
	eventGame: Game;
	playersWithDeckLists: PlayerWithDeckLists[];
	upsertedPlayers: PersistedPlayer[];
	nameToCard: PersistedCardsByName;
	resolveImportedCard: ResolveImportedCard;
	warnings: string[];
}): Promise<DeckListPersistenceResult> {
	if (args.eventGame !== 'mtg')
		throw new TypeError('The MTG Deck List adapter cannot persist data for a non-MTG Event');

	const playerByExternalId = new Map(args.upsertedPlayers.map(player => [player.externalId, player]));
	const deckSvc = playerDeckService();
	const replacements: MeleePlayerDeckReplacement[] = [];
	let skippedPlayers = 0;
	let unresolvedCards = 0;

	for (const { playerData, rawDeckLists, deckLists } of args.playersWithDeckLists) {
		const dbPlayer = playerByExternalId.get(playerData.externalId ?? '');
		if (!dbPlayer) {
			skippedPlayers++;
			args.warnings.push(`Player with externalId "${playerData.externalId}" not found in DB after upsert — deck cards skipped`);
			continue;
		}

		const snapshots: MeleePlayerDeckSnapshot[] = [];
		for (let deckIndex = 0; deckIndex < deckLists.length; deckIndex++) {
			const deckList = deckLists[deckIndex]!;
			const rawDeckList = rawDeckLists[deckIndex]!;
			const cardRows: MeleeDeckCardSnapshot[] = [];
			const unresolvedRows: MeleeDeckUnresolvedCardSnapshot[] = [];

			for (let sortOrder = 0; sortOrder < rawDeckList.cards.length; sortOrder++) {
				const rawCard = rawDeckList.cards[sortOrder]!;
				const resolution = args.resolveImportedCard(rawCard.name, rawCard.setCode ?? null);
				const dbCard = resolution
					? args.nameToCard.get(resolution.resolvedName.toLowerCase())
					: null;

				if (!dbCard) {
					unresolvedCards++;
					unresolvedRows.push({
						entryType: 'card',
						originalName: rawCard.name,
						normalizedOriginalName: normalizeImportedCardName(rawCard.name),
						setCode: rawCard.setCode ?? null,
						normalizedSetCode: normalizeImportedSetCode(rawCard.setCode),
						quantity: rawCard.quantity,
						compartment: rawCard.compartment,
						sortOrder,
						cardType: rawCard.cardType ?? null,
					});
					continue;
				}

				cardRows.push({
					cardId: dbCard.id,
					quantity: rawCard.quantity,
					compartment: rawCard.compartment,
					sortOrder,
				});
			}

			const rawCompanion = rawDeckList.companion;
			const companionResolution = rawCompanion
				? args.resolveImportedCard(rawCompanion.name, rawCompanion.setCode ?? null)
				: null;
			const companionCard = companionResolution
				? args.nameToCard.get(companionResolution.resolvedName.toLowerCase())
				: null;
			if (rawCompanion && !companionCard) {
				unresolvedCards++;
				unresolvedRows.push({
					entryType: 'companion',
					originalName: rawCompanion.name,
					normalizedOriginalName: normalizeImportedCardName(rawCompanion.name),
					setCode: rawCompanion.setCode ?? null,
					normalizedSetCode: normalizeImportedSetCode(rawCompanion.setCode),
					quantity: 1,
					compartment: null,
					sortOrder: rawDeckList.cards.length,
					cardType: rawCompanion.cardType ?? null,
				});
			}

			let importedCompanion: ImportedCompanionMutation = { action: 'clear' };
			if (rawCompanion && companionCard) {
				try {
					validateImportedCompanionSnapshot(cardRows, companionCard.id);
					importedCompanion = { action: 'set', cardId: companionCard.id };
				}
				catch (error) {
					if (error instanceof DeckCompanionValidationError) {
						args.warnings.push(`Imported companion "${rawCompanion.name}" for player "${playerData.name}" was skipped: ${error.message}`);
						importedCompanion = { action: 'preserve' };
					}
					else {
						throw error;
					}
				}
			}

			snapshots.push({
				deck: {
					eventId: args.eventId,
					playerId: dbPlayer.id,
					externalId: deckList.externalId,
					formatExternalId: deckList.formatId,
					name: deckList.name,
					colors: deckList.colors,
					sortOrder: deckIndex,
					isPrimary: deckIndex === 0,
				},
				cards: cardRows,
				unresolvedCards: unresolvedRows,
				importedCompanion,
			});
		}

		replacements.push({ playerId: dbPlayer.id, snapshots });
	}

	await deckSvc.replaceMeleeDecksForEvent(args.eventId, replacements);

	return { skippedPlayers, unresolvedCards };
}
