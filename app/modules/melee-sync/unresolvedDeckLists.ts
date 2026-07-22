import type { MaybeRefOrGetter } from 'vue';
import type { MeleeUnresolvedDeckCardResponse } from '~~/shared/api';
import { useDebounceFn } from '@vueuse/core';
import { computed, onScopeDispose, ref, toValue, watch } from 'vue';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

const SCRYFALL_CLIENT_TIMEOUT_MS = 10_000;

export interface ScryfallSearchResult {
	id: string;
	name: string;
	set: string;
	set_name?: string;
	image_uris?: { small?: string };
	card_faces?: Array<{ image_uris?: { small?: string } }>;
}

export interface UnresolvedDeckCardGroup {
	key: string;
	entryType: MeleeUnresolvedDeckCardResponse['entryType'];
	originalName: string;
	setCode: string | null;
	entries: MeleeUnresolvedDeckCardResponse[];
	entryCount: number;
	affectedPlayerCount: number;
	affectedDeckCount: number;
}

function errorMessage(error: unknown, fallback: string): string {
	if (typeof error === 'string' && error.trim())
		return error;

	if (error instanceof Error && error.message.trim())
		return error.message;

	if (error && typeof error === 'object') {
		const record = error as Record<string, unknown>;
		const data = record.data;
		if (data && typeof data === 'object') {
			const dataRecord = data as Record<string, unknown>;
			const nestedMessage = dataRecord.message ?? dataRecord.statusMessage;
			if (typeof nestedMessage === 'string' && nestedMessage.trim())
				return nestedMessage;
		}

		const message = record.message ?? record.statusMessage;
		if (typeof message === 'string' && message.trim())
			return message;
	}

	return fallback;
}

interface UseMeleeSyncUnresolvedDeckListResolutionOptions {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	isSetupComplete: MaybeRefOrGetter<boolean>;
}

export function normalizeUnresolvedDeckCardName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeUnresolvedDeckCardSetCode(setCode: string | null): string {
	return setCode?.trim().toLowerCase() ?? '';
}

export function createUnresolvedDeckCardGroupKey(
	entry: Pick<MeleeUnresolvedDeckCardResponse, 'originalName' | 'setCode' | 'entryType'>,
): string {
	return `${entry.entryType}:${normalizeUnresolvedDeckCardName(entry.originalName)}:${normalizeUnresolvedDeckCardSetCode(entry.setCode)}`;
}

export function groupUnresolvedDeckCards(
	entries: MeleeUnresolvedDeckCardResponse[],
): UnresolvedDeckCardGroup[] {
	const groups = new Map<string, UnresolvedDeckCardGroup>();

	for (const entry of entries) {
		const key = createUnresolvedDeckCardGroupKey(entry);
		const existing = groups.get(key);
		if (existing) {
			existing.entries.push(entry);
			existing.entryCount += 1;
			continue;
		}

		groups.set(key, {
			key,
			entryType: entry.entryType,
			originalName: entry.originalName,
			setCode: entry.setCode,
			entries: [entry],
			entryCount: 1,
			affectedPlayerCount: 0,
			affectedDeckCount: 0,
		});
	}

	return [...groups.values()]
		.map((group) => {
			const playerIds = new Set(group.entries.map(entry => entry.playerId));
			const deckIds = new Set(group.entries.map(entry => entry.deckId));
			return {
				...group,
				affectedPlayerCount: playerIds.size,
				affectedDeckCount: deckIds.size,
				entries: [...group.entries].sort((a, b) => {
					if (a.playerName !== b.playerName)
						return a.playerName.localeCompare(b.playerName);
					if (a.deckId !== b.deckId)
						return a.deckId - b.deckId;
					return a.sortOrder - b.sortOrder;
				}),
			};
		})
		.sort((a, b) => {
			if (b.entryCount !== a.entryCount)
				return b.entryCount - a.entryCount;
			if (a.entryType !== b.entryType)
				return a.entryType.localeCompare(b.entryType);
			return a.originalName.localeCompare(b.originalName);
		});
}

export function formatUnresolvedDeckGroupEntryLabel(entry: MeleeUnresolvedDeckCardResponse): string {
	if (entry.entryType === 'companion')
		return 'Companion';

	return `${entry.quantity}x ${entry.compartment}`;
}

export function getScryfallSearchImageUrl(card: ScryfallSearchResult): string | null {
	return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? null;
}

function unresolvedDeckCardsCountLabel(groupCount: number, entryCount: number): string {
	if (groupCount === 0)
		return '0 unresolved deck entries';

	return `${groupCount} unresolved group${groupCount === 1 ? '' : 's'} across ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}`;
}

