<script setup lang="ts">
import type { PlayerDisplayConfig } from '~/types';

const props = defineProps<{
	matchId: number;
	playerSide: PlayerSide;
	config?: PlayerDisplayConfig;
}>();

const emit = defineEmits<{
	viewDeckList: [];
}>();

const featureMatchStateStore = useFeatureMatchStateStore();

const {
	player,
	playerName,
	playerPronouns,
	deckName,
	bestOf,
	seatLabel: defaultSeatLabel,
	playerLgs,
	playerRecord,
} = usePlayerFeatureMatchData(() => props.matchId, () => props.playerSide);

const playerControls = usePlayerControls(() => props.matchId, () => props.playerSide);
const { availableCounterTypes } = usePlayerDeckCounters(() => props.matchId, () => props.playerSide);

const {
	showName,
	showPronouns,
	showDeckName,
	showCounters,
	showRecord,
	showLgs,
	mulliganPhase,
	startingHandSize,
	hasDeckList,
	activePlayerTrackingEnabled,
	seatLabel,
} = usePlayerDisplayConfig(() => props.config, defaultSeatLabel);

const matchState = computed(() => featureMatchStateStore.featureMatchStates.get(props.matchId) ?? null);

const isActive = computed(() =>
	activePlayerTrackingEnabled.value && matchState.value?.activePlayer === props.playerSide,
);

const isFirstPlayer = computed(() =>
	activePlayerTrackingEnabled.value && matchState.value?.firstPlayer === props.playerSide,
);

const counterValue = computed(() => {
	if (mulliganPhase.value) {
		return player.value?.cardsKept ?? startingHandSize.value;
	}
	return player.value?.lifeTotal ?? 0;
});

const counterMin = computed(() => mulliganPhase.value ? 0 : undefined);
const counterMax = computed(() => mulliganPhase.value ? startingHandSize.value : undefined);

function handleAdjust(delta: number) {
	if (mulliganPhase.value) {
		const current = player.value?.cardsKept ?? startingHandSize.value;
		const newValue = Math.max(0, current + delta);
		void playerControls.setCardsKept(newValue);
	}
	else {
		void playerControls.adjustLife(delta);
	}
}

function handleSet(value: number) {
	if (mulliganPhase.value) {
		void playerControls.setCardsKept(Math.max(0, value));
	}
	else {
		void playerControls.setLife(value);
	}
}

const activeGradientDir = computed(() => {
	return props.playerSide === 'player1' ? 'to left' : 'to right';
});

const panelStyle = computed(() => ({
	...(isActive.value ? { '--active-dir': activeGradientDir.value } : {}),
}));
</script>

