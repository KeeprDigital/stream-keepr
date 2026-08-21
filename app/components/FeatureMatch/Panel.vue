<script setup lang="ts">
import type { FeatureMatchData, FeatureMatchFormData, PlayerData, PlayerDisplayConfig, UpdateFeatureMatchInput } from '~/types';
import { DEFAULT_PLAYER_DATA, toPlayerData } from '~/types';
import { buildFeatureMatchSetupUpdate } from '~/utils/featureMatchSetup';

const props = defineProps<{
	match: FeatureMatchData;
	matchNumber: number;
	isFirst?: boolean;
	isLast?: boolean;
}>();

const featureMatchStore = useFeatureMatchStore();
const eventStore = useEventStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const assignmentStore = useFeatureMatchAssignmentStore();
const playerStore = usePlayerStore();
const roundStore = useRoundStore();
const matchRepository = useMatchRepository();
const { runRequest } = useRequestFeedback();

// Panel view: game controls vs setup/edit
const panelView = ref<'game' | 'setup'>('game');
const stateLoading = ref(false);
const tokensModalOpen = ref(false);

const isVerticalArena = computed(() => eventStore.event?.featureMatchOrientation === 'vertical');
const game = computed(() => (eventStore.event?.game ?? 'mtg'));

// Computed match state for this match
const matchState = computed(() => {
	return featureMatchStateStore.featureMatchStates.get(props.match.id) ?? null;
});
const featureMatchAssignment = computed(() => assignmentStore.assignments.find(assignment =>
	assignment.slotId === props.match.id && assignment.matchId === props.match.matchId,
) ?? null);
const assignmentNote = computed(() => featureMatchAssignment.value?.note ?? '');
const sourceMatch = ref<import('~/types').Match | null>(null);
const sourceRound = computed(() => sourceMatch.value ? roundStore.getRoundById(sourceMatch.value.roundId) : undefined);

watch(
	() => props.match.matchId,
	async (matchId, _, onCleanup) => {
		let releaseRound: (() => void) | undefined;
		let stale = false;
		onCleanup(() => {
			stale = true;
			releaseRound?.();
		});
		sourceMatch.value = null;
		if (!eventStore.eventId || !matchId)
			return;
		if (!roundStore.isLoaded)
			await roundStore.loadRoundsByEventId(eventStore.eventId);
		const linkedMatch = await matchRepository.getById(eventStore.eventId, matchId);
		if (linkedMatch && !stale) {
			sourceMatch.value = linkedMatch;
			releaseRound = assignmentStore.consumeRound(eventStore.eventId, linkedMatch.roundId);
			await assignmentStore.loadAssignments(eventStore.eventId, linkedMatch.roundId);
		}
	},
	{ immediate: true },
);

// Load match state on mount + ensure players are available for the picker
onMounted(async () => {
	if (!matchState.value && eventStore.eventId) {
		stateLoading.value = true;
		try {
			await featureMatchStateStore.loadState(eventStore.eventId, props.match.id);
		}
		finally {
			stateLoading.value = false;
		}
	}
	if (!playerStore.isLoaded && eventStore.eventId) {
		await playerStore.loadPlayersByEventId(eventStore.eventId);
	}
});

// ──────────────── Form State ────────────────

function normalizeMatchData(match: FeatureMatchData): FeatureMatchFormData {
	return {
		...match,
		player1Data: match.player1Data ? toPlayerData(match.player1Data) : { ...DEFAULT_PLAYER_DATA },
		player2Data: match.player2Data ? toPlayerData(match.player2Data) : { ...DEFAULT_PLAYER_DATA },
	};
}

const { formData, isDirty, reset, updateOriginal, getChanges } = useForm<FeatureMatchFormData>({
	initialData: normalizeMatchData(props.match),
});

useRegisterDirtyState(isDirty);

