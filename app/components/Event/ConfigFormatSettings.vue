<script setup lang="ts">
import type { Event, UpdateEventInput } from '~/types';
import { fromFeatureMatchDefaults, toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { getPointsSystemLabel } from '~~/shared/utils/highlander';

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

const emit = defineEmits<{
	submit: [data: UpdateEventInput];
}>();

const errors = ref<Record<string, string>>({});

const initialData = computed(() => {
	const defaults = toFeatureMatchDefaults(props.event);
	return {
		bestOf: defaults.bestOf,
		startingLife: defaults.startingLife,
		clockType: defaults.clockType,
		clockDuration: defaults.clockDuration,
		countUpAfterCountdown: defaults.countUpAfterCountdown,
		extraTurnsEnabled: defaults.extraTurnsEnabled,
		extraTurns: defaults.extraTurns,
		pointsSystem: props.event.pointsSystem,
	};
});

const { formData, isDirty, reset } = useForm({
	initialData,
	clearOnReset: errors,
});

useRegisterDirtyState(isDirty);

const clockTypeOptions = [
	{ label: 'Countdown', value: 'countdown' },
	{ label: 'Count Up', value: 'countup' },
];

const bestOfOptions = [
	{ label: 'Best of 1', value: 1 },
	{ label: 'Best of 3', value: 3 },
	{ label: 'Best of 5', value: 5 },
];

const pointsSystemOptions = [
	{ label: 'Disabled', value: null },
	{ label: getPointsSystemLabel('7ph'), value: '7ph' },
];

const showPointsSystemNotice = computed(() =>
	props.event.game === 'mtg'
	&& props.event.pointsSystem === '7ph'
	&& !props.event.lastDecklistsSyncedAt,
);

function validate(): boolean {
	errors.value = {};
	if (formData.value.startingLife !== undefined && formData.value.startingLife < 0) {
		errors.value.startingLife = 'Starting life must be 0 or greater';
	}
	if (formData.value.clockDuration !== undefined && formData.value.clockDuration < 0) {
		errors.value.clockDuration = 'Duration must be 0 or greater';
	}
	if (formData.value.extraTurnsEnabled && formData.value.extraTurns !== undefined && formData.value.extraTurns < 1) {
		errors.value.extraTurns = 'Must have at least 1 extra turn';
	}
	return Object.keys(errors.value).length === 0;
}

function submit() {
	if (validate()) {
		emit('submit', {
			...fromFeatureMatchDefaults(formData.value),
			pointsSystem: formData.value.pointsSystem,
		} as UpdateEventInput);
	}
}
</script>

<template>
	<UForm :state="formData" @submit="submit">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					v-if="event.game === 'mtg'"
					name="pointsSystem"
					label="Points System"
					description="Apply a global points system to MTG decklists for this event."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.pointsSystem" class="w-64" :items="pointsSystemOptions" />
				</UFormField>

				<div v-if="showPointsSystemNotice" class="flex flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-4">
					<p class="text-sm text-muted">
						Refresh decklists to populate 7 Point Highlander data.
					</p>
					<UButton
						:to="`/event/${event.id}/sync`"
						color="primary"
						variant="outline"
						class="self-start"
					>
						Open Sync
					</UButton>
				</div>

				<UFormField
					name="bestOf"
					label="Best Of"
					description="Number of games per match. New matches will use this default."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model.number="formData.bestOf" class="w-64" :items="bestOfOptions" />
				</UFormField>

				<UFormField
					name="startingLife"
					label="Starting Life"
					description="Default starting life total for new matches."
					class="flex max-sm:flex-col justify-between items-start gap-4"
					:error="errors.startingLife"
				>
					<UInputNumber
						v-model="formData.startingLife"
						:min="0"
						class="w-64"
					/>
				</UFormField>

				<UFormField
					name="clockType"
					label="Clock Type"
					description="Whether the match clock counts down or up."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.clockType" class="w-64" :items="clockTypeOptions" />
				</UFormField>

				<UFormField
					name="clockDuration"
					label="Clock Duration (minutes)"
					description="Default duration for countdown timer in minutes. Common values: 45, 50."
					class="flex max-sm:flex-col justify-between items-start gap-4"
					:error="errors.clockDuration"
				>
					<UInputNumber
						v-model="formData.clockDuration"
						:min="0"
						class="w-64"
					/>
				</UFormField>

				<UFormField
					name="countUpAfterCountdown"
					label="Count Up After Countdown"
					description="When the countdown expires, continue counting up to show overtime elapsed."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.countUpAfterCountdown" />
				</UFormField>

				<USeparator />

				<UFormField
					name="extraTurnsEnabled"
					label="Extra Turns"
					description="Enable extra turns tracking when the clock expires."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.extraTurnsEnabled" />
				</UFormField>

				<UFormField
					v-if="formData.extraTurnsEnabled"
					name="extraTurns"
					label="Number of Extra Turns"
					description="How many extra turns are allowed after the clock expires."
					class="flex max-sm:flex-col justify-between items-start gap-4"
					:error="errors.extraTurns"
				>
					<UInputNumber
						v-model="formData.extraTurns"
						:min="1"
						class="w-64"
					/>
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
