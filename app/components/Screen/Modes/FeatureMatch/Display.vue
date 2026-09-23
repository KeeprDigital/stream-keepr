<script setup lang="ts">
import type { PlayerDisplayConfig } from '~/types';
import { DEFAULT_FEATURE_MATCH_CONFIG } from '~~/shared/types/screenConfig';

const eventStore = useEventStore();

type FeatureMatchBooleanKey = 'showTurnControls' | 'allowLifeControls' | 'allowGameWinControls' | 'allowCounterControls';

const {
	config,
	match,
	matchState,
	loading: stateLoading,
	error: dataError,
} = useFeatureMatchModeData();

function allow(key: FeatureMatchBooleanKey): boolean {
	return config.value[key] ?? DEFAULT_FEATURE_MATCH_CONFIG[key] ?? true;
}

const showTurnControls = computed(() => allow('showTurnControls'));

const isEmpty = computed(() => !config.value.featureMatchId);
const modeError = computed(() => {
	if (stateLoading.value || !config.value.featureMatchId)
		return null;
	if (dataError.value)
		return dataError.value;
	if (!match.value || !matchState.value)
		return 'Match not found';
	return null;
});

const {
	activePlayerTrackingEnabled,
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
} = useFeatureMatchGameMode(
	() => config.value.featureMatchId ?? 0,
	matchState,
);

const {
	displayTime,
	timeColorClass,
	isExpired,
	isInOvertime,
} = useClockDisplay(() => matchState.value?.clock ?? null);

const gameLabel = computed(() => {
	if (!matchState.value || !match.value)
		return null;
	return `Game ${matchState.value.currentGame} of ${match.value.activeSession?.sourceSnapshot.bestOf ?? match.value.bestOf}`;
});

const hasOvertime = computed(() => !!matchState.value?.overtime);
const showOvertime = computed(() => hasOvertime.value && (config.value.showOvertime ?? true));

const leftSide = computed(() => config.value.leftSidePlayer ?? 'player1');
const rightSide = computed(() => leftSide.value === 'player1' ? 'player2' : 'player1');

const isVerticalArena = computed(() => eventStore.event?.featureMatchOrientation === 'vertical');
const showSeatLabels = computed(() => config.value.showSeatLabels ?? true);

function seatLabelFor(side: PlayerSide): string | undefined {
	if (!showSeatLabels.value)
		return undefined;
	if (isVerticalArena.value)
		return side === 'player1' ? 'Top' : 'Bottom';
	return side === 'player1' ? 'Left' : 'Right';
}

function playerDisplayConfig(side: PlayerSide): PlayerDisplayConfig {
	return {
		showName: config.value.showNames,
		showPronouns: config.value.showPronouns,
		showDeckName: config.value.showDeckNames,
		showCounters: config.value.showCounters,
		showRecord: config.value.showRecords,
		showMulliganInfo: config.value.showMulliganInfo ?? true,
		showLgs: config.value.showLgs ?? true,
		allowLifeControls: allow('allowLifeControls'),
		allowGameWinControls: allow('allowGameWinControls'),
		allowCounterControls: allow('allowCounterControls'),
		mulliganPhase: inMulliganPhase.value,
		startingHandSize: startingHandSize.value,
		activePlayerTrackingEnabled: activePlayerTrackingEnabled.value,
		seatLabel: seatLabelFor(side),
	};
}
</script>

