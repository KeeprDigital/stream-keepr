<script setup lang="ts">
const props = defineProps<{
	phaseId: number;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const eventStore = useEventStore();
const phaseStore = usePhaseStore();
const { runRequest } = useRequestFeedback();

const phase = computed(() => phaseStore.getPhaseById(props.phaseId));

const name = ref(phase.value?.name ?? '');
const formState = reactive({ name });
const isDirty = computed(() =>
	name.value.trim() !== (phase.value?.name ?? ''),
);
const isValid = computed(() => name.value.trim().length > 0);
const saving = ref(false);
const formId = `edit-phase-${props.phaseId}-form`;

async function handleSave() {
	if (!eventStore.eventId || !isDirty.value || !isValid.value)
		return;

	await runRequest(
		() => phaseStore.updatePhase(eventStore.eventId!, props.phaseId, {
			name: name.value.trim(),
		}),
		{
			loadingRef: saving,
			success: { title: 'Phase Updated', color: 'success' },
			error: { title: 'Failed to update phase', color: 'error' },
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
		title="Edit Phase"
		:close="{ onClick: handleClose }"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formState"
				@submit="handleSave"
			>
				<div class="flex flex-col gap-4">
					<UFormField label="Phase Name">
						<UInput
							v-model="name"
							placeholder="Phase name"
							autofocus
							class="w-full"
						/>
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
