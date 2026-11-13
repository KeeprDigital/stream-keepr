<script setup lang="ts">
import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchData, FeatureMatchFormData, PlayerData, PlayerDisplayConfig, UpdateFeatureMatchInput } from '~/types';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { seatNumber, SLOT_SEAT_DATA_KEY } from '~~/shared/utils/featureMatchSidePlayer';
import { playerDisplayName } from '~~/shared/utils/playerName';
import { useConsumedEventData } from '~/modules/event-data/resync';
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
const eventKind = useEventKind();
/** A Commander Event's Slot has four Seats, each typed and holding Commanders (ADR-0087). */
const isCommander = computed(() => eventKind.value === 'mtg-commander');

// Computed match state for this match
const matchState = computed(() => {
	return featureMatchStateStore.featureMatchStates.get(props.match.id) ?? null;
});
const featureMatchAssignment = computed(() => assignmentStore.assignments.find(assignment =>
	assignment.slotId === props.match.id && assignment.matchId === props.match.matchId,
) ?? null);
const assignmentNote = computed(() => featureMatchAssignment.value?.note ?? '');
const featureMatchNotesEnabled = computed(() => eventStore.event?.featureMatchNotesEnabled ?? false);
const sourceMatch = ref<import('~/types').Match | null>(null);
const sourceRound = computed(() => sourceMatch.value
	? roundStore.getRoundById(sourceMatch.value.roundId)
	: undefined);

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

// The Rounds and Players the pickers below load on demand.
useConsumedEventData(['rounds', 'players']);

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

function seatFormData(data: FeatureMatchData['player1Data'] | undefined): PlayerData {
	return data
		? toPlayerData(data)
		: { ...DEFAULT_PLAYER_DATA };
}

function normalizeMatchData({ player3Data, player4Data, ...match }: FeatureMatchData): FeatureMatchFormData {
	return {
		...match,
		player1Data: seatFormData(match.player1Data),
		player2Data: seatFormData(match.player2Data),
		// Seats 3 and 4 are in a Commander Slot's form alone: no other save names them (ADR-0087).
		...(isCommander.value
			? {
					player3Data: seatFormData(player3Data),
					player4Data: seatFormData(player4Data),
				}
			: {}),
	};
}

const { formData, isDirty, reset, getChanges, runSave } = useForm<FeatureMatchFormData>({
	initialData: computed(() => normalizeMatchData(props.match)),
});

useRegisterDirtyState(isDirty);

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

// ──────────────── Sides ────────────────

/**
 * Whether the Feature Match Session shows its players in the opposite order to
 * the Slot. The Session owns which side each player sits on and the form holds
 * the Slot's pairing order (ADR-0058), so each shown side reads and writes the
 * Slot side its player holds: an edit lands on its own player, and a swap turns
 * the columns without leaving anything to save. The flag, not the snapshot's
 * sides, says this: it is the one record of how the Session's order relates to
 * the Slot's.
 */
const sidesSwapped = computed(() =>
	withFollowedFeatureMatchSession(props.match, featureMatchStateStore).activeSession?.sourceSnapshot.playersSwapped ?? false);

function slotSideOf(shown: PlayerSide): PlayerSide {
	if (!sidesSwapped.value)
		return shown;
	return shown === 'player1'
		? 'player2'
		: 'player1';
}

function shownSideData(shown: PlayerSide) {
	return computed({
		get: () => formData.value[`${slotSideOf(shown)}Data`]!,
		set: (newValue: PlayerData) => { formData.value[`${slotSideOf(shown)}Data`] = newValue; },
	});
}

function shownSidePlayerId(shown: PlayerSide) {
	return computed({
		get: () => formData.value[`${slotSideOf(shown)}Id`],
		set: (newValue: number | null) => { formData.value[`${slotSideOf(shown)}Id`] = newValue; },
	});
}

const player1Data = shownSideData('player1');
const player2Data = shownSideData('player2');
const player1Id = shownSidePlayerId('player1');
const player2Id = shownSidePlayerId('player2');

const seatFormId = (seat: Seat) => `feature-match-${props.match.id}-player-${seatNumber(seat)}-form`;
const player1FormId = computed(() => seatFormId('player1'));
const player2FormId = computed(() => seatFormId('player2'));

