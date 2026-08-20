<script setup lang="ts">
import { getMtgGameData } from '~~/shared/utils/gameData';
import { LazyMtgCardHistory } from '#components';

definePageMeta({
	title: 'Cards',
	layout: false,
});

const eventStore = useEventStore();
const cardStore = useCardStore();
const featureMatchStore = useFeatureMatchStore();
const assignmentStore = useFeatureMatchAssignmentStore();
const matchStore = useMatchStore();
const phaseStore = usePhaseStore();
const playerStore = usePlayerStore();
const roundStore = useRoundStore();
const screenStore = useScreenStore();

const historyModal = useOverlay().create(LazyMtgCardHistory);

function openHistory() {
	void historyModal.open({});
}

const {
	activeScreenId,
	cardPageMode: activeMode,
	deckListMatchId: storedDeckListMatchId,
	deckListRoundId: storedDeckListRoundId,
	playerDeckPlayerId: storedPlayerDeckPlayerId,
} = storeToRefs(cardStore);

function optionalId(source: Ref<number | null>) {
	return computed<number | undefined>({
		get: () => source.value ?? undefined,
		set: (value) => {
			source.value = value ?? null;
		},
	});
}

// Event-scoped view selections live in the card store so route navigation preserves them.
const selectedScreenId = optionalId(activeScreenId);
const deckListRoundId = optionalId(storedDeckListRoundId);
const deckListMatchId = optionalId(storedDeckListMatchId);
const playerDeckPlayerId = optionalId(storedPlayerDeckPlayerId);

// Filter screens to only those in card mode
const cardScreens = computed(() =>
	screenStore.screens.filter(s => s.currentMode === 'card'),
);

// Get the selected screen object
const selectedScreen = computed(() =>
	cardScreens.value.find(s => s.id === selectedScreenId.value) ?? null,
);

function syncSelectedScreen() {
	const hasSelectedScreen = cardScreens.value.some(s => s.id === selectedScreenId.value);
	if (hasSelectedScreen)
		return;
	selectedScreenId.value = cardScreens.value[0]?.id;
}

// Get the matchId from the selected screen's card config (if any)
const selectedScreenMatchId = computed<number | null>(() => {
	if (!selectedScreen.value)
		return null;
	const modeConfigs = (selectedScreen.value.modeConfigs ?? {});
	const cardConfig = modeConfigs.card;
	return cardConfig?.featureMatchId ?? null;
});

const { initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => featureMatchStore.isLoaded, load: id => featureMatchStore.loadFeatureMatchesByEventId(id) },
	{ isLoaded: () => phaseStore.isLoaded, load: id => phaseStore.loadPhasesByEventId(id) },
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
	{ isLoaded: () => roundStore.isLoaded, load: id => roundStore.loadRoundsByEventId(id) },
	{ isLoaded: () => screenStore.isLoaded, load: id => screenStore.loadScreensByEventId(id) },
], async () => {
	syncSelectedScreen();
	await syncCardScope();
});

async function syncCardScope() {
	if (!selectedScreenId.value) {
		cardStore.setActiveScreen(null);
		return;
	}
	cardStore.setActiveScreen(selectedScreenId.value);
	await cardStore.loadActiveCard();
}

watch(cardScreens, () => {
	syncSelectedScreen();
});

watch(selectedScreenId, async (screenId) => {
	await syncCardScope();

	if (screenId) {
		// Check if the screen is tied to a match with decklists
		const matchId = selectedScreenMatchId.value;
		if (matchId) {
			const match = featureMatchStore.featureMatches.find(m => m.id === matchId);
			if (match) {
				// Check if this match has decklist data
				const p1Name = match.player1Data?.name;
				const p2Name = match.player2Data?.name;
				const hasDecklists = [p1Name, p2Name].some(name =>
					name && playerStore.players.some(
						p => p.name.toLowerCase() === name.toLowerCase() && getMtgGameData(p.gameData).deckName,
					),
				);
				if (hasDecklists) {
					activeMode.value = 'match-decklist';
					deckListMatchId.value = matchId;
				}
			}
		}
		// If screen is not tied to a match, don't change mode
	}
});

const roundOptions = computed(() => roundStore.rounds.map((round) => {
	const phase = phaseStore.getPhaseById(round.phaseId);
	return {
		label: formatRoundOptionLabel(round, phase),
		value: round.id,
	};
}));

