<script setup lang="ts">
import type { Seat } from '~~/shared/types/enums';
import type { PlayerDisplayConfig } from '~/types';
import { seatPlayerName } from '~~/shared/modules/feature-match-session';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { seatNumber } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * A Commander Slot's Controls (ADR-0087): its four Seats where they sit at the
 * table, clockwise from the top left, around the turn and the game's outcome.
 * Shared by the Feature Match page and the Feature Match Controls Screen Mode.
 */
const props = withDefaults(defineProps<{
	matchId: number;
	/** What each Seat shows and lets its viewer change; the game's own phase is read here. */
	config?: PlayerDisplayConfig;
	/** Scales the controls up for a touch screen. */
	touch?: boolean;
	showTurnControls?: boolean;
	showSeatLabels?: boolean;
}>(), {
	touch: false,
	showTurnControls: true,
	showSeatLabels: true,
});

const eventStore = useEventStore();
const featureMatchStateStore = useFeatureMatchStateStore();

const matchState = computed(() => featureMatchStateStore.featureMatchStates.get(props.matchId) ?? null);

const {
	needsFirstPlayerSelection,
	lifeTrackingEnabled,
	counterTrackingEnabled,
	activePlayerTrackingEnabled,
	inMulliganPhase,
	startingHandSize,
	showTurnCounter,
	turnCounterLabel,
	stepBackDisabled,
	handleTurnChange,
	handleSelectFirstPlayer,
} = useFeatureMatchGameMode(() => props.matchId, matchState);

/** Seats run clockwise: 1 and 2 on top, 4 and 3 below. */
const SEAT_TABLE_POSITION = {
	player1: 'top-left',
	player2: 'top-right',
	player3: 'bottom-right',
	player4: 'bottom-left',
} as const satisfies Record<Seat, string>;

function seatConfig(seat: Seat): PlayerDisplayConfig {
	return {
		showLife: lifeTrackingEnabled.value,
		showCounters: counterTrackingEnabled.value,
		...props.config,
		mulliganPhase: inMulliganPhase.value,
		startingHandSize: startingHandSize.value,
		activePlayerTrackingEnabled: activePlayerTrackingEnabled.value,
		seatLabel: props.showSeatLabels
			? `Seat ${seatNumber(seat)}`
			: undefined,
	};
}

const choosingFirst = computed(() => props.showTurnControls && !!needsFirstPlayerSelection.value);

// ── The outcome: a winning Seat or a draw, declared by the operator ──

const outcome = computed(() => matchState.value?.outcome ?? null);
/** Declaring the outcome is what a game win is to a Commander game, under the same permission. */
const mayDeclareOutcome = computed(() => props.config?.allowGameWinControls ?? true);

const outcomeText = computed(() => {
	const winner = outcome.value?.winner;
	if (!winner)
		return 'Draw';
	const snapshot = followedFeatureMatchSession(props.matchId, featureMatchStateStore)?.sourceSnapshot;
	return snapshot
		? `${seatPlayerName(snapshot, winner)} wins`
		: `Seat ${seatNumber(winner)} wins`;
});

function setOutcome(declared: { winner: Seat | null } | null) {
	if (eventStore.eventId)
		void featureMatchStateStore.setOutcome(eventStore.eventId, props.matchId, declared);
}
</script>

<template>
	<div
		v-if="matchState"
		class="commander-table"
		:class="{ 'is-touch': touch }"
	>
		<FeatureMatchStateCommanderSeat
			v-for="seat in SEAT_VALUES"
			:key="seat"
			:match-id="matchId"
			:seat="seat"
			:config="seatConfig(seat)"
			:choosing-first="choosingFirst"
			:complete="!!outcome || !mayDeclareOutcome"
			:winner="outcome?.winner === seat"
			:touch="touch"
			:data-table-position="SEAT_TABLE_POSITION[seat]"
			@go-first="handleSelectFirstPlayer(seat)"
			@declare-winner="setOutcome({ winner: seat })"
		/>

		<div class="table-middle">
			<span v-if="choosingFirst" class="text-sm text-muted">
				Which Seat goes first?
			</span>
			<FeatureMatchStateTurnCounter
				v-else-if="showTurnControls && showTurnCounter"
				:label="turnCounterLabel"
				:left-disabled="stepBackDisabled"
				:touch="touch"
				@change="handleTurnChange"
			/>

			<div v-if="outcome" class="outcome" data-outcome>
				<UIcon name="i-lucide-trophy" class="text-warning size-4 shrink-0" />
				<span class="font-semibold">{{ outcomeText }}</span>
				<UButton
					v-if="mayDeclareOutcome"
					label="Undo"
					color="neutral"
					variant="ghost"
					:size="touch ? 'lg' : 'xs'"
					@click="setOutcome(null)"
				/>
			</div>
			<UButton
				v-else-if="mayDeclareOutcome"
				label="Declare Draw"
				icon="i-lucide-handshake"
				color="neutral"
				variant="soft"
				:size="touch ? 'lg' : 'xs'"
				@click="setOutcome({ winner: null })"
			/>
		</div>
	</div>
</template>

<style scoped>
.commander-table {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	grid-template-areas:
		'top-left top-right'
		'middle middle'
		'bottom-left bottom-right';
	gap: 0.75rem;
	padding: 0.75rem;
}

.commander-table.is-touch {
	grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
	height: 100%;
	padding: 0;
}

.commander-table.is-touch > [data-seat] {
	overflow-y: auto;
}

.commander-table > [data-table-position='top-left'] {
	grid-area: top-left;
}

.commander-table > [data-table-position='top-right'] {
	grid-area: top-right;
}

.commander-table > [data-table-position='bottom-right'] {
	grid-area: bottom-right;
}

.commander-table > [data-table-position='bottom-left'] {
	grid-area: bottom-left;
}

.table-middle {
	grid-area: middle;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-wrap: wrap;
	gap: 0.5rem 1.5rem;
}

.outcome {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}
</style>