// ──────────────── Commander Seats ────────────────

/**
 * Where each Seat of a Commander Slot sits at the table (ADR-0087): Seats run
 * clockwise, so 1 and 2 are on top and 4 and 3 below. The forms stay in Seat
 * order, which is the order the turn passes in.
 */
const SEAT_TABLE_POSITION = {
	player1: 'top-left',
	player2: 'top-right',
	player3: 'bottom-right',
	player4: 'bottom-left',
} as const satisfies Record<Seat, string>;
/** The Seats whose forms the panel shows. */
const shownSeats = computed<readonly Seat[]>(() => isCommander.value
	? SEAT_VALUES
	: ['player1', 'player2']);
const seatLabel = (seat: Seat) => `Seat ${seatNumber(seat)}`;

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
	lifeTrackingEnabled,
	counterTrackingEnabled,
	overtimeTrackingEnabled,
	sideboardTrackingEnabled,
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
	swapSeats,
	clearMatch,
	populateFromMelee,
} = useFeatureMatchSetupActions({
	formData,
	getDeckForCurrentPhase,
});

/** Swap Seats, offered from each Seat: every other Seat it can change places with. */
function swapSeatItems(seat: Seat) {
	return SEAT_VALUES
		.filter(other => other !== seat)
		.map(other => ({
			label: `With ${seatLabel(other)}`,
			onSelect: () => { void swapSeats(seat, other); },
		}));
}

// ──────────────── Sideboard Reveal ────────────────

// The control is match-level while the model stays per-player (#490): checked
// only when both sideboards are revealed, and a toggle writes both together.
const sideboardsRevealed = computed(() =>
	(matchState.value?.player1.sideboardRevealed ?? false)
	&& (matchState.value?.player2.sideboardRevealed ?? false));

function handleSideboardRevealChange(revealed: boolean) {
	if (!eventStore.eventId)
		return;
	void featureMatchStateStore.setSideboardRevealed(eventStore.eventId, props.match.id, revealed);
}

// ──────────────── Player Display Config ────────────────

function playerDisplayConfig(side: PlayerSide): PlayerDisplayConfig {
	return {
		showName: true,
		showDeckName: true,
		showLife: lifeTrackingEnabled.value,
		showCounters: counterTrackingEnabled.value,
		showPronouns: pronounsEnabled.value,
		showRecord: standingsEnabled.value,
		showLgs: lgsEnabled.value,
		hasDeckList: side === 'player1'
			? player1HasDeckList.value
			: player2HasDeckList.value,
		activePlayerTrackingEnabled: activePlayerTrackingEnabled.value,
		seatLabel: isVerticalArena.value
			? (side === 'player1'
					? 'Top'
					: 'Bottom')
			: (side === 'player1'
					? 'Left'
					: 'Right'),
		mulliganPhase: inMulliganPhase.value,
		startingHandSize: startingHandSize.value,
	};
}

