<script setup lang="ts">
import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchPlayerStatePatch, FeatureMatchStateUpdate } from '~/modules/feature-match-session/client';
import { formatClockTime, getEffectiveElapsedMs, parseTimeInput } from '~~/shared/utils/clock';

const props = defineProps<{
	open: boolean;
	state: FeatureMatchState;
	player1Name?: string | null;
	player2Name?: string | null;
	showTurnNumber: boolean;
	showPlayerTracking: boolean;
	showCardsKept: boolean;
	saving?: boolean;
}>();

const emit = defineEmits<{
	'update:open': [value: boolean];
	'save': [update: FeatureMatchStateUpdate];
}>();

const NONE = 'none';
type PlayerChoice = PlayerSide | typeof NONE;

// The snapshot the dialog opened on. Every field diffs against this on Save, so
// an untouched field claims no ownership and a running clock's drifting display
// does not read as an edit.
const snapshot = {
	life: { player1: '', player2: '' },
	cardsKept: { player1: '', player2: '' },
	turnNumber: '',
	firstPlayer: NONE as PlayerChoice,
	activePlayer: NONE as PlayerChoice,
	clockDisplayMs: 0,
	clock: '',
};

const lifeInput = reactive({ player1: '', player2: '' });
const cardsKeptInput = reactive({ player1: '', player2: '' });
const turnNumberInput = ref('');
const firstPlayerChoice = ref<PlayerChoice>(NONE);
const activePlayerChoice = ref<PlayerChoice>(NONE);
const clockInput = ref('');

function currentDisplayMs(): number {
	const elapsed = getEffectiveElapsedMs(props.state.clock, Date.now());
	return props.state.clock.type === 'countdown'
		? Math.max(0, props.state.clock.durationMs - elapsed)
		: elapsed;
}

function takeSnapshot() {
	for (const player of ['player1', 'player2'] as const) {
		snapshot.life[player] = String(props.state[player].lifeTotal);
		snapshot.cardsKept[player] = props.state[player].cardsKept != null ? String(props.state[player].cardsKept) : '';
		lifeInput[player] = snapshot.life[player];
		cardsKeptInput[player] = snapshot.cardsKept[player];
	}
	snapshot.turnNumber = String(props.state.turnNumber);
	snapshot.firstPlayer = props.state.firstPlayer ?? NONE;
	snapshot.activePlayer = props.state.activePlayer ?? NONE;
	snapshot.clockDisplayMs = currentDisplayMs();
	snapshot.clock = formatClockTime(snapshot.clockDisplayMs);
	turnNumberInput.value = snapshot.turnNumber;
	firstPlayerChoice.value = snapshot.firstPlayer;
	activePlayerChoice.value = snapshot.activePlayer;
	clockInput.value = snapshot.clock;
}

watch(() => props.open, (isOpen) => {
	if (isOpen)
		takeSnapshot();
}, { immediate: true });

function playerLabel(player: PlayerSide): string {
	const name = player === 'player1' ? props.player1Name : props.player2Name;
	return name || (player === 'player1' ? 'Player 1' : 'Player 2');
}

const playerItems = computed(() => (['player1', 'player2'] as const).map(player => ({
	label: playerLabel(player),
	value: player,
})));
// A first player can be chosen but never unset, so "Not selected" is offered
// only while it is the current truth.
const firstPlayerItems = computed(() => snapshot.firstPlayer === NONE
	? [{ label: 'Not selected', value: NONE }, ...playerItems.value]
	: playerItems.value);
const activePlayerItems = computed(() => [{ label: 'None', value: NONE }, ...playerItems.value]);

const clockParsedMs = computed(() => parseTimeInput(clockInput.value));
const clockValid = computed(() => clockInput.value.trim() === '' || clockParsedMs.value !== null);

// A touched-but-unparseable field must block Save rather than be silently
// treated as untouched — closing the dialog would discard an edit the
// operator believes they made. Empty means "leave it alone" and stays valid.
function integerFieldValid(input: string, min?: number): boolean {
	const trimmed = input.trim();
	if (trimmed === '')
		return true;
	const value = Number(trimmed);
	return Number.isInteger(value) && (min === undefined || value >= min);
}

const numbersValid = computed(() =>
	integerFieldValid(lifeInput.player1)
	&& integerFieldValid(lifeInput.player2)
	&& (!props.showCardsKept || (integerFieldValid(cardsKeptInput.player1, 0) && integerFieldValid(cardsKeptInput.player2, 0)))
	&& (!props.showTurnNumber || integerFieldValid(turnNumberInput.value, 0)),
);