<template>
	<ScreenModeBase
		:error="modeError"
		:empty="isEmpty"
	>
		<div
			v-if="match && matchState"
			class="match-layout"
			:class="{ 'match-layout--with-counters': config.showCounters }"
		>
			<header class="match-header">
				<span v-if="gameLabel" class="game-label">
					{{ gameLabel }}
				</span>
				<span v-else class="game-label" />

				<span
					v-if="config.showClock"
					class="clock"
					:class="[
						timeColorClass,
						{ 'clock--pulse': isExpired && !isInOvertime && matchState.clock.isRunning },
						{ 'clock--overtime': isInOvertime },
					]"
				>
					{{ displayTime }}
				</span>

				<div class="status">
					<span
						v-if="(config.showTableNumber ?? true) && (match.activeSession?.sourceSnapshot.tableNumber ?? match.tableNumber)"
						class="table-number"
					>
						Table {{ match.activeSession?.sourceSnapshot.tableNumber ?? match.tableNumber }}
					</span>
				</div>
			</header>

			<ScreenModesFeatureMatchPlayerSide
				class="player-left"
				:match-id="match.id"
				:player-side="leftSide"
				:config="playerDisplayConfig(leftSide)"
				side="left"
			/>

			<div
				v-if="(showTurnControls && showTurnCounter) || showOvertime"
				class="match-middle"
			>
				<FeatureMatchStateOvertimeTurnsCounter
					v-if="showOvertime && matchState?.overtime"
					:overtime="matchState.overtime"
					:label="extraTurnsLabel"
					touch
					orientation="vertical"
					@next-turn="handleNextOvertimeTurn"
					@prev-turn="handlePrevOvertimeTurn"
				/>
				<FeatureMatchStateTurnCounter
					v-if="showTurnControls && showTurnCounter"
					:mode="turnCounterMode"
					:label="turnCounterLabel"
					:half="turnHalf"
					:left-disabled="turnCounterMode === 'counter' && stepBackDisabled"
					touch
					orientation="vertical"
					@change="handleTurnChange"
					@select="handleSelectFirstPlayer"
				/>
			</div>

			<ScreenModesFeatureMatchPlayerSide
				class="player-right"
				:match-id="match.id"
				:player-side="rightSide"
				:config="playerDisplayConfig(rightSide)"
				side="right"
			/>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.match-layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(12rem, 18rem) minmax(12rem, 18rem) minmax(0, 1fr);
	grid-template-rows: min-content min-content min-content minmax(0, 1fr);
	column-gap: 1.25rem;
	row-gap: 0.5rem;
	height: 100%;
	width: 100%;
	min-height: 0;

	&.match-layout--with-counters {
		grid-template-rows: min-content min-content min-content minmax(0, 2.5fr) minmax(0, 2.4fr);
	}

	.match-header {
		grid-row: 1;
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		padding-inline: 1rem;
		border-bottom: 1px solid var(--ui-border);

		.game-label,
		.status .table-number {
			font-size: clamp(1.5rem, 2.4vw, 2rem);
			font-weight: 600;
			color: var(--ui-text-muted);
			white-space: nowrap;
		}

		.game-label {
			flex: 1;
		}

		.clock {
			font-size: clamp(4rem, 8vw, 6.5rem);
			line-height: 1;
			font-weight: 700;
			font-family:
				ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', 'Liberation Mono', Menlo, Monaco, Consolas, monospace;
			transition: color 0.3s ease;

			&.clock--pulse {
				animation: display-clock-pulse 1s ease-in-out infinite;
			}

			&.clock--overtime {
				text-shadow: 0 0 24px rgba(239, 68, 68, 0.4);
			}
		}

		.status {
			flex: 1;
			display: flex;
			justify-content: flex-end;
		}
	}

	.player-left {
		grid-row: 2 / -1;
		grid-column: 1 / span 2;
	}

	.player-right {
		grid-row: 2 / -1;
		grid-column: 3 / span 2;
	}

	.match-middle {
		grid-row: 2 / -1;
		grid-column: 2 / span 2;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		gap: 1.75rem;
		z-index: 1;
		padding: 1.5rem 0;

		> * {
			background: var(--ui-bg-elevated);
			width: min(100%, 18rem);
			padding: 0.75rem;
			border-radius: 1rem;
		}
	}
}

@keyframes display-clock-pulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.4;
	}
}
</style>