<template>
	<div
		v-if="player"
		class="player-panel"
		:class="[isActive && 'is-active']"
		:style="panelStyle"
	>
		<!-- Row 1: Player name + pronouns -->
		<div v-if="showName" class="player-info" :class="playerSide === 'player2' && 'side-right'">
			<div class="info-edge info-outside">
				<span v-if="seatLabel" class="seat-badge">{{ seatLabel }}</span>
			</div>
			<div class="info-center">
				<span class="font-semibold truncate">
					{{ playerName }}
				</span>
				<span v-if="showPronouns" class="text-sm text-muted">
					{{ playerPronouns ? `(${playerPronouns})` : '' }}
				</span>
				<slot name="name-actions" />
			</div>
			<div class="info-edge info-inside">
				<UIcon
					v-if="isFirstPlayer"
					name="i-lucide-flag"
					class="text-primary w-3.5 h-3.5 shrink-0"
					title="On the Play"
				/>
			</div>
		</div>

		<!-- Row 2: Metadata (deck, record, LGS) -->
		<div v-if="showDeckName || showRecord || showLgs" class="player-meta">
			<button
				v-if="showDeckName && deckName && hasDeckList"
				type="button"
				class="meta-deck meta-deck--link"
				title="View Deck List"
				@click="emit('viewDeckList')"
			>
				<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
				{{ deckName }}
			</button>
			<div v-else-if="showDeckName" class="meta-deck" :class="deckName ? 'text-muted' : 'text-transparent'">
				{{ deckName || '–' }}
			</div>

			<div v-if="showRecord" class="meta-record text-xs" :class="playerRecord ? 'text-muted' : 'text-transparent'">
				{{ playerRecord || '–' }}
			</div>

			<div v-if="showLgs" class="meta-lgs text-xs" :class="playerLgs ? 'text-muted' : 'text-transparent'">
				{{ playerLgs || '–' }}
			</div>
		</div>

		<!-- Row 3: Life Counter / Hand Size -->
		<div class="player-life">
			<UINumericCounter
				:value="counterValue"
				:accessible-label="`${playerName} ${mulliganPhase ? 'hand size' : 'life total'}`"
				:min="counterMin"
				:max="counterMax"
				@adjust="handleAdjust"
				@set="handleSet"
			/>
			<div v-if="mulliganPhase" class="flex items-center justify-center gap-1 text-xs text-muted mt-2">
				<UIcon name="i-lucide-hand" class="w-3.5 h-3.5" />
				<span>Hand</span>
			</div>
			<div
				v-else-if="player.cardsKept !== undefined"
				class="flex items-center justify-center gap-1 text-xs text-muted mt-2"
			>
				<UIcon name="i-lucide-hand" class="w-3.5 h-3.5" />
				<span>Kept {{ player.cardsKept }}</span>
			</div>
		</div>

		<!-- Row 6: Game Wins -->
		<div class="player-wins">
			<FeatureMatchStateGameWins
				:match-id="matchId"
				:player="playerSide"
				:player-name="playerName"
				:game-wins="player.gameWins"
				:best-of="bestOf"
			/>
		</div>

		<!-- Row 7: Counters -->
		<div v-if="showCounters" class="player-counters">
			<FeatureMatchStateCounterList
				:match-id="matchId"
				:player="playerSide"
				:counters="player.counters"
				:available-counter-types="availableCounterTypes"
			/>
		</div>
	</div>
</template>

<style scoped>
.player-panel {
	position: relative;
	display: grid;
	grid-template-rows: subgrid;
	grid-row: 1 / -1;
	justify-items: center;
	align-content: start;
	padding: 1rem;
	text-align: center;
}

/* ── Row assignments ── */
.player-info {
	grid-row: 1;
}

.player-meta {
	grid-row: 2;
	margin-top: 0.125rem;
}

.player-life {
	grid-row: 3;
	margin-top: 0.75rem;
}

.player-wins {
	grid-row: 4;
	margin-top: 1rem;
}

.player-counters {
	grid-row: 5;
	margin-top: 1rem;
}

/* ── Player info: 3-column layout ── */
.player-info {
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	align-items: center;
	width: 100%;
}

.info-center {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
}

.info-edge {
	display: flex;
	align-items: center;
}

.info-outside {
	justify-self: start;
}

.info-inside {
	justify-self: end;
}

/* Player 2 (right side): swap inside/outside */
.player-info.side-right .info-outside {
	justify-self: end;
	order: 1;
}

.player-info.side-right .info-inside {
	justify-self: start;
	order: -1;
}

.seat-badge {
	font-size: 0.75rem;
	color: var(--ui-text-muted);
	background: var(--ui-bg-elevated);
	padding: 0.125rem 0.375rem;
	border-radius: 0.5rem;
}

/* ── Metadata 2-col grid ── */
.player-meta {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 0.125rem 0.5rem;
	align-items: center;
	justify-items: center;
}

/* When only one column item exists, center it across both columns */
.meta-deck:only-child,
.meta-record:only-child {
	grid-column: 1 / -1;
}

.meta-deck {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	font-size: var(--text-sm);
	cursor: default;
}

.meta-deck--link {
	cursor: pointer;
	color: var(--ui-text-muted);
	transition: color 0.15s;

	&:hover {
		color: var(--ui-text);
	}
}

.meta-record {
	white-space: nowrap;
}

.meta-lgs {
	grid-column: 1 / -1;
}

/* ── Active player highlight ── */
.player-panel.is-active {
	background: linear-gradient(var(--active-dir, to left), var(--ui-primary-50, rgba(59, 130, 246, 0.06)), transparent);

	&::before {
		content: '';
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(var(--active-dir, to left), var(--ui-primary), transparent);
		pointer-events: none;
	}
}
</style>
