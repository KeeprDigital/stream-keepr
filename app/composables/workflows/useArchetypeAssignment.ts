import type { ComputedRef, Ref } from 'vue';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { ReviewEntry } from './useArchetypeReviewQueue';
import type { Archetype } from '~/types';
import { isReviewedPlayerDeck } from '~~/shared/utils/playerDeck';

interface UseArchetypeAssignmentOptions {
	currentEntry: ComputedRef<ReviewEntry | null>;
	activeDeck: Ref<PlayerDeckResponse | null>;
	eventId: ComputedRef<number | null>;
	prepareAdvance: () => { commit: () => void; cancel: () => void };
	archetypePlayerCounts: ComputedRef<Map<number, number>>;
}

export function useArchetypeAssignment({
	currentEntry,
	activeDeck,
	eventId,
	prepareAdvance,
	archetypePlayerCounts,
}: UseArchetypeAssignmentOptions) {
	const archetypeStore = useArchetypeStore();
	const playerDeckStore = usePlayerDeckStore();
	const { runRequest } = useRequestFeedback();

	// ── Form state ──

	const nameInput = ref('');
	const colorsInput = ref<string[]>([]);
	/** Selected key card names (strings) for UI toggling */
	const selectedKeyCards = ref<Set<string>>(new Set());
	const saving = ref(false);

	// ── Derived state ──

	/** A deck is in edit mode once this stable submitted deck has been reviewed. */
	const isEditMode = computed(() => currentEntry.value
		? isReviewedPlayerDeck(currentEntry.value.deck)
		: false);

	const existingArchetypeByName = computed(() => {
		const name = nameInput.value.trim();
		if (!name)
			return null;
		return archetypeStore.findByName(name) ?? null;
	});

	const matchesExistingArchetype = computed(() => {
		const name = nameInput.value.trim();
		if (!name)
			return null;
		return archetypeStore.findByNameAndColors(name, colorsInput.value) ?? null;
	});

	const archetypeForAssignment = computed(() => matchesExistingArchetype.value ?? existingArchetypeByName.value);

	const hasColorMismatch = computed(() => {
		return existingArchetypeByName.value != null && matchesExistingArchetype.value == null;
	});

	const matchingArchetypeId = computed(() => archetypeForAssignment.value?.id ?? null);

	const isNameValid = computed(() => nameInput.value.trim().length > 0);

	/** The Archetype the deck under review is reviewed as. */
	const currentArchetype = computed(() => isEditMode.value
		? archetypeStore.archetypes.find(archetype => archetype.id === currentEntry.value?.deck.archetypeId) ?? null
		: null);

	/**
	 * A name no Archetype holds, typed on a deck already reviewed: accepting it
	 * renames the deck's Archetype, for every deck it holds. Giving this deck a
	 * new Archetype of that name instead is `createForDeck`.
	 */
	const renamesArchetype = computed(() => isNameValid.value && currentArchetype.value != null && existingArchetypeByName.value == null);

	/** How many decks hold the deck's own Archetype, this one among them. */
	const currentArchetypeDeckCount = computed(() => currentArchetype.value
		? archetypePlayerCounts.value.get(currentArchetype.value.id) ?? 1
		: 0);

	/** Whether the rename can instead be a new Archetype for this deck: only while other decks would keep the old one. */
	const canSplit = computed(() => renamesArchetype.value && currentArchetypeDeckCount.value > 1);

	/** The Archetype a save writes to: the one renamed, or the one the typed name holds. */
	const targetArchetype = computed(() => renamesArchetype.value
		? currentArchetype.value
		: archetypeForAssignment.value);

	/** True if key card selection differs from what's stored on the Archetype the save writes to */
	const hasKeyCardChanges = computed(() => {
		const archetype = targetArchetype.value;
		if (!archetype)
			return false;
		const stored = new Set((archetype.keyCards ?? []).map(kc => kc.name));
		if (stored.size !== selectedKeyCards.value.size)
			return true;
		for (const kc of selectedKeyCards.value) {
			if (!stored.has(kc))
				return true;
		}
		return false;
	});

	const buttonLabel = computed(() => {
		if (renamesArchetype.value) {
			return currentArchetypeDeckCount.value > 1
				? `Rename for all ${currentArchetypeDeckCount.value} decks`
				: 'Rename archetype';
		}
		if (!existingArchetypeByName.value)
			return 'Create & Assign';
		if (hasColorMismatch.value)
			return isEditMode.value ? 'Update & Reassign' : 'Update & Assign';
		if (isEditMode.value) {
			if (hasKeyCardChanges.value)
				return 'Update & Reassign';
			return 'Reassign';
		}
		return 'Assign';
	});

	/**
	 * What a save changes beyond this deck: colours and key cards are the
	 * Archetype's, so changing them changes them for every other deck it holds.
	 * A rename says so on its button.
	 */
	const impactNote = computed(() => {
		const archetype = archetypeForAssignment.value;
		if (renamesArchetype.value || !archetype || !(hasColorMismatch.value || hasKeyCardChanges.value))
			return null;
		const held = archetypePlayerCounts.value.get(archetype.id) ?? 0;
		const others = currentArchetype.value?.id === archetype.id
			? held - 1
			: held;
		return others > 0
			? `Also updates “${archetype.name}” for ${others} other ${others === 1
				? 'deck'
				: 'decks'}.`
			: null;
	});

	// ── Archetype picker data ──

	const currentDeckCardNames = computed(() => {
		if (!activeDeck.value)
			return new Set<string>();
		return new Set(activeDeck.value.cards.map(c => c.name));
	});

	const archetypeKeyCardMatches = computed(() => {
		const map = new Map<number, Set<string>>();
		for (const archetype of archetypeStore.archetypes) {
			const keyCardNames = (archetype.keyCards ?? []).map(kc => kc.name);
			if (!keyCardNames.length)
				continue;
			const matches = new Set(keyCardNames.filter(kc => currentDeckCardNames.value.has(kc)));
			if (matches.size > 0)
				map.set(archetype.id, matches);
		}
		return map;
	});

	/** Archetypes sorted by key card match count, then reviewed deck count. */
	const sortedArchetypes = computed(() => {
		return [...archetypeStore.archetypes].sort((a, b) => {
			const matchA = archetypeKeyCardMatches.value.get(a.id)?.size ?? 0;
			const matchB = archetypeKeyCardMatches.value.get(b.id)?.size ?? 0;
			if (matchA !== matchB)
				return matchB - matchA;
			const countA = archetypePlayerCounts.value.get(a.id) ?? 0;
			const countB = archetypePlayerCounts.value.get(b.id) ?? 0;
			return countB - countA;
		});
	});

	// ── Watchers ──

	// The queue rebuilds its entries on every Player or deck message, so the form
	// follows the deck under review and its review, not the entry's identity:
	// anything else would revert what the reviewer is typing.
	const reviewSubject = computed(() => {
		const deck = currentEntry.value?.deck;
		return deck
			? `${deck.id}:${isReviewedPlayerDeck(deck)
				? deck.archetypeId
				: ''}`
			: null;
	});

	watch(reviewSubject, () => {
		const entry = currentEntry.value;
		if (entry) {
			nameInput.value = entry.displayName;
			colorsInput.value = entry.displayColors
				? entry.displayColors.split('')
				: [];
			// Pre-populate key cards from the matched archetype if already assigned
			const archetype = archetypeStore.archetypes.find(a => a.id === entry.deck.archetypeId);
			if (archetype?.keyCards?.length) {
				selectedKeyCards.value = new Set(archetype.keyCards.map(kc => kc.name));
			}
			else {
				const namedArch = archetypeStore.findByName(nameInput.value.trim());
				selectedKeyCards.value = namedArch?.keyCards?.length
					? new Set(namedArch.keyCards.map(kc => kc.name))
					: new Set();
			}
		}
	}, { immediate: true });

	watch(archetypeForAssignment, (val) => {
		if (val?.keyCards?.length) {
			selectedKeyCards.value = new Set(val.keyCards.map(kc => kc.name));
		}
		else if (!isEditMode.value) {
			selectedKeyCards.value.clear();
		}
	});

	// ── Helpers ──

	async function saveKeyCards(archetypeId: number) {
		if (!eventId.value)
			throw new Error('Event not loaded');

		await archetypeStore.setKeyCards(eventId.value, archetypeId, [...selectedKeyCards.value]);
	}

	async function updateArchetypeColors(archetype: Archetype) {
		if (!eventId.value)
			throw new Error('Event not loaded');

		const colors = colorsInput.value.length > 0
			? colorsInput.value.join('')
			: null;
		const updated = await archetypeStore.updateArchetype(eventId.value, archetype.id, { colors });
		if (!updated)
			throw new Error(archetypeStore.error ?? 'Failed to update archetype');

		return updated;
	}

	// ── Actions ──

	async function applyAssignment(archetype: Archetype) {
		if (!currentEntry.value || !eventId.value)
			return;

		const entry = currentEntry.value;
		await playerDeckStore.reviewDeck(eventId.value, entry.player.id, entry.deck.id, archetype.id);
	}

	async function assignArchetype(archetype: Archetype) {
		if (saving.value)
			return;
		const transition = prepareAdvance();
		await runRequest(async () => {
			await applyAssignment(archetype);
			transition.commit();
			return true;
		}, {
			loadingRef: saving,
			success: false,
			error: ({ message }) => ({
				title: message,
				color: 'error',
			}),
			onFailure: () => {
				transition.cancel();
			},
		});
	}

	function selectArchetype(archetype: Archetype) {
		nameInput.value = archetype.name;
		colorsInput.value = archetype.colors
			? archetype.colors.split('')
			: [];
	}

	function handleChipClick(archetype: Archetype) {
		if (isEditMode.value) {
			selectArchetype(archetype);
		}
		else {
			void assignArchetype(archetype);
		}
	}

	/** Accepts the typed name: renames the deck's Archetype where the name is new to a reviewed deck, else assigns. */
	async function acceptName() {
		await save(renamesArchetype.value ? 'rename' : 'assign');
	}

	/** Gives this deck a new Archetype of the typed name, leaving its old one to the decks that keep it. */
	async function createForDeck() {
		await save('assign');
	}

	/** Returns a reviewed deck to unreviewed, staying on it. Its Archetype stays, empty or not. */
	async function clearAssignment() {
		const entry = currentEntry.value;
		if (!eventId.value || !entry || saving.value || !isEditMode.value)
			return;
		const currentEventId = eventId.value;
		await runRequest(async () => {
			await playerDeckStore.clearDeckReview(currentEventId, entry.player.id, entry.deck.id);
			return true;
		}, {
			loadingRef: saving,
			success: false,
			error: ({ message }) => ({
				title: message,
				color: 'error',
			}),
		});
	}

	async function save(intent: 'rename' | 'assign') {
		const currentEventId = eventId.value;
		if (!currentEventId || !currentEntry.value || saving.value || !isNameValid.value)
			return;

		// A deck being reviewed moves on to the next; one already reviewed was come back to, and stays.
		const transition = isEditMode.value
			? null
			: prepareAdvance();

		await runRequest(async () => {
			const name = nameInput.value.trim();
			const colors = colorsInput.value.length > 0
				? colorsInput.value.join('')
				: null;

			const renamed = currentArchetype.value;
			if (intent === 'rename' && renamed) {
				const keyCardsChanged = hasKeyCardChanges.value;
				const updated = await archetypeStore.updateArchetype(currentEventId, renamed.id, { name, colors });
				if (!updated)
					throw new Error(archetypeStore.error ?? 'Failed to rename archetype');
				if (keyCardsChanged)
					await saveKeyCards(renamed.id);
				return true;
			}

			const existing = matchesExistingArchetype.value;
			if (existing) {
				if (hasKeyCardChanges.value) {
					await saveKeyCards(existing.id);
				}
				await applyAssignment(existing);
				return true;
			}

			const sameName = existingArchetypeByName.value;
			if (sameName) {
				const updated = await updateArchetypeColors(sameName);
				if (hasKeyCardChanges.value) {
					await saveKeyCards(updated.id);
				}
				await applyAssignment(updated);
				return true;
			}

			// Create new archetype
			const created = await archetypeStore.createArchetype(currentEventId, { name, colors });
			if (!created)
				throw new Error(archetypeStore.error ?? 'Failed to create archetype');

			// Save key cards for new archetype
			if (selectedKeyCards.value.size > 0) {
				await saveKeyCards(created.id);
			}
			await applyAssignment(created);
			return true;
		}, {
			loadingRef: saving,
			success: false,
			error: ({ message }) => ({
				title: message,
				color: 'error',
			}),
			onSuccess: () => {
				transition?.commit();
			},
			onFailure: () => {
				transition?.cancel();
			},
		});
	}

	function toggleKeyCard(name: string) {
		if (selectedKeyCards.value.has(name)) {
			selectedKeyCards.value.delete(name);
		}
		else {
			selectedKeyCards.value.add(name);
		}
	}

	return {
		nameInput,
		colorsInput,
		selectedKeyCards,
		saving,
		isEditMode,
		matchesExistingArchetype,
		matchingArchetypeId,
		isNameValid,
		hasKeyCardChanges,
		canSplit,
		impactNote,
		buttonLabel,
		archetypeKeyCardMatches,
		sortedArchetypes,
		toggleKeyCard,
		acceptName,
		createForDeck,
		clearAssignment,
		assignArchetype,
		selectArchetype,
		handleChipClick,
	};
}