const formValid = computed(() => clockValid.value && numbersValid.value);

function parsedChange(input: string, original: string, options?: { min?: number }): number | undefined {
	const trimmed = input.trim();
	if (trimmed === '' || trimmed === original)
		return undefined;
	const value = Number(trimmed);
	if (!Number.isInteger(value) || (options?.min !== undefined && value < options.min))
		return undefined;
	return value;
}

function buildUpdate(): FeatureMatchStateUpdate {
	const update: FeatureMatchStateUpdate = {};

	for (const player of ['player1', 'player2'] as const) {
		const patch: FeatureMatchPlayerStatePatch = {};
		const lifeTotal = parsedChange(lifeInput[player], snapshot.life[player]);
		if (lifeTotal !== undefined)
			patch.lifeTotal = lifeTotal;
		if (props.showCardsKept) {
			const cardsKept = parsedChange(cardsKeptInput[player], snapshot.cardsKept[player], { min: 0 });
			if (cardsKept !== undefined)
				patch.cardsKept = cardsKept;
		}
		if (Object.keys(patch).length > 0)
			update[player] = patch;
	}

	if (props.showTurnNumber) {
		const turnNumber = parsedChange(turnNumberInput.value, snapshot.turnNumber, { min: 0 });
		if (turnNumber !== undefined)
			update.turnNumber = turnNumber;
	}

	if (props.showPlayerTracking) {
		if (firstPlayerChoice.value !== snapshot.firstPlayer && firstPlayerChoice.value !== NONE)
			update.firstPlayer = firstPlayerChoice.value;
		if (activePlayerChoice.value !== snapshot.activePlayer)
			update.activePlayer = activePlayerChoice.value === NONE ? null : activePlayerChoice.value;
	}

	const clockMs = clockParsedMs.value;
	if (clockMs !== null && clockMs !== snapshot.clockDisplayMs)
		update.clock = { targetDisplayMs: clockMs };

	return update;
}

function handleSave() {
	const update = buildUpdate();
	if (Object.keys(update).length === 0) {
		emit('update:open', false);
		return;
	}
	emit('save', update);
}

function handleCancel() {
	emit('update:open', false);
}

// Unlike the sibling confirm modals, this form deliberately has no
// Enter-to-submit: Enter is how the selects commit a choice, and a stray
// Enter in a text field would save a half-finished correction.
</script>

<template>
	<UModal
		:open="open"
		title="Edit Match State"
		description="Correct the live state in one save — untouched fields are left alone."
		:ui="{ footer: 'justify-end' }"
		@update:open="emit('update:open', $event)"
	>
		<template #body>
			<div class="flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-4">
					<div v-for="player in (['player1', 'player2'] as const)" :key="player" class="flex flex-col gap-3">
						<div class="text-sm font-semibold truncate">
							{{ playerLabel(player) }}
						</div>
						<UFormField label="Life total">
							<UInput
								v-model="lifeInput[player]"
								:data-testid="`state-life-${player}`"
								type="number"
								class="w-full"
							/>
						</UFormField>
						<UFormField v-if="showCardsKept" label="Cards kept">
							<UInput
								v-model="cardsKeptInput[player]"
								:data-testid="`state-cards-${player}`"
								type="number"
								min="0"
								class="w-full"
							/>
						</UFormField>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<UFormField v-if="showTurnNumber" label="Turn number">
						<UInput
							v-model="turnNumberInput"
							data-testid="state-turn-number"
							type="number"
							min="0"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Clock">
						<UInput
							v-model="clockInput"
							data-testid="state-clock"
							placeholder="mm:ss"
							class="w-full"
						/>
					</UFormField>
				</div>

				<div v-if="showPlayerTracking" class="grid grid-cols-2 gap-4">
					<UFormField label="First player">
						<USelect
							v-model="firstPlayerChoice"
							data-testid="state-first-player"
							:items="firstPlayerItems"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Active player">
						<USelect
							v-model="activePlayerChoice"
							data-testid="state-active-player"
							:items="activePlayerItems"
							class="w-full"
						/>
					</UFormField>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton
				data-testid="state-cancel"
				label="Cancel"
				color="neutral"
				variant="ghost"
				:disabled="saving"
				@click="handleCancel"
			/>
			<UButton
				data-testid="state-save"
				label="Save"
				color="primary"
				:loading="saving"
				:disabled="!formValid || saving"
				@click="handleSave"
			/>
		</template>
	</UModal>
</template>
