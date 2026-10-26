<script setup lang="ts">
import type { Event } from '~/types';

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

const errors = ref<Record<string, string>>({});

const initialData = computed(() => ({
	name: props.event.name,
}));

const { formData, isDirty, reset, save, saving } = useEventConfigForm({
	initialData,
	clearOnReset: errors,
	validate,
	toUpdate: changes => changes,
});

function validate(): boolean {
	errors.value = {};
	if (!formData.value.name?.trim()) {
		errors.value.name = 'Event name is required';
	}
	return Object.keys(errors.value).length === 0;
}
</script>

<template>
	<UForm :state="formData" @submit="save">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					required
					name="name"
					label="Event Name"
					description="The name of the event."
					class="flex max-sm:flex-col justify-between items-start gap-4"
					:error="errors.name"
				>
					<UInput v-model="formData.name" class="w-64" />
				</UFormField>

				<UFormField
					name="game"
					label="Game"
					description="Fixed after creation to protect existing players, decks, and match state."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UBadge
						class="w-64 justify-center capitalize"
						color="neutral"
						variant="subtle"
					>
						{{ event.game }}
					</UBadge>
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading || saving" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