export function useMeleeSyncUnresolvedDeckListResolution(
	options: UseMeleeSyncUnresolvedDeckListResolutionOptions,
) {
	const eventRepo = useEventRepository();
	const playerStore = usePlayerStore();
	const { runRequest } = useRequestFeedback();

	const unresolvedDeckCards = ref<MeleeUnresolvedDeckCardResponse[]>([]);
	const unresolvedDeckCardsLoading = ref(false);
	const unresolvedDeckCardsError = ref<string | null>(null);
	const resolveModalOpen = ref(false);
	const selectedUnresolvedGroupKey = ref<string | null>(null);
	const resolveSearchTerm = ref('');
	const resolveSearchLoading = ref(false);
	const resolveSearchError = ref<string | null>(null);
	const resolvingScryfallId = ref<string | null>(null);
	const resolveSearchResults = ref<ScryfallSearchResult[]>([]);
	let unresolvedLoadGeneration = 0;
	let unresolvedLoadedEventId: number | null = null;
	let resolveSearchGeneration = 0;
	let resolveSearchController: AbortController | null = null;

	const unresolvedDeckCardGroups = computed(() => groupUnresolvedDeckCards(unresolvedDeckCards.value));
	const firstResolveSearchResult = computed(() => resolveSearchResults.value[0] ?? null);
	const unresolvedDeckCardsCountText = computed(() => unresolvedDeckCardsCountLabel(
		unresolvedDeckCardGroups.value.length,
		unresolvedDeckCards.value.length,
	));
	const activeUnresolvedGroupIndex = computed(() =>
		unresolvedDeckCardGroups.value.findIndex(group => group.key === selectedUnresolvedGroupKey.value),
	);
	const activeUnresolvedGroup = computed(() => {
		const index = activeUnresolvedGroupIndex.value;
		return index >= 0 ? unresolvedDeckCardGroups.value[index]! : null;
	});

	async function loadUnresolvedDeckCards() {
		const generation = ++unresolvedLoadGeneration;
		const currentEventId = toValue(options.eventId);
		if (!currentEventId || !toValue(options.isSetupComplete)) {
			unresolvedDeckCards.value = [];
			unresolvedDeckCardsLoading.value = false;
			unresolvedDeckCardsError.value = null;
			unresolvedLoadedEventId = null;
			return;
		}

		if (unresolvedLoadedEventId !== currentEventId)
			unresolvedDeckCards.value = [];
		unresolvedDeckCardsError.value = null;
		unresolvedDeckCardsLoading.value = true;
		try {
			const entries = await eventRepo.listUnresolvedDeckCards(currentEventId);
			if (generation === unresolvedLoadGeneration && toValue(options.eventId) === currentEventId) {
				unresolvedDeckCards.value = entries;
				unresolvedLoadedEventId = currentEventId;
			}
		}
		catch (error) {
			if (generation === unresolvedLoadGeneration && toValue(options.eventId) === currentEventId) {
				if (unresolvedLoadedEventId !== currentEventId)
					unresolvedDeckCards.value = [];
				unresolvedDeckCardsError.value = errorMessage(error, 'Could not load unresolved deck cards.');
			}
		}
		finally {
			if (generation === unresolvedLoadGeneration && toValue(options.eventId) === currentEventId)
				unresolvedDeckCardsLoading.value = false;
		}
	}

	function invalidateResolveSearch() {
		resolveSearchGeneration++;
		resolveSearchController?.abort();
		resolveSearchController = null;
		resolveSearchResults.value = [];
		resolveSearchLoading.value = false;
		resolveSearchError.value = null;
	}

	function closeResolveModal() {
		invalidateResolveSearch();
		resolveModalOpen.value = false;
		resolveSearchTerm.value = '';
		resolvingScryfallId.value = null;
	}

	async function searchResolveCandidates() {
		const generation = ++resolveSearchGeneration;
		resolveSearchController?.abort();
		resolveSearchController = null;
		resolveSearchError.value = null;
		const search = resolveSearchTerm.value.trim();
		if (search.length < 2) {
			resolveSearchResults.value = [];
			resolveSearchLoading.value = false;
			return;
		}

		const controller = new AbortController();
		resolveSearchController = controller;
		resolveSearchLoading.value = true;
		try {
			const response = await $fetch<{ data: ScryfallSearchResult[] }>('https://api.scryfall.com/cards/search', {
				query: {
					q: `${search} game:paper`,
					unique: 'cards',
					order: 'name',
				},
				signal: controller.signal,
				timeout: SCRYFALL_CLIENT_TIMEOUT_MS,
			});
			if (generation === resolveSearchGeneration)
				resolveSearchResults.value = response.data.slice(0, 8);
		}
		catch (error) {
			if (generation === resolveSearchGeneration && !controller.signal.aborted) {
				resolveSearchResults.value = [];
				resolveSearchError.value = errorMessage(error, 'Could not search Scryfall.');
			}
		}
		finally {
			if (resolveSearchController === controller)
				resolveSearchController = null;
			if (generation === resolveSearchGeneration)
				resolveSearchLoading.value = false;
		}
	}

	const debouncedSearchResolveCandidates = useDebounceFn(() => {
		void searchResolveCandidates();
	}, 300);

	function syncResolveSearchToGroup(group: UnresolvedDeckCardGroup | null) {
		if (!group) {
			resolveSearchTerm.value = '';
			resolveSearchResults.value = [];
			return;
		}

		resolveSearchTerm.value = group.originalName;
		resolveSearchResults.value = [];
		if (resolveModalOpen.value)
			void searchResolveCandidates();
	}

	function openResolveModal(groupKey?: string) {
		if (groupKey)
			selectedUnresolvedGroupKey.value = groupKey;
		resolveModalOpen.value = true;
	}

	function goToPreviousUnresolvedGroup() {
		if (activeUnresolvedGroupIndex.value <= 0)
			return;

		selectedUnresolvedGroupKey.value = unresolvedDeckCardGroups.value[activeUnresolvedGroupIndex.value - 1]!.key;
	}

	function goToNextUnresolvedGroup() {
		if (activeUnresolvedGroupIndex.value < 0 || activeUnresolvedGroupIndex.value >= unresolvedDeckCardGroups.value.length - 1)
			return;

		selectedUnresolvedGroupKey.value = unresolvedDeckCardGroups.value[activeUnresolvedGroupIndex.value + 1]!.key;
	}

	async function resolveUnresolvedDeckCard(card: ScryfallSearchResult) {
		const currentEventId = toValue(options.eventId);
		if (!currentEventId || !activeUnresolvedGroup.value)
			return;

		const previousIndex = Math.max(activeUnresolvedGroupIndex.value, 0);
		const unresolvedId = activeUnresolvedGroup.value.entries[0]!.id;
		resolvingScryfallId.value = card.id;
		await runRequest(async () => {
			const response = await eventRepo.resolveUnresolvedDeckCard(currentEventId, unresolvedId, {
				scryfallId: card.id,
			});
			clearPlayerDeckCache();
			await playerStore.loadPlayersByEventId(currentEventId);
			await loadUnresolvedDeckCards();

			if (unresolvedDeckCardGroups.value.length === 0) {
				closeResolveModal();
			}
			else {
				selectedUnresolvedGroupKey.value = unresolvedDeckCardGroups.value[Math.min(previousIndex, unresolvedDeckCardGroups.value.length - 1)]!.key;
			}

			return response;
		}, {
			success: response => ({
				title: 'Deck Card Resolved',
				description: response.message,
				color: 'success',
			}),
			error: ({ message }) => ({
				title: 'Resolution Failed',
				description: message,
				color: 'error',
			}),
		});
		resolvingScryfallId.value = null;
	}

	function resolveFirstSearchResult() {
		if (firstResolveSearchResult.value)
			void resolveUnresolvedDeckCard(firstResolveSearchResult.value);
	}

	watch(unresolvedDeckCardGroups, (groups) => {
		if (groups.length === 0) {
			selectedUnresolvedGroupKey.value = null;
			return;
		}

		if (groups.some(group => group.key === selectedUnresolvedGroupKey.value))
			return;

		selectedUnresolvedGroupKey.value = groups[0]!.key;
	}, { immediate: true });

	watch(() => activeUnresolvedGroup.value?.key, () => {
		syncResolveSearchToGroup(activeUnresolvedGroup.value);
	});

	watch(resolveModalOpen, (isOpen) => {
		if (isOpen)
			syncResolveSearchToGroup(activeUnresolvedGroup.value);
	});

	watch(resolveSearchTerm, () => {
		// Invalidate visible results immediately, before the debounced replacement
		// request starts, so a result for the previous term cannot be selected.
		invalidateResolveSearch();
	}, { flush: 'sync' });

	watch([() => toValue(options.eventId), () => toValue(options.isSetupComplete)], () => {
		void loadUnresolvedDeckCards();
	}, { immediate: true });

	onScopeDispose(() => {
		unresolvedLoadGeneration++;
		resolveSearchGeneration++;
		resolveSearchController?.abort();
		resolveSearchController = null;
	});

	return {
		unresolvedDeckCards,
		unresolvedDeckCardsLoading,
		unresolvedDeckCardsError,
		resolveModalOpen,
		selectedUnresolvedGroupKey,
		resolveSearchTerm,
		resolveSearchLoading,
		resolveSearchError,
		resolvingScryfallId,
		resolveSearchResults,
		firstResolveSearchResult,
		unresolvedDeckCardGroups,
		unresolvedDeckCardsCountLabel: unresolvedDeckCardsCountText,
		activeUnresolvedGroupIndex,
		activeUnresolvedGroup,
		loadUnresolvedDeckCards,
		closeResolveModal,
		getResolveSearchImageUrl: getScryfallSearchImageUrl,
		searchResolveCandidates,
		debouncedSearchResolveCandidates,
		openResolveModal,
		goToPreviousUnresolvedGroup,
		goToNextUnresolvedGroup,
		resolveUnresolvedDeckCard,
		resolveFirstSearchResult,
		formatGroupEntryLabel: formatUnresolvedDeckGroupEntryLabel,
	};
}
