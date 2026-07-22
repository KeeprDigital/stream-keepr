<script setup lang="ts">
import type { PlayerDisplayConfig } from '~/types';

const props = defineProps<{
	matchId: number;
	playerSide: PlayerSide;
	side: 'left' | 'right';
	config?: PlayerDisplayConfig;
}>();

const {
	player,
	playerName,
	playerPronouns,
	deckName,
	bestOf,
	seatLabel: defaultSeatLabel,
	playerRecord,
	playerLgs,
} = usePlayerFeatureMatchData(() => props.matchId, () => props.playerSide);

const playerControls = usePlayerControls(() => props.matchId, () => props.playerSide);
const { availableCounterTypes } = usePlayerDeckCounters(() => props.matchId, () => props.playerSide);

const {
	showName,
	showPronouns,
	showDeckName,
	showCounters,
	showRecord,
	showMulliganInfo,
	showLgs,
	allowLifeControls,
	allowGameWinControls,
	allowCounterControls,
	mulliganPhase,
	startingHandSize,
	activePlayerTrackingEnabled,
	seatLabel,
} = usePlayerDisplayConfig(() => props.config, defaultSeatLabel);

const featureMatchStateStore = useFeatureMatchStateStore();
const matchState = computed(() => featureMatchStateStore.featureMatchStates.get(props.matchId) ?? null);

const isActive = computed(() =>
	activePlayerTrackingEnabled.value && matchState.value?.activePlayer === props.playerSide,
);

const isFirstPlayer = computed(() =>
	activePlayerTrackingEnabled.value && matchState.value?.firstPlayer === props.playerSide,
);

const showHandLine = computed(
	() => showMulliganInfo.value
		&& (mulliganPhase.value || player.value?.cardsKept !== undefined),
);

const counterValue = computed(() => {
	if (mulliganPhase.value) {
		return player.value?.cardsKept ?? startingHandSize.value;
	}
	return player.value?.lifeTotal ?? 0;
});

const counterMin = computed(() => mulliganPhase.value ? 0 : undefined);
const counterMax = computed(() => mulliganPhase.value ? startingHandSize.value : undefined);

function handleLifeAdjust(delta: number) {
	if (mulliganPhase.value) {
		const current = player.value?.cardsKept ?? startingHandSize.value;
		const newValue = Math.max(0, current + delta);
		void playerControls.setCardsKept(newValue);
	}
	else {
		void playerControls.adjustLife(delta);
	}
}

function handleLifeSet(value: number) {
	if (mulliganPhase.value) {
		void playerControls.setCardsKept(Math.max(0, value));
	}
	else {
		void playerControls.setLife(value);
	}
}
</script>

<template>
	<div
		v-if="player"
		class="player-side"
		:class="[`side-${side}`, isActive && 'is-active']"
	>
		<div
			v-if="showName"
			class="player-info"
			:class="`side-${side}`"
		>
			<div class="info-outside">
				<span v-if="seatLabel" class="seat-badge">{{ seatLabel }}</span>
			</div>
			<div class="info-center">
				<span class="player-name" :class="{ 'text-primary': isActive }">
					{{ playerName }}
				</span>
			</div>
			<div class="info-inside">
				<UIcon
					v-if="isFirstPlayer"
					name="i-lucide-flag"
					class="text-primary size-7 shrink-0"
					title="On the Play"
				/>
			</div>
		</div>

		<div v-if="showDeckName || showRecord || showLgs || (showPronouns && playerPronouns)" class="player-meta">
			<div v-if="showDeckName" class="meta-deck" :class="deckName ? 'text-muted' : 'text-transparent'">
				{{ deckName }}
			</div>
			<div v-if="showPronouns && playerPronouns" class="meta-pronouns text-muted">
				{{ playerPronouns }}
			</div>
			<div v-if="showRecord" class="meta-record" :class="playerRecord ? 'text-muted' : 'text-transparent'">
				{{ playerRecord }}
			</div>
			<div v-if="showLgs" class="meta-lgs" :class="playerLgs ? 'text-dimmed' : 'text-transparent'">
				{{ playerLgs }}
			</div>
		</div>

		<div class="player-life">
			<div class="life-main">
				<UINumericCounter
					:value="counterValue"
					:accessible-label="`${playerName} ${mulliganPhase ? 'hand size' : 'life total'}`"
					:min="counterMin"
					:max="counterMax"
					touch
					hero
					orientation="vertical"
					:readonly="!allowLifeControls"
					@adjust="handleLifeAdjust"
					@set="handleLifeSet"
				/>
				<div v-if="showHandLine" class="hand-indicator">
					<UIcon name="i-lucide-hand" class="size-6" />
					<span v-if="mulliganPhase">Hand</span>
					<span v-else>Kept {{ player.cardsKept }}</span>
				</div>
			</div>
			<div
				class="player-wins"
				:class="side === 'left' ? 'player-wins-left' : 'player-wins-right'"
			>
				<FeatureMatchStateGameWins
					:match-id="matchId"
					:player="playerSide"
					:player-name="playerName"
					:game-wins="player.gameWins"
					:best-of="bestOf"
					touch
					orientation="vertical"
					:readonly="!allowGameWinControls"
				/>
			</div>
		</div>

		<div v-if="showCounters" class="player-counters">
			<FeatureMatchStateCounterList
				:match-id="matchId"
				:player="playerSide"
				:counters="player.counters"
				:available-counter-types="availableCounterTypes"
				touch
				:touch-columns="3"
				:readonly="!allowCounterControls"
			/>
		</div>
	</div>
