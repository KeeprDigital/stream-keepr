<script setup lang="ts">
import type { UpdateRoundInput } from '~/types';
import { ROUND_DURATION_MINUTES_MAX, ROUND_DURATION_MINUTES_MIN } from '~~/shared/utils/roundClock';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '~/utils/roundTiming';

const props = defineProps<{
	roundId: number;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const eventStore = useEventStore();
const roundStore = useRoundStore();
const { runRequest } = useRequestFeedback();

const round = computed(() => roundStore.getRoundById(props.roundId));

const name = ref(round.value?.name ?? '');
const roundNumber = ref(round.value?.roundNumber ?? 1);
// The Round's timing (ADR-0066): its start as this browser's local time, and its duration.
const savedStart = toDateTimeLocalValue(round.value?.startedAt ?? null);
const savedDuration = round.value?.durationMinutes ?? null;
const startedAt = ref(savedStart);
const enteredDuration = ref<number | null>(savedDuration);
const formState = reactive({
	name,
	roundNumber,
	startedAt,
	enteredDuration,
});
/** A cleared number input may hold `undefined` or `NaN`; either is no duration. */
const duration = computed(() => Number.isFinite(enteredDuration.value)
	? enteredDuration.value
	: null);
const startChanged = computed(() => startedAt.value !== savedStart);
const durationChanged = computed(() => duration.value !== savedDuration);
const isDirty = computed(() =>
	name.value.trim() !== (round.value?.name ?? '')
	|| roundNumber.value !== (round.value?.roundNumber ?? 1)
	|| startChanged.value
	|| durationChanged.value,
);
const durationValid = computed(() => duration.value == null
	|| (Number.isInteger(duration.value)
		&& duration.value >= ROUND_DURATION_MINUTES_MIN
		&& duration.value <= ROUND_DURATION_MINUTES_MAX));
// An entered start must name an instant; only an emptied one clears it.
const startValid = computed(() => !startedAt.value || fromDateTimeLocalValue(startedAt.value) != null);
const isValid = computed(() => name.value.trim().length > 0 && roundNumber.value > 0 && durationValid.value && startValid.value);
const saving = ref(false);
const formId = `edit-round-${props.roundId}-form`;

async function handleSave() {
	if (!eventStore.eventId || !isDirty.value || !isValid.value)
		return;

	// Timing is sent only when edited, so a save never undoes a "Start now" made since this opened.
	const input: UpdateRoundInput = {
		name: name.value.trim(),
		roundNumber: roundNumber.value,
		...(startChanged.value
			? {
					startedAt: fromDateTimeLocalValue(startedAt.value),
				}
			: {}),
		...(durationChanged.value
			? { durationMinutes: duration.value }
			: {}),
	};
	await runRequest(
		() => roundStore.updateRound(eventStore.eventId!, props.roundId, input),
		{
			loadingRef: saving,
			success: { title: 'Round Updated', color: 'success' },
			error: { title: 'Failed to update round', color: 'error' },
			onSuccess: () => {
				emit('close');
			},
		},
	);
}

function handleClose() {
	emit('close');
}
</script>

<template>
	<UModal
		open
		title="Edit Round"
		:close="{ onClick: handleClose }"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formState"
				@submit="handleSave"
			>
				<div class="flex flex-col gap-4">
					<UFormField label="Round Name">
						<UInput
							v-model="name"
							placeholder="Round name"
							autofocus
							class="w-full"
						/>
					</UFormField>

					<UFormField label="Round Number">
						<UInputNumber
							v-model="roundNumber"
							:min="1"
							class="w-full"
						/>
					</UFormField>

					<UFormField
						label="Duration (minutes)"
						name="durationMinutes"
						description="How long the Round runs. A Round Clock counts it down from the start."
					>
						<UInputNumber
							v-model="enteredDuration"
							:min="ROUND_DURATION_MINUTES_MIN"
							:max="ROUND_DURATION_MINUTES_MAX"
							placeholder="Untimed"
							class="w-full"
						/>
					</UFormField>

					<UFormField
						label="Start"
						name="startedAt"
						description="Leave empty until the Round starts, or use Start now on the Event Structure page."
					>
						<div class="flex gap-2">
							<UInput
								v-model="startedAt"
								type="datetime-local"
								step="1"
								class="w-full"
							/>
							<UButton
								v-if="startedAt"
								label="Clear"
								color="neutral"
								variant="ghost"
								@click="startedAt = ''"
							/>
						</div>
					</UFormField>
				</div>
			</UForm>
		</template>

		<template #footer>
			<UButton
				label="Cancel"
				color="neutral"
				variant="ghost"
				@click="handleClose"
			/>
			<UButton
				type="submit"
				:form="formId"
				label="Save"
				color="primary"
				:loading="saving"
				:disabled="!isDirty || !isValid"
			/>
		</template>
	</UModal>
</template>