watch(() => props.match, (newMatch) => {
	if (!isDirty.value) {
		updateOriginal(normalizeMatchData(newMatch));
	}
}, { deep: true });

const matchDisplayMode = computed(() => formData.value.playerDisplayMode);
const roundNameInput = computed({
	get: () => formData.value.roundName ?? undefined,
	set: (value: string | undefined) => {
		formData.value.roundName = value ?? null;
	},
});
const formatNameInput = computed({
	get: () => formData.value.formatName ?? undefined,
	set: (value: string | undefined) => {
		formData.value.formatName = value ?? null;
	},
});
const roundPlaceholder = computed(() => sourceRound.value?.name ?? 'Round name');
const hasMeleeMatches = computed(() => {
	const matchStore = useMatchStore();
	return matchStore.matches.length > 0;
});

const player1Data = computed({
	get() { return formData.value.player1Data!; },
	set(newValue: PlayerData) { formData.value.player1Data = newValue; },
});

const player2Data = computed({
	get() { return formData.value.player2Data!; },
	set(newValue: PlayerData) { formData.value.player2Data = newValue; },
});

const player1FormId = computed(() => `feature-match-${props.match.id}-player-1-form`);
const player2FormId = computed(() => `feature-match-${props.match.id}-player-2-form`);

// ──────────────── Composables ────────────────

const {
	getDeckForCurrentPhase,
	player1ForDeckList,
	player2ForDeckList,
	player1HasDeckList,
	player2HasDeckList,
	openDeckListModal,
} = useFeatureMatchDeckList(player1Data, player2Data);
const hasAnyDeckList = computed(() => player1HasDeckList.value || player2HasDeckList.value);

const {
	turnTrackingEnabled,
	activePlayerTrackingEnabled,
	mulliganTrackingEnabled,
	pronounsEnabled,
	standingsEnabled,
	lgsEnabled,
	tableNumberEnabled,
	inMulliganPhase,
	startingHandSize,
	turnCounterMode,
	showTurnCounter,
	turnCounterLabel,
	turnHalf,
	stepBackDisabled,
	extraTurnsLabel,
	handleTurnChange,
	handleSelectFirstPlayer,
	handleNextOvertimeTurn,
	handlePrevOvertimeTurn,
	editStateOpen,
	editStateSaving,
	handleEditStateSave,
	matchActionItems,
	resetActionItems,
} = useFeatureMatchGameMode(() => props.match.id, matchState);

const {
	meleeModalOpen,
	swapPlayers,
	clearMatch,
	populateFromMelee,
} = useFeatureMatchSetupActions({
	formData,
	getDeckForCurrentPhase,
});

// ──────────────── Player Display Config ────────────────

function playerDisplayConfig(side: PlayerSide): PlayerDisplayConfig {
	return {
		showName: true,
		showDeckName: true,
		showPronouns: pronounsEnabled.value,
		showRecord: standingsEnabled.value,
		showLgs: lgsEnabled.value,
		hasDeckList: side === 'player1' ? player1HasDeckList.value : player2HasDeckList.value,
		activePlayerTrackingEnabled: activePlayerTrackingEnabled.value,
		seatLabel: isVerticalArena.value
			? (side === 'player1' ? 'Top' : 'Bottom')
			: (side === 'player1' ? 'Left' : 'Right'),
		mulliganPhase: inMulliganPhase.value,
		startingHandSize: startingHandSize.value,
	};
}

// ──────────────── Match Title ────────────────

const matchTitle = computed(() => `Match ${props.matchNumber}`);

// ──────────────── Save / Reset ────────────────

const saving = ref(false);

async function saveAssignmentNote(note: string) {
	if (!eventStore.eventId || !featureMatchAssignment.value)
		return;
	await assignmentStore.updateAssignment(eventStore.eventId, featureMatchAssignment.value.id, { note: note.trim() || null });
}