</template>

<style scoped>
.player-side {
	position: relative;
	display: grid;
	grid-template-rows: subgrid;
	justify-items: stretch;
	align-content: stretch;
	/* padding: 2rem 1.5rem 1.75rem; */
	text-align: center;
	overflow: hidden;
	min-height: 0;

	.player-info {
		grid-row: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		width: 100%;
		min-height: 0;

		.info-outside,
		.info-inside {
			display: flex;
			align-items: center;
		}

		.info-outside {
			justify-self: start;
		}

		.info-inside {
			justify-self: end;
		}

		&.side-right {
			.info-outside {
				justify-self: end;
				order: 1;
			}

			.info-inside {
				justify-self: start;
				order: -1;
			}
		}

		.info-center {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 0.75rem;
			min-width: 0;
		}

		.player-name {
			font-size: clamp(2rem, 3.2vw, 3.5rem);
			font-weight: 600;
		}

		.seat-badge {
			color: var(--ui-text-muted);
			padding: 0.35rem 0.75rem;
			font-weight: 600;
		}
	}

	.player-meta {
		grid-row: 2;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		justify-items: center;
		width: 100%;

		.meta-deck:only-child,
		.meta-record:only-child {
			grid-column: 1 / -1;
		}

		.meta-deck {
			font-size: clamp(1.25rem, 2vw, 1.75rem);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			max-width: min(100%, 30rem);
		}

		.meta-record {
			font-size: 1.125rem;
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}

		.meta-lgs {
			grid-column: 1 / -1;
			font-size: 1.125rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			max-width: min(100%, 30rem);
		}

		.meta-pronouns {
			grid-column: 1 / -1;
			font-size: 1.125rem;
			line-height: 1.1;
		}
	}

	.player-life {
		grid-row: 3;
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 0;
		padding: 1rem 0;
		gap: 1rem;

		.life-main {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
		}

		.life-value-readonly {
			font-size: clamp(5rem, 11vw, 8.5rem);
			line-height: 1;
			font-weight: 700;
			font-variant-numeric: tabular-nums;
			min-width: 3.5ch;
			text-align: center;
			color: var(--ui-text);
			padding: 0.5rem;
		}

		.hand-indicator {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 0.5rem;
			font-size: 1.25rem;
			color: var(--ui-text-muted);
			margin-top: 1.25rem;
		}
	}

	.player-wins {
		--life-half-width: 5.5rem;
		--life-win-gap: clamp(0.9rem, 1.8vw, 1.5rem);
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;

		&.player-wins-left {
			right: calc(50% + var(--life-half-width) + var(--life-win-gap));
		}

		&.player-wins-right {
			left: calc(50% + var(--life-half-width) + var(--life-win-gap));
		}
	}

	.player-counters {
		grid-row: 4 / span 2;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
	}

	&.is-active {
		--active-dir: to left;

		&.side-right {
			--active-dir: to right;
		}

		background: linear-gradient(var(--active-dir), var(--ui-primary-50, rgba(59, 130, 246, 0.06)), transparent);

		&::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			height: 2px;
			background: linear-gradient(var(--active-dir), var(--ui-primary), transparent);
			pointer-events: none;
		}
	}
}
</style>
