<script setup lang="ts">
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
const formState = reactive({ name, roundNumber });
const isDirty = computed(() =>
	name.value.trim() !== (round.value?.name ?? '')
	|| roundNumber.value !== (round.value?.roundNumber ?? 1),
);
const isValid = computed(() => name.value.trim().length > 0 && roundNumber.value > 0);
const saving = ref(false);
const formId = `edit-round-${props.roundId}-form`;

async function handleSave() {
	if (!eventStore.eventId || !isDirty.value || !isValid.value)
		return;

	await runRequest(
		() => roundStore.updateRound(eventStore.eventId!, props.roundId, {
			name: name.value.trim(),
			roundNumber: roundNumber.value,
		}),
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
