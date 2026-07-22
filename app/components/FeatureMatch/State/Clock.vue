<script setup lang="ts">
import type { ClockState } from '~~/shared/types/featureMatchState';
import { formatClockTime, normalizeTimeInput, parseTimeInput } from '~~/shared/utils/clock';

const props = defineProps<{
	matchId: number;
	clock: ClockState;
}>();

const clockControls = useClockControls(() => props.matchId);
const toast = useToast();

const {
	displayTime,
	timeColorClass,
	isExpired,
	isInOvertime,
} = useClockDisplay(() => props.clock);

const customTimeInput = ref('');
const popoverOpen = ref(false);
const isTimeInputValid = computed(() => parseTimeInput(customTimeInput.value) !== null);
const formattedDefaultDuration = computed(() => {
	if (!clockControls.defaultDurationMs.value)
		return null;
	return formatClockTime(clockControls.defaultDurationMs.value);
});

const decrementOptions = CLOCK_DECREMENT_OPTIONS;
const incrementOptions = CLOCK_INCREMENT_OPTIONS;

function handleInputBlur() {
	const normalized = normalizeTimeInput(customTimeInput.value);
	if (normalized)
		customTimeInput.value = normalized;
}

function handleSetTime() {
	const targetMs = parseTimeInput(customTimeInput.value);
	if (targetMs === null) {
		toast.add({
			title: 'Invalid time format',
			description: 'Use mm:ss or h:mm:ss (e.g. 12:34, 530, or 1:02:03).',
			color: 'error',
		});
		return;
	}

	void clockControls.set(targetMs);
	customTimeInput.value = '';
	popoverOpen.value = false;
}
</script>

<template>
	<UPopover v-model:open="popoverOpen">
		<button
			type="button"
			class="px-2 py-1 rounded-lg cursor-pointer transition-shadow duration-300 hover:bg-elevated"
			:class="{ 'ring-1 ring-error': isInOvertime }"
			aria-label="Clock controls"
		>
			<span
				class="text-5xl font-mono leading-none transition-colors duration-300"
				:class="[
					timeColorClass,
					{ 'animate-pulse': isExpired && !isInOvertime && clock.isRunning },
				]"
			>
				{{ displayTime }}
			</span>
		</button>

		<template #content>
			<div class="p-4 flex flex-col gap-4 min-w-[280px]">
				<!-- Row 1: Transport -->
				<div class="flex items-center justify-center gap-3">
					<UButton
						v-if="!clock.isRunning"
						icon="i-lucide-play"
						color="primary"
						variant="subtle"
						square
						:ui="{
							leadingIcon: 'size-8',
						}"
						size="xl"
						@click="() => { void clockControls.start() }"
					/>
					<UButton
						v-else
						icon="i-lucide-pause"
						color="warning"
						variant="subtle"
						square
						:ui="{
							leadingIcon: 'size-8',
						}"
						size="xl"
						@click="() => { void clockControls.pause() }"
					/>
					<UButton
						icon="i-lucide-square"
						color="error"
						variant="subtle"
						square
						:ui="{
							leadingIcon: 'size-8',
						}"
						size="xl"
						@click="() => { void clockControls.reset() }"
					/>
					<UButton
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="subtle"
						square
						:ui="{
							leadingIcon: 'size-8',
						}"
						size="xl"
						@click="() => { void clockControls.restart() }"
					/>
				</div>

				<!-- Row 2: Adjustment buttons -->
				<div class="flex items-center justify-center gap-1">
					<!-- Decrement group -->
					<UButton
						v-for="option in decrementOptions"
						:key="option.label"
						color="error"
						variant="soft"
						@click="clockControls.adjust(option.deltaMs)"
					>
						{{ option.label }}
					</UButton>

					<span class="w-px h-5 bg-default mx-1" />

					<!-- Increment group -->
					<UButton
						v-for="option in incrementOptions"
						:key="option.label"
						color="success"
						variant="soft"
						@click="clockControls.adjust(option.deltaMs)"
					>
						{{ option.label }}
					</UButton>
				</div>

				<!-- Row 3: Custom time set -->
				<div class="flex items-center gap-2">
					<UInput
						v-model="customTimeInput"
						placeholder="mm:ss"
						class="flex-1"
						@blur="handleInputBlur"
						@keydown.enter="handleSetTime"
					/>
					<UButton
						color="primary"
						variant="soft"
						:disabled="!isTimeInputValid"
						@click="handleSetTime"
					>
						Set
					</UButton>
					<UButton
						v-if="formattedDefaultDuration"
						color="neutral"
						variant="ghost"
						@click="() => { void clockControls.resetToDefault() }"
					>
						{{ formattedDefaultDuration }}
					</UButton>
				</div>
			</div>
		</template>
	</UPopover>
</template>