async function save() {
	if (!eventStore.eventId)
		return;

	const updateData: UpdateFeatureMatchInput = buildFeatureMatchSetupUpdate(getChanges());
	if (Object.keys(updateData).length === 0)
		return;

	await runRequest(
		async () => {
			const updatedMatch = await featureMatchStore.updateFeatureMatch(eventStore.eventId!, formData.value.id, updateData);
			if (!updatedMatch)
				throw new Error(featureMatchStore.error ?? 'The match was not updated.');
			return updatedMatch;
		},
		{
			loadingRef: saving,
			success: { title: 'Match updated successfully', color: 'success' },
			error: () => ({
				title: 'Failed to update match',
				description: featureMatchStore.error ?? 'The match was not updated.',
				color: 'error',
			}),
			onSuccess: (updatedMatch) => {
				updateOriginal(normalizeMatchData(updatedMatch));
			},
			onFailure: ({ error }) => {
				if (error)
					console.error('Failed to save match:', error);
			},
		},
	);
}
</script>

<template>
	<UCard
		v-if="formData"
		variant="subtle"
		:ui="{
			body: 'p-0!',
		}"
	>
		<!-- Header / Clock Stripe -->
		<template #header>
			<FeatureMatchPanelHeader
				:match-title="matchTitle"
				:best-of="formData.bestOf"
				:current-game="matchState?.currentGame ?? 1"
				:match-id="match.id"
				:clock="matchState?.clock ?? null"
				:state-loading="stateLoading"
				:panel-view="panelView"
				:table-number="tableNumberEnabled ? formData.tableNumber : null"
				:table-number-enabled="tableNumberEnabled"
				@update:panel-view="panelView = $event"
				@update:table-number="formData.tableNumber = $event"
			/>
		</template>

		<FeatureMatchNote
			v-if="featureMatchAssignment"
			class="mx-3 mt-3"
			:note="assignmentNote"
			:note-key="featureMatchAssignment.id"
			:save="saveAssignmentNote"
			:remote-changed="assignmentStore.isRemoteChanged(featureMatchAssignment.id)"
			compact
		/>

		<!-- ==================== GAME MODE ==================== -->
		<div v-show="panelView === 'game'">
			<!-- Player Arena -->
			<div v-if="matchState" class="control">
				<!-- Player 1 -->
				<FeatureMatchStatePlayerControls
					class="player-one"
					:match-id="match.id"
					player-side="player1"
					:config="playerDisplayConfig('player1')"
					@view-deck-list="openDeckListModal(player1ForDeckList!)"
				/>

				<!-- Player 2 -->
				<FeatureMatchStatePlayerControls
					:match-id="match.id"
					player-side="player2"
					class="player-two"
					:config="playerDisplayConfig('player2')"
					@view-deck-list="openDeckListModal(player2ForDeckList!)"
				/>

				<div class="middle">
					<!-- Turn Tracking & Overtime -->
					<FeatureMatchStateOvertimeTurnsCounter
						v-if="matchState?.overtime"
						:overtime="matchState.overtime"
						:label="extraTurnsLabel"
						@next-turn="handleNextOvertimeTurn"
						@prev-turn="handlePrevOvertimeTurn"
					/>
					<FeatureMatchStateTurnCounter
						v-if="showTurnCounter"
						:mode="turnCounterMode"
						:label="turnCounterLabel"
						:half="turnHalf"
						:left-disabled="turnCounterMode === 'counter' && stepBackDisabled"
						@change="handleTurnChange"
						@select="handleSelectFirstPlayer"
					/>
				</div>
			</div>
		</div>

		<!-- ==================== SETUP MODE ==================== -->
		<div v-show="panelView === 'setup'" class="setup-content">
			<!-- Toolbar: Display Mode + Utility Actions -->
			<div class="setup-toolbar">
				<UFieldGroup>
					<UButton
						label="Score"
						icon="i-lucide-trophy"
						:color="formData.playerDisplayMode === 'score' ? 'primary' : 'neutral'"
						:variant="formData.playerDisplayMode === 'score' ? 'subtle' : 'outline'"
						@click="() => { formData.playerDisplayMode = 'score' }"
					/>
					<UButton
						label="Position"
						icon="i-lucide-hash"
						:color="formData.playerDisplayMode === 'position' ? 'primary' : 'neutral'"
						:variant="formData.playerDisplayMode === 'position' ? 'subtle' : 'outline'"
						@click="() => { formData.playerDisplayMode = 'position' }"
					/>
				</UFieldGroup>

				<div class="setup-toolbar-actions">
					<UButton
						label="Swap Players"
						icon="i-lucide-arrow-left-right"
						color="neutral"
						variant="soft"
						@click="swapPlayers"
					/>
					<UButton
						label="Clear Match"
						icon="i-lucide-eraser"
						color="neutral"
						variant="soft"
						@click="clearMatch"
					/>
					<template v-if="hasMeleeMatches">
						<USeparator orientation="vertical" class="h-4!" />
						<UButton
							label="Populate from Melee"
							icon="i-lucide-download"
							color="neutral"
							variant="outline"
							@click="() => { meleeModalOpen = true }"
						/>
					</template>
				</div>
			</div>

			<!-- Match Metadata -->
			<div class="match-metadata-grid">
				<UFormField label="Round" name="roundName">
					<UInput
						v-model="roundNameInput"
						:placeholder="roundPlaceholder"
						class="w-full"
					/>
				</UFormField>
				<UFormField label="Format" name="formatName">
					<UInput
						v-model="formatNameInput"
						placeholder="Format"
						class="w-full"
					/>
				</UFormField>
			</div>

			<!-- Player Forms -->
			<div class="player-forms player-forms--horizontal">
				<div class="player-form-column">
					<h3 class="player-form-heading text-sm font-medium text-muted">
						{{ isVerticalArena ? 'Top' : 'Left' }}
					</h3>
					<FeatureMatchSetupPlayerForm
						v-model="player1Data"
						:display-mode="matchDisplayMode"
						:game="game"
						:pronouns-enabled="pronounsEnabled"
						:standings-enabled="standingsEnabled"
						:lgs-enabled="lgsEnabled"
						:players="playerStore.players"
						:player-id="formData.player1Id"
						:form-id="player1FormId"
						@update:player-id="formData.player1Id = $event"
						@submit="save"
					/>
				</div>
				<USeparator orientation="vertical" />
				<div class="player-form-column">
					<h3 class="player-form-heading text-sm font-medium text-muted">
						{{ isVerticalArena ? 'Bottom' : 'Right' }}
					</h3>
					<FeatureMatchSetupPlayerForm
						v-model="player2Data"
						:display-mode="matchDisplayMode"
						:game="game"
						:pronouns-enabled="pronounsEnabled"
						:standings-enabled="standingsEnabled"
						:lgs-enabled="lgsEnabled"
						:players="playerStore.players"
						:player-id="formData.player2Id"
						:form-id="player2FormId"
						@update:player-id="formData.player2Id = $event"
						@submit="save"
					/>
				</div>
			</div>
		</div>

		<!-- ==================== FOOTER ==================== -->
		<template #footer>
			<!-- Setup mode: Save/Reset + Reorder -->
			<div v-if="panelView === 'setup'" class="flex justify-between items-center gap-4">
				<UButton
					label="Reset"
					color="error"
					variant="ghost"
					:disabled="!isDirty"
					@click="reset"
				/>
				<UFieldGroup>
					<UButton
						icon="i-lucide-chevron-up"
						color="neutral"
						variant="subtle"
						:disabled="isFirst"
						aria-label="Move match up"
						@click="() => { void featureMatchStore.reorderFeatureMatch(match.id, 'up') }"
					/>
					<UButton
						icon="i-lucide-chevron-down"
						color="neutral"
						variant="subtle"
						:disabled="isLast"
						aria-label="Move match down"
						@click="() => { void featureMatchStore.reorderFeatureMatch(match.id, 'down') }"
					/>
				</UFieldGroup>
				<UButton
					label="Save"
					type="button"
					color="primary"
					variant="outline"
					:disabled="!isDirty"
					:loading="saving"
					@click="save"
				/>
				<button
					type="submit"
					:form="player1FormId"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
					:disabled="!isDirty || saving"
				>
					Save Player 1
				</button>
				<button
					type="submit"
					:form="player2FormId"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
					:disabled="!isDirty || saving"
				>
					Save Player 2
				</button>
			</div>

			<!-- Game mode: Match actions -->
			<div v-else-if="matchState" class="match-actions">
				<UButton
					label="Tokens"
					icon="i-lucide-images"
					color="neutral"
					variant="ghost"
					:disabled="!hasAnyDeckList"
					@click="() => { tokensModalOpen = true }"
				/>
				<UDropdownMenu
					v-if="matchActionItems.length > 0"
					:items="matchActionItems"
					:content="{ align: 'end' }"
				>
					<UButton
						label="Actions"
						icon="i-lucide-repeat-2"
						color="neutral"
						variant="ghost"
					/>
				</UDropdownMenu>
				<UDropdownMenu
					:items="resetActionItems"
					:content="{ align: 'end' }"
				>
					<UButton
						label="Reset"
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="ghost"
						trailing-icon="i-lucide-chevron-down"
					/>
				</UDropdownMenu>
			</div>
		</template>
	</UCard>

	<!-- Melee Populate Modal -->
	<FeatureMatchPanelMeleeModal
		v-model:open="meleeModalOpen"
		@populate="populateFromMelee"
	/>
	<FeatureMatchTokensModal
		v-model:open="tokensModalOpen"
		:match-title="matchTitle"
		:player-one="player1ForDeckList"
		:player-two="player2ForDeckList"
	/>

	<FeatureMatchStateEditStateModal
		v-if="matchState"
		v-model:open="editStateOpen"
		:state="matchState"
		:player1-name="player1Data.name"
		:player2-name="player2Data.name"
		:show-turn-number="turnTrackingEnabled || activePlayerTrackingEnabled"
		:show-player-tracking="activePlayerTrackingEnabled"
		:show-cards-kept="mulliganTrackingEnabled"
		:saving="editStateSaving"
		@save="handleEditStateSave"
	/>
