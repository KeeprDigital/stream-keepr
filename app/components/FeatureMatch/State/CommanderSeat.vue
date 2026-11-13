<script setup lang="ts">
import type { Seat } from '~~/shared/types/enums';
import type { CommanderNumber, CommanderSource } from '~~/shared/types/featureMatchState';
import type { PlayerDisplayConfig } from '~/types';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { commanderDamageFrom, isSeatFilled, seatCommanders, seatPlayerName } from '~~/shared/modules/feature-match-session';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { seatNumber } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * One Seat of a Commander Slot's Controls (ADR-0087): its player's life, the
 * Commander Damage taken from each opposing Commander, counters, cards kept
 * and whether the Seat is Eliminated. An empty Seat is not in the game and
 * shows only that it is empty.
 */
const props = defineProps<{
	matchId: number;
	seat: Seat;
	config?: PlayerDisplayConfig;
	/** The game waits on a Seat to go first, so each offers to. */
	choosingFirst?: boolean;
	/** No Seat offers to win the game: its outcome is declared, or this viewer may not declare one. */
	complete?: boolean;
	/** This Seat is the declared winner. */
	winner?: boolean;
	/** Scales the controls up for a touch screen. */
	touch?: boolean;
}>();

const emit = defineEmits<{
	goFirst: [];
	declareWinner: [];
}>();

const eventStore = useEventStore();
const featureMatchStateStore = useFeatureMatchStateStore();

const { player, matchState, playerName, playerPronouns, deckName, playerLgs } = usePlayerFeatureMatchData(() => props.matchId, () => props.seat);
const playerControls = usePlayerControls(() => props.matchId, () => props.seat);

const {
	showName,
	showPronouns,
	showDeckName,
	showLife,
	showCounters,
	showLgs,
	allowLifeControls,
	allowCounterControls,
	mulliganPhase,
	startingHandSize,
	activePlayerTrackingEnabled,
	seatLabel,
} = usePlayerDisplayConfig(() => props.config);

const snapshot = computed(() => followedFeatureMatchSession(props.matchId, featureMatchStateStore)?.sourceSnapshot ?? null);
const filled = computed(() => !!snapshot.value && isSeatFilled(snapshot.value, props.seat));

const isActive = computed(() => activePlayerTrackingEnabled.value && matchState.value?.activePlayer === props.seat);
const wentFirst = computed(() => activePlayerTrackingEnabled.value && matchState.value?.firstPlayer === props.seat);
const eliminated = computed(() => player.value?.eliminated ?? false);

// ── Life, or the hand kept while mulligans are taken ──

const counterValue = computed(() => mulliganPhase.value
	? player.value?.cardsKept ?? startingHandSize.value
	: player.value?.lifeTotal ?? 0);

function handleAdjust(delta: number) {
	if (mulliganPhase.value)
		void playerControls.setCardsKept(Math.max(0, counterValue.value + delta));
	else
		void playerControls.adjustLife(delta);
}

function handleSet(value: number) {
	if (mulliganPhase.value)
		void playerControls.setCardsKept(Math.max(0, value));
	else
		void playerControls.setLife(value);
}

// ── Commander Damage: a count per opposing Commander ──

interface OpposingCommander extends CommanderSource {
	name: string;
	owner: string;
	damage: number;
}

const opposingCommanders = computed<OpposingCommander[]>(() => {
	const seats = snapshot.value;
	if (!seats)
		return [];
	return SEAT_VALUES
		.filter(other => other !== props.seat)
		.flatMap(other => seatCommanders(seats, other).map((held, index) => {
			const source = { seat: other, commander: (index + 1) as CommanderNumber };
			return {
				...source,
				name: held.name,
				owner: seatPlayerName(seats, other),
				damage: commanderDamageFrom(player.value ?? undefined, source),
			};
		}));
});

function adjustCommanderDamage(dealt: OpposingCommander, delta: number) {
	if (eventStore.eventId)
		featureMatchStateStore.adjustCommanderDamage(eventStore.eventId, props.matchId, props.seat, { seat: dealt.seat, commander: dealt.commander }, delta);
}

function setEliminated(value: boolean) {
	if (eventStore.eventId)
		void featureMatchStateStore.setEliminated(eventStore.eventId, props.matchId, props.seat, value);
}

// A Commander Seat links no Player whose deck could narrow them.
const counterTypes = getCounterTypeConfigs('mtg');
</script>