/** What each Seat of a Commander Slot's Controls shows; its game's own phase is the table's to read. */
const commanderDisplayConfig = computed<PlayerDisplayConfig>(() => ({
	showName: true,
	showDeckName: true,
	showPronouns: pronounsEnabled.value,
	showLgs: lgsEnabled.value,
}));

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

	await runSave(() => runRequest(
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
			onFailure: ({ error }) => {
				if (error)
					console.error('Failed to save match:', error);
			},
		},
	));
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
			v-if="featureMatchAssignment && featureMatchNotesEnabled"
			class="mx-3 mt-3"
			:note="assignmentNote"
			:note-key="featureMatchAssignment.id"
			:save="saveAssignmentNote"
			:remote-changed="assignmentStore.isRemoteChanged(featureMatchAssignment.id)"
			compact
		/>

		<!-- ==================== GAME MODE ==================== -->
		<div v-show="panelView === 'game'">
			<!-- A Commander Slot's four Seats, where they sit at the table (ADR-0087) -->
			<FeatureMatchStateCommanderTable
				v-if="matchState && isCommander"
				:match-id="match.id"
				:config="commanderDisplayConfig"
			/>

			<!-- Player Arena -->
			<div v-else-if="matchState" class="control">
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
						v-if="overtimeTrackingEnabled && matchState?.overtime"
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
					<!-- Match-level sideboard reveal: one save for both players (#490) -->
					<div v-if="sideboardTrackingEnabled" class="sideboard-toggle">
						<USwitch
							:model-value="sideboardsRevealed"
							label="Show sideboards"
							size="sm"
							@update:model-value="handleSideboardRevealChange"
						/>
					</div>
				</div>
			</div>
		</div>

		<!-- ==================== SETUP MODE ==================== -->
		<div v-show="panelView === 'setup'" class="setup-content">
			<!-- Toolbar: Display Mode + Utility Actions -->
			<div class="setup-toolbar">
				<!-- A Commander Seat has no record to show as a score or a position. -->
				<UFieldGroup v-if="!isCommander">
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
						v-if="!isCommander"
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

			<!-- Commander Seats, where they sit at the table -->
			<div v-if="isCommander" class="seat-table">
				<section
					v-for="seat in SEAT_VALUES"
					:key="seat"
					class="player-form-column"
					:data-seat="seat"
					:data-table-position="SEAT_TABLE_POSITION[seat]"
				>
					<div class="seat-heading">
						<h3 class="text-sm font-medium text-muted">
							{{ seatLabel(seat) }}
						</h3>
						<UDropdownMenu :items="swapSeatItems(seat)" :content="{ align: 'end' }">
							<UButton
								label="Swap"
								icon="i-lucide-arrow-left-right"
								color="neutral"
								variant="ghost"
								size="xs"
								:disabled="isDirty"
								:title="isDirty ? 'Save or reset your changes first' : undefined"
								:aria-label="`Swap ${seatLabel(seat)} with another Seat`"
							/>
						</UDropdownMenu>
					</div>
					<FeatureMatchSetupPlayerForm
						:model-value="formData[SLOT_SEAT_DATA_KEY[seat]]!"
						:display-mode="matchDisplayMode"
						:game="game"
						commander-event
						:pronouns-enabled="pronounsEnabled"
						:lgs-enabled="lgsEnabled"
						:form-id="seatFormId(seat)"
						@update:model-value="formData[SLOT_SEAT_DATA_KEY[seat]] = $event"
						@submit="save"
					/>
				</section>
			</div>

			<!-- Player Forms -->
			<div v-else class="player-forms player-forms--horizontal">
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
						:player-id="player1Id"
						:form-id="player1FormId"
						:slot-id="match.id"
						:side="slotSideOf('player1')"
						:deck-list-locked="isDirty"
						@update:player-id="player1Id = $event"
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
						:player-id="player2Id"
						:form-id="player2FormId"
						:slot-id="match.id"
						:side="slotSideOf('player2')"
						:deck-list-locked="isDirty"
						@update:player-id="player2Id = $event"
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
					v-for="seat in shownSeats"
					:key="seat"
					type="submit"
					:form="seatFormId(seat)"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
					:disabled="!isDirty || saving"
				>
					Save Player {{ seatNumber(seat) }}
				</button>
			</div>

			<!-- Game mode: Match actions -->
			<div v-else-if="matchState" class="match-actions">
				<UButton
					v-if="!isCommander"
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
		v-if="matchState && !isCommander"
		v-model:open="editStateOpen"
		:state="matchState"
		:player1-name="playerDisplayName(player1Data)"
		:player2-name="playerDisplayName(player2Data)"
		:show-life="lifeTrackingEnabled"
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

		.sideboard-toggle {
			padding: 0.5rem 0.75rem;
			display: flex;
			justify-content: center;
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
	margin-left: auto;
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

/* ── Commander Seats: two by two, as at the table ── */
.seat-table {
	display: grid;
	grid-template-columns: 1fr;
	gap: 1.5rem;
}

@media (min-width: 640px) {
	.seat-table {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-areas:
			'top-left top-right'
			'bottom-left bottom-right';
	}

	.seat-table > [data-table-position='top-left'] {
		grid-area: top-left;
	}

	.seat-table > [data-table-position='top-right'] {
		grid-area: top-right;
	}

	.seat-table > [data-table-position='bottom-right'] {
		grid-area: bottom-right;
	}

	.seat-table > [data-table-position='bottom-left'] {
		grid-area: bottom-left;
	}
}

.seat-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
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
