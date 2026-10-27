<script setup lang="ts">
import type { Event } from '~/types';

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

const errors = ref<Record<string, string>>({});

const initialData = computed(() => ({
	cardTimeout: props.event.cardTimeout,
}));

const { formData, isDirty, reset, save, saving } = useEventConfigForm({
	initialData,
	clearOnReset: errors,
	validate,
	toUpdate: changes => changes,
});

function validate(): boolean {
	errors.value = {};
	if (formData.value.cardTimeout !== undefined && formData.value.cardTimeout < 0) {
		errors.value.cardTimeout = 'Card timeout must be 0 or greater';
	}
	return Object.keys(errors.value).length === 0;
}
</script>

<template>
	<UForm :state="formData" @submit="save">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					name="cardTimeout"
					label="Card Timeout (seconds)"
					description="How long to show cards before auto-hiding (0 = no timeout)."
					class="flex max-sm:flex-col justify-between items-start gap-4"
					:error="errors.cardTimeout"
				>
					<UInputNumber
						v-model="formData.cardTimeout"
						:min="0"
						class="w-64"
					/>
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading || saving" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
