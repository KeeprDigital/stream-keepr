<script setup lang="ts">
const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'created', listId: number): void;
}>();

const eventStore = useEventStore();
const playerListStore = usePlayerListStore();
const { runRequest } = useRequestFeedback();

const formData = ref({ name: '' });
const saving = ref(false);
const formId = 'create-player-list-form';

const isValid = computed(() => formData.value.name.trim().length > 0);

async function handleSubmit() {
	const trimmed = formData.value.name.trim();
	if (!trimmed || !eventStore.eventId)
		return;

	await runRequest(
		async () => {
			const created = await playerListStore.createList(eventStore.eventId!, { name: trimmed });
			if (!created)
				throw new Error('Failed to create list');
			return created;
		},
		{
			loadingRef: saving,
			success: false,
			error: { title: 'Failed to create list', color: 'error' },
			onSuccess: (created) => {
				emit('created', created.id);
				emit('close');
			},
		},
	);
}

function handleCancel() {
	emit('close');
}
</script>

<template>
	<UModal
		open
		title="Create Player List"
		:close="{ onClick: handleCancel }"
		:ui="{ footer: 'justify-end' }"
		@update:open="val => !val && handleCancel()"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formData"
				@submit="handleSubmit"
			>
				<UFormField label="List Name" required>
					<UInput
						v-model="formData.name"
						placeholder="e.g. Day 2, Top 8, Feature Match Pool"
						autofocus
						class="w-full"
					/>
				</UFormField>
			</UForm>
		</template>

		<template #footer>
			<UButton
				variant="ghost"
				color="neutral"
				label="Cancel"
				@click="handleCancel"
			/>
			<UButton
				type="submit"
				:form="formId"
				color="primary"
				label="Create List"
				:loading="saving"
				:disabled="!isValid"
			/>
		</template>
	</UModal>
</template>
