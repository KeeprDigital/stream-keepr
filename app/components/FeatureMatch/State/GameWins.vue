<script setup lang="ts">
const props = withDefaults(defineProps<{
	matchId: number;
	player: PlayerSide;
	playerName?: string;
	gameWins: number;
	bestOf: number;
	/** Scales up dots and badge for touch-screen use */
	touch?: boolean;
	/** Layout direction for the win markers */
	orientation?: 'horizontal' | 'vertical';
	/** Keeps the win markers visible but removes interaction affordances */
	readonly?: boolean;
}>(), {
	touch: false,
	orientation: 'horizontal',
	readonly: false,
});

const playerControls = usePlayerControls(() => props.matchId, () => props.player);
const featureMatchStateStore = useFeatureMatchStateStore();
const { runRequest } = useRequestFeedback();

const isBestOfOne = computed(() => props.bestOf === 1);
const isVertical = computed(() => props.orientation === 'vertical');
const isTouchVertical = computed(() => props.touch && isVertical.value);
const winsNeeded = computed(() => Math.ceil(props.bestOf / 2));
const hasWon = computed(() => props.gameWins >= winsNeeded.value);

// Modal state
const showModal = ref(false);
const modalMode = ref<'win' | 'undo'>('win');

const currentGame = computed(() => {
	return featureMatchStateStore.featureMatchStates.get(props.matchId)?.currentGame ?? 1;
});

const isMatchCompleting = computed(() => {
	return props.gameWins + 1 >= winsNeeded.value;
});

function requestWin() {
	modalMode.value = 'win';
	showModal.value = true;
}

function requestUndo() {
	modalMode.value = 'undo';
	showModal.value = true;
}

async function handleModalConfirm(options: { resetLife: boolean; resetCounters: boolean }) {
	const name = props.playerName || 'this player';

	if (modalMode.value === 'win') {
		await runRequest(async () => {
			await playerControls.recordWin({
				resetLife: options.resetLife,
				resetCounters: options.resetCounters,
			});
			return featureMatchStateStore.featureMatchStates.get(props.matchId) ?? {
				isComplete: false,
				currentGame: 2,
			};
		}, {
			success: updatedState => ({
				title: updatedState.isComplete
					? `${name} wins the match`
					: `${name} wins Game ${(updatedState.currentGame ?? 2) - 1}`,
			}),
			error: { title: 'Failed to record game win', color: 'error' },
		});
	}
	else {
		await runRequest(async () => {
			await playerControls.undoWin({
				resetLife: options.resetLife,
				resetCounters: options.resetCounters,
			});
			return true;
		}, {
			success: { title: `Game win removed for ${name}` },
			error: { title: 'Failed to remove game win', color: 'error' },
		});
	}
}

interface WinSlot {
	position: number;
	filled: boolean;
	disabled: boolean;
}

const winSlots = computed<WinSlot[]>(() =>
	Array.from({ length: winsNeeded.value }, (_, index) => {
		const position = index + 1;
		const filled = position <= props.gameWins;
		return {
			position,
			filled,
			disabled: !filled && hasWon.value,
		};
	}),
);

const slotClasses = computed(() => ({ filled, disabled }: WinSlot) => [
	filled
		? 'bg-success border-success game-wins-slot--filled'
		: 'game-wins-slot--empty text-muted',
	!props.readonly && !disabled && filled
		? 'cursor-pointer game-wins-slot--filled-hover hover:bg-transparent hover:border-error'
		: '',
	!props.readonly && !disabled && !filled
		? 'cursor-pointer hover:border-success hover:bg-success/20'
		: '',
]);

const slotContainerClass = computed(() => {
	if (isVertical.value) {
		return props.touch ? 'flex-col items-center gap-3' : 'flex-col items-center gap-1.5';
	}

	return props.touch ? 'gap-4' : 'gap-1.5';
});

const gameWinsClass = computed(() => {
	if (!isTouchVertical.value)
		return '';

	return 'game-wins--clustered rounded-[1.75rem] px-3 py-3';
});

const slotSizeClass = computed(() => {
	if (!props.touch)
		return 'w-7 h-7 border-2';

	return isVertical.value ? 'w-14 h-14 border-[3px]' : 'w-16 h-16 border-[3px]';
});
</script>

<template>
	<div class="game-wins flex items-center justify-center" :class="gameWinsClass">
		<div v-if="!isBestOfOne" class="game-wins-slots flex" :class="slotContainerClass">
			<template v-if="readonly">
				<div
					v-for="slot in winSlots"
					:key="slot.position"
					class="inline-flex items-center justify-center rounded-full font-semibold leading-none transition-all duration-200"
					:class="[
						slotClasses(slot),
						props.touch ? 'text-sm tracking-wide' : 'text-xs tracking-tight',
						slotSizeClass,
					]"
				>
					G{{ slot.position }}
				</div>
			</template>
			<button
				v-for="slot in winSlots"
				v-else
				:key="slot.position"
				type="button"
				:disabled="slot.disabled"
				:aria-label="slot.filled ? 'Undo win' : 'Record win'"
				class="inline-flex items-center justify-center rounded-full font-semibold leading-none transition-all duration-200"
				:class="[
					slotClasses(slot),
					props.touch ? 'text-sm tracking-wide' : 'text-xs tracking-tight',
					slotSizeClass,
				]"
				@click="slot.filled ? requestUndo() : requestWin()"
			>
				G{{ slot.position }}
			</button>
		</div>

		<!-- Game Win Confirmation Modal -->
		<FeatureMatchStateGameWinModal
			v-model:open="showModal"
			:mode="modalMode"
			:player-name="playerName"
			:current-game="currentGame"
			:is-match-completing="isMatchCompleting"
			@confirm="handleModalConfirm"
		/>
	</div>
</template>

<style scoped>
.game-wins--clustered {
	background: color-mix(in srgb, var(--ui-bg-elevated) 82%, transparent);
}

.game-wins-slot--filled {
	color: var(--ui-color-neutral-950, #111111);
}

.game-wins-slot--filled-hover:hover {
	color: var(--ui-error);
}

.game-wins-slot--empty {
	background: color-mix(in srgb, var(--ui-bg-elevated) 70%, var(--ui-bg) 30%);
	border-color: color-mix(in srgb, var(--ui-border) 58%, white 42%);
}
</style>