const matchOptions = computed(() => {
	const assignments = deckListRoundId.value
		? assignmentStore.assignmentsForRound(deckListRoundId.value)
		: [];
	const matches = matchStore.matches;
	const assignedMatchIds = new Set(assignments.map(assignment => assignment.matchId));
	return matches
		.filter(match => !match.isBye && (assignedMatchIds.size === 0 || assignedMatchIds.has(match.id)))
		.map((match) => {
			const assignment = assignments.find(item => item.matchId === match.id);
			const featureMatches = featureMatchStore.featureMatches;
			const slotIndex = assignment
				? featureMatches.findIndex(slot => slot.id === assignment.slotId)
				: -1;
			const slotLabel = slotIndex >= 0 ? `Feature ${slotIndex + 1}: ` : '';
			const player1 = match.player1Id ? playerStore.players.find(player => player.id === match.player1Id) : null;
			const player2 = match.player2Id ? playerStore.players.find(player => player.id === match.player2Id) : null;
			const player1Fallback = getMtgGameData(match.player1Data?.gameData);
			const player2Fallback = getMtgGameData(match.player2Data?.gameData);
			const p1 = player1 ? getMtgGameData(player1.gameData) : player1Fallback;
			const p2 = player2 ? getMtgGameData(player2.gameData) : player2Fallback;
			return {
				label: `${slotLabel}${match.player1Data?.name ?? 'TBD'} vs ${match.player2Data?.name ?? 'TBD'}`,
				value: match.id,
				player1Name: match.player1Data?.name ?? null,
				player1DeckName: p1.deckName ?? null,
				player1Colors: p1.deckColors ?? null,
				player2Name: match.player2Data?.name ?? null,
				player2DeckName: p2.deckName ?? null,
				player2Colors: p2.deckColors ?? null,
			};
		});
});

const selectedDeckListMatch = computed(() =>
	deckListMatchId.value ? matchStore.matches.find(match => match.id === deckListMatchId.value) ?? null : null,
);
const selectedDeckListAssignment = computed(() => {
	if (!deckListRoundId.value || !deckListMatchId.value)
		return null;
	return assignmentStore.assignmentsForRound(deckListRoundId.value)
		.find(assignment => assignment.matchId === deckListMatchId.value) ?? null;
});

async function saveSelectedAssignmentNote(note: string) {
	if (!eventStore.eventId || !selectedDeckListAssignment.value)
		return;
	await assignmentStore.updateAssignment(eventStore.eventId, selectedDeckListAssignment.value.id, { note: note.trim() || null });
}

// Auto-select the first matchup when entering match-decklist mode.
watch(activeMode, (mode) => {
	if (mode === 'match-decklist' && !deckListMatchId.value && matchOptions.value.length) {
		deckListMatchId.value = matchOptions.value[0]!.value;
	}
});

watch(roundOptions, (options) => {
	if (!deckListRoundId.value && options[0])
		deckListRoundId.value = options[0].value;
}, { immediate: true });

watch([() => eventStore.eventId, deckListRoundId], async ([eventId, roundId], _, onCleanup) => {
	if (!eventId || !roundId)
		return;
	const releaseRound = assignmentStore.consumeRound(eventId, roundId);
	onCleanup(releaseRound);
	await Promise.all([
		matchStore.loadMatchesByRoundId(eventId, roundId),
		assignmentStore.loadAssignments(eventId, roundId),
	]);
	if (!matchOptions.value.some(option => option.value === deckListMatchId.value)) {
		deckListMatchId.value = matchOptions.value[0]?.value;
	}
}, { immediate: true });

const timeoutProgress = computed(() => {
	if (!cardStore.activeCard?.timeoutData || !cardStore.timeout.remaining)
		return 0;
	const totalSeconds = cardStore.activeCard.timeoutData.timeoutDuration / 1000;
	return Math.max(0, (cardStore.timeout.remaining / totalSeconds) * 100);
});
</script>