<template>
	<section
		v-if="filled && player"
		class="commander-seat"
		:class="{ 'is-active': isActive, 'is-eliminated': eliminated, 'is-touch': touch }"
		:data-seat="seat"
		data-seat-empty="false"
		:data-active="String(isActive)"
		:data-eliminated="String(eliminated)"
		:data-winner="String(!!winner)"
	>
		<header class="seat-header">
			<span v-if="seatLabel" class="seat-badge">{{ seatLabel }}</span>
			<span v-if="showName" class="seat-name">{{ playerName }}</span>
			<span v-if="showPronouns && playerPronouns" class="text-sm text-muted">({{ playerPronouns }})</span>
			<UIcon
				v-if="wentFirst"
				name="i-lucide-flag"
				class="text-primary size-3.5 shrink-0"
				title="Went first"
			/>
			<UIcon
				v-if="winner"
				name="i-lucide-trophy"
				class="text-warning size-3.5 shrink-0"
				title="Winner"
			/>
		</header>

		<div v-if="(showDeckName && deckName) || (showLgs && playerLgs)" class="seat-meta text-muted">
			<span v-if="showDeckName && deckName" class="truncate">{{ deckName }}</span>
			<span v-if="showLgs && playerLgs" class="text-xs truncate">{{ playerLgs }}</span>
		</div>

		<div v-if="showLife" class="seat-life">
			<UINumericCounter
				:value="counterValue"
				:accessible-label="`${playerName} ${mulliganPhase ? 'hand size' : 'life total'}`"
				:min="mulliganPhase ? 0 : undefined"
				:max="mulliganPhase ? startingHandSize : undefined"
				:touch="touch"
				:readonly="!allowLifeControls"
				@adjust="handleAdjust"
				@set="handleSet"
			/>
			<div
				v-if="mulliganPhase || player.cardsKept !== undefined"
				class="flex items-center justify-center gap-1 text-xs text-muted mt-1"
			>
				<UIcon name="i-lucide-hand" class="size-3.5" />
				<span>{{ mulliganPhase ? 'Hand' : `Kept ${player.cardsKept}` }}</span>
			</div>
		</div>

		<ul
			v-if="showLife && opposingCommanders.length > 0"
			class="seat-damage"
			aria-label="Commander Damage"
		>
			<li
				v-for="dealt in opposingCommanders"
				:key="`${dealt.seat}:${dealt.commander}`"
				class="damage-row"
				:data-commander-damage="`${dealt.seat}:${dealt.commander}`"
			>
				<span class="damage-source">
					<span class="truncate">{{ dealt.name }}</span>
					<span class="text-xs text-muted truncate">{{ dealt.owner }}</span>
				</span>
				<UINumericCounter
					:value="dealt.damage"
					:accessible-label="`${playerName} Commander Damage from ${dealt.name}`"
					:min="0"
					compact
					:touch="touch"
					:readonly="!allowLifeControls"
					@adjust="adjustCommanderDamage(dealt, $event)"
					@set="adjustCommanderDamage(dealt, $event - dealt.damage)"
				/>
			</li>
		</ul>

		<div v-if="showCounters" class="seat-counters">
			<FeatureMatchStateCounterList
				:match-id="matchId"
				:player="seat"
				:counters="player.counters"
				:available-counter-types="counterTypes"
				:touch="touch"
				:touch-columns="2"
				:readonly="!allowCounterControls"
			/>
		</div>

		<footer class="seat-actions">
			<USwitch
				:model-value="eliminated"
				:disabled="!allowLifeControls"
				label="Eliminated"
				:size="touch ? 'lg' : 'sm'"
				@update:model-value="setEliminated"
			/>
			<UButton
				v-if="choosingFirst"
				label="Goes First"
				icon="i-lucide-flag"
				color="primary"
				variant="soft"
				:size="touch ? 'lg' : 'xs'"
				@click="emit('goFirst')"
			/>
			<UButton
				v-if="!complete"
				label="Winner"
				icon="i-lucide-trophy"
				color="neutral"
				variant="soft"
				:size="touch ? 'lg' : 'xs'"
				:aria-label="`Declare ${playerName} the winner`"
				@click="emit('declareWinner')"
			/>
		</footer>
	</section>

	<section
		v-else
		class="commander-seat is-empty"
		:data-seat="seat"
		data-seat-empty="true"
		data-active="false"
		data-eliminated="false"
	>
		<span class="seat-badge">Seat {{ seatNumber(seat) }}</span>
		<span class="text-sm text-muted">Empty</span>
	</section>
</template>

<style scoped>
.commander-seat {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.625rem;
	min-width: 0;
	padding: 0.875rem 1rem;
	border: 1px solid var(--ui-border);
	border-radius: 0.75rem;
	text-align: center;
}

.commander-seat.is-empty {
	justify-content: center;
	border-style: dashed;
	min-height: 6rem;
}

.commander-seat.is-active {
	border-color: var(--ui-primary);
	box-shadow: inset 0 0 0 1px var(--ui-primary);
}

/* Out of the game: still readable and editable, set back from the Seats playing. */
.commander-seat.is-eliminated > :not(.seat-header, .seat-actions) {
	opacity: 0.45;
}

.commander-seat.is-eliminated .seat-name {
	text-decoration: line-through;
}

.seat-header {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-wrap: wrap;
	gap: 0.5rem;
	max-width: 100%;
}

.seat-name {
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.seat-badge {
	font-size: 0.75rem;
	color: var(--ui-text-muted);
	background: var(--ui-bg-elevated);
	padding: 0.125rem 0.375rem;
	border-radius: 0.5rem;
	white-space: nowrap;
}

.seat-meta {
	display: flex;
	flex-direction: column;
	max-width: 100%;
	font-size: var(--text-sm);
}

.seat-damage {
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	width: 100%;
}

.damage-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.damage-source {
	display: flex;
	flex-direction: column;
	min-width: 0;
	text-align: left;
	font-size: var(--text-sm);
}

.seat-counters {
	max-width: 100%;
}

.seat-actions {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 0.5rem 0.75rem;
	width: 100%;
	margin-top: auto;
}

/* A touch screen gives each Seat a quarter of the window: life beside the Commander Damage, so both stay in reach. */
.commander-seat.is-touch {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	grid-template-rows: auto auto auto minmax(0, 1fr) auto;
	grid-template-areas:
		'header header'
		'meta meta'
		'life damage'
		'counters damage'
		'actions actions';
	align-items: center;
	justify-items: center;
	column-gap: 1.5rem;
}

.is-touch .seat-header {
	grid-area: header;
}

.is-touch .seat-meta {
	grid-area: meta;
}

.is-touch .seat-life {
	grid-area: life;
}

.is-touch .seat-damage {
	grid-area: damage;
	justify-self: stretch;
}

.is-touch .seat-counters {
	grid-area: counters;
	align-self: start;
}

.is-touch .seat-actions {
	grid-area: actions;
}

.is-touch .seat-name {
	font-size: 1.5rem;
}

.is-touch .damage-source {
	font-size: 1rem;
}
</style>
