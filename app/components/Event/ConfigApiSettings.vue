<script setup lang="ts">
import type { Event, UpdateEventInput } from '~/types';

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

const emit = defineEmits<{
	submit: [data: UpdateEventInput];
}>();

const initialData = computed(() => ({
	displayRecordSeparator: props.event.displayRecordSeparator,
	displayHideZeroDraws: props.event.displayHideZeroDraws,
	displayPositionFormat: props.event.displayPositionFormat,
}));

const { formData, isDirty, reset } = useForm({ initialData });

useRegisterDirtyState(isDirty);

function submit() {
	emit('submit', formData.value);
}
</script>

<template>
	<UForm :state="formData" @submit="submit">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					name="displayRecordSeparator"
					label="Record Separator"
					description="Character(s) to use between wins, losses, and draws."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.displayRecordSeparator" class="w-64" :items="RECORD_SEPARATOR_SELECT_OPTIONS" />
				</UFormField>

				<UFormField
					name="displayPositionFormat"
					label="Position Format"
					description="How player positions are shown."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.displayPositionFormat" class="w-64" :items="POSITION_FORMAT_SELECT_OPTIONS" />
				</UFormField>

				<USeparator />

				<UFormField
					name="displayHideZeroDraws"
					label="Hide Zero Draws"
					description="Don't show draws in the record when the value is 0."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.displayHideZeroDraws" />
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