<template>
	<NuxtLayout name="default" flush>
		<template #navbar-center>
			<UFieldGroup v-if="cardStore.activeCard" size="md">
				<UButton
					class="relative overflow-hidden"
					color="primary"
					variant="soft"
					@click="() => { cardStore.showCardControls = true }"
				>
					<!-- Progress fill -->
					<div
						v-if="cardStore.timeout.remaining > 0"
						class="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-1000 linear"
						:style="{ width: `${timeoutProgress}%` }"
					/>
					<!-- Content -->
					<span class="relative z-10 font-medium">
						{{ cardStore.activeCard.name }}
					</span>
					<span
						v-if="cardStore.timeout.remaining > 0"
						class="relative z-10 whitespace-nowrap text-muted tabular-nums"
					>
						({{ cardStore.timeout.remaining }}s)
					</span>
				</UButton>
				<UButton
					aria-label="Clear active card"
					color="neutral"
					icon="i-lucide-x"
					square
					variant="soft"
					@click="cardStore.controlActiveCard('clear')"
				/>
			</UFieldGroup>
		</template>

		<template #actions>
			<div class="flex items-center gap-1">
				<template v-if="cardScreens.length">
					<UButton
						v-for="screen in cardScreens"
						:key="screen.id"
						:color="selectedScreenId === screen.id ? 'primary' : 'neutral'"
						:variant="selectedScreenId === screen.id ? 'subtle' : 'outline'"
						size="xs"
						@click="() => { selectedScreenId = screen.id }"
					>
						{{ screen.name }}
					</UButton>
				</template>
				<span v-else class="text-sm text-muted">
					No card screens configured
				</span>
			</div>
		</template>

		<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

		<UILoadingSpinner v-else-if="initialLoading" />

		<div v-else class="h-full flex flex-col overflow-y-auto">
			<!-- Header Bar with Mode Toggle -->
			<div class="sticky top-0 z-10 m-4">
				<div class="flex items-center gap-3">
					<!-- Mode Toggle (always visible) -->
					<MtgCardModeToggle
						v-model="activeMode"
						:match-decklist-disabled="!cardStore.canUseDeckListMode && matchOptions.length === 0"
						:player-decklist-disabled="!cardStore.canUsePlayerDeckMode"
					/>

					<!-- Mode-specific header controls -->
					<div class="flex-1">
						<div v-show="activeMode === 'search'">
							<MtgCardSearch />
						</div>
						<div v-show="activeMode === 'match-decklist'">
							<MtgCardDeckListHeader
								v-model:deck-list-match-id="deckListMatchId"
								v-model:deck-list-round-id="deckListRoundId"
								:round-options="roundOptions"
								:match-options="matchOptions"
								:selected-match="selectedDeckListMatch"
								:selected-assignment="selectedDeckListAssignment"
								:save-assignment-note="saveSelectedAssignmentNote"
								:assignment-note-remote-changed="selectedDeckListAssignment ? assignmentStore.isRemoteChanged(selectedDeckListAssignment.id) : false"
							/>
						</div>
						<div v-show="activeMode === 'player-decklist'">
							<MtgCardPlayerDeckHeader
								v-model:player-id="playerDeckPlayerId"
							/>
						</div>
					</div>

					<!-- Shared controls -->
					<UButton
						:disabled="!cardStore.selectionHistory.length"
						size="xl"
						variant="outline"
						color="neutral"
						icon="i-lucide-history"
						@click="openHistory"
					>
						History
					</UButton>
					<UButton
						size="xl"
						variant="outline"
						:color="cardStore.activeCard ? 'primary' : 'neutral'"
						icon="i-lucide-panel-right"
						aria-label="Card controls"
						@click="() => { cardStore.showCardControls = true }"
					/>
				</div>
			</div>

			<!-- Search Results -->
			<div v-show="activeMode === 'search'" class="flex-1 overflow-y-auto p-4">
				<MtgCardList
					:cards="cardStore.searchResults"
					@selected="cardStore.selectPreviewCard"
				/>
			</div>

			<!-- Feature Match Deck List Content -->
			<div v-show="activeMode === 'match-decklist'" class="flex-1 overflow-y-auto p-4">
				<MtgCardDeckList />
			</div>

			<!-- Player Deck List Content -->
			<div v-show="activeMode === 'player-decklist'" class="flex-1 overflow-y-auto p-4">
				<MtgCardPlayerDeck />
			</div>
		</div>
	</NuxtLayout>
	<!-- Card Controls - Size based on viewport height with a fixed aspect ratio -->
	<USlideover
		v-model:open="cardStore.showCardControls"
		side="right"
		:ui="{ content: `max-w-[clamp(180px,calc((100dvh-24rem)*61/170+2rem),360px)]` }"
	>
		<template #content>
			<MtgCardControls />
		</template>
	</USlideover>
</template>