</template>

<style scoped>
.control {
	display: grid;
	grid-template-columns: 2fr max-content max-content 2fr;
	grid-template-rows: repeat(4, auto) 1fr;

	.player-one {
		grid-row: 1 / -1;
		grid-column: 1 / span 2;
	}

	.middle {
		grid-row: 1 / -1;
		grid-column: 2 / span 2;
		display: flex;
		flex-direction: column;
		justify-content: space-around;

		> div {
			z-index: 1;
			background: var(--ui-bg-elevated);
			border-radius: 0.5rem;
		}
	}

	.player-two {
		grid-row: 1 / -1;
		grid-column: 3 / span 2;
	}
}

/* ── Setup Mode ── */
.setup-content {
	padding: 1rem 1.25rem;
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
}

.setup-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.setup-toolbar-actions {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.match-metadata-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem;
}

@media (max-width: 639px) {
	.match-metadata-grid {
		grid-template-columns: 1fr;
	}
}

/* ── Player Forms ── */
.player-forms {
	display: flex;
	gap: 1.5rem;
}

.player-forms--horizontal {
	flex-direction: column;
}

@media (min-width: 640px) {
	.player-forms--horizontal {
		flex-direction: row;
	}
}

.player-form-column {
	flex: 1;
	min-width: 0;
}

.player-form-heading {
	margin-bottom: 0.75rem;
}

/* ── Footer ── */
.match-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.5rem;
}
</style>
