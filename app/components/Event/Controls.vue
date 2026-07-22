<script setup lang="ts">
const eventStore = useEventStore();
const { runRequest } = useRequestFeedback();

const event = computed(() => eventStore.event);

const holdingTextInitialData = computed(() => {
	if (!event.value)
		return null;

	return {
		holdingText: event.value.holdingText ?? '',
	};
});

const commentatorInitialData = computed(() => {
	if (!event.value)
		return null;

	const talentMap = new Map(event.value.talents.map(t => [t.id, t.name]));

	return {
		commentator1Name: event.value.commentator1TalentId
			? talentMap.get(event.value.commentator1TalentId)
			: undefined,
		commentator2Name: event.value.commentator2TalentId
			? talentMap.get(event.value.commentator2TalentId)
			: undefined,
	};
});

const { formData: holdingTextFormData, isDirty: isHoldingTextDirty, reset: resetHoldingText, getChanges: getHoldingTextChanges } = useForm({
	initialData: holdingTextInitialData,
});

const { formData: commentatorFormData, isDirty: isCommentatorsDirty, reset: resetCommentators, getChanges: getCommentatorChanges } = useForm({
	initialData: commentatorInitialData,
});

const holdingTextSaving = ref(false);
const commentatorsSaving = ref(false);

useRegisterDirtyState(computed(() => isHoldingTextDirty.value || isCommentatorsDirty.value));

const talentNames = computed(() => {
	return (event.value?.talents || [])
		.map(t => t.name)
		.sort((a, b) => a.localeCompare(b));
});

const commentator1Options = computed(() => {
	const exclude = commentatorFormData.value.commentator2Name?.toLowerCase();
	return exclude ? talentNames.value.filter(n => n.toLowerCase() !== exclude) : talentNames.value;
});

const commentator2Options = computed(() => {
	const exclude = commentatorFormData.value.commentator1Name?.toLowerCase();
	return exclude ? talentNames.value.filter(n => n.toLowerCase() !== exclude) : talentNames.value;
});

async function handleCreateCommentator(name: string, commentatorNumber: 1 | 2) {
	const trimmedName = name?.trim();
	if (!trimmedName || !event.value)
		return;
	await runRequest(
		() => eventStore.addTalent({ name: trimmedName }),
		{
			success: false,
			error: { title: 'Error', description: 'Failed to create commentator', color: 'error' },
			onSuccess: () => {
				commentatorFormData.value[`commentator${commentatorNumber}Name`] = trimmedName;
			},
			onFailure: ({ error }) => {
				console.error('Failed to create talent:', error);
			},
		},
	);
}

async function saveHoldingTextSettings() {
	if (!event.value)
		return;

	const changes = getHoldingTextChanges();
	const updates = 'holdingText' in changes
		? { holdingText: changes.holdingText?.trim() || null }
		: {};

	await runRequest(
		() => eventStore.updateEvent(updates),
		{
			loadingRef: holdingTextSaving,
			success: { title: 'Saved', description: 'Holding text updated', color: 'success' },
			error: { title: 'Error', description: 'Failed to save holding text', color: 'error' },
			onFailure: ({ error }) => {
				console.error(error);
			},
		},
	);
}

async function saveCommentatorSettings() {
	if (!event.value)
		return;
	const changes = getCommentatorChanges();
	const talentNameToId = new Map(event.value.talents.map(t => [t.name, t.id]));
	const updates: Record<string, number | null> = {};

	if ('commentator1Name' in changes) {
		updates.commentator1TalentId = changes.commentator1Name ? talentNameToId.get(changes.commentator1Name) ?? null : null;
	}

	if ('commentator2Name' in changes) {
		updates.commentator2TalentId = changes.commentator2Name ? talentNameToId.get(changes.commentator2Name) ?? null : null;
	}

	await runRequest(
		() => eventStore.updateEvent(updates),
		{
			loadingRef: commentatorsSaving,
			success: { title: 'Saved', description: 'Commentators updated', color: 'success' },
			error: { title: 'Error', description: 'Failed to save commentators', color: 'error' },
			onFailure: ({ error }) => {
				console.error(error);
			},
		},
	);
}

function swapCommentators() {
	const temp = commentatorFormData.value.commentator1Name;
	commentatorFormData.value.commentator1Name = commentatorFormData.value.commentator2Name;
	commentatorFormData.value.commentator2Name = temp;
}
</script>

<template>
	<div v-if="holdingTextFormData && commentatorFormData" class="flex flex-col gap-6">
		<UForm :state="holdingTextFormData" @submit="saveHoldingTextSettings">
			<UCard variant="subtle" title="Holding Text">
				<UFormField name="holdingText" label="Message">
					<UTextarea
						v-model="holdingTextFormData.holdingText"
						class="w-full"
						autoresize
						:rows="4"
						placeholder="Coverage resumes shortly."
					/>
				</UFormField>

				<template #footer>
					<EventConfigFormFooter :is-dirty="isHoldingTextDirty" :loading="holdingTextSaving" @reset="resetHoldingText" />
				</template>
			</UCard>
		</UForm>

		<UForm :state="commentatorFormData" @submit="saveCommentatorSettings">
			<UCard variant="subtle" title="Commentators">
				<div class="flex gap-4 items-end max-md:flex-col max-md:items-stretch">
					<UFormField name="commentator1Name" label="Commentator 1" class="w-full">
						<USelectMenu
							v-model="commentatorFormData.commentator1Name"
							:items="commentator1Options"
							:clearable="true"
							searchable
							create-item
							class="w-full"
							@create="(name) => handleCreateCommentator(name, 1)"
						/>
					</UFormField>
					<UButton
						type="button"
						variant="link"
						color="neutral"
						icon="i-lucide-arrow-right-left"
						class="h-10 max-md:self-center"
						aria-label="Swap commentators"
						@click="swapCommentators"
					/>
					<UFormField name="commentator2Name" label="Commentator 2" class="w-full">
						<USelectMenu
							v-model="commentatorFormData.commentator2Name"
							class="w-full"
							:items="commentator2Options"
							:clearable="true"
							searchable
							create-item
							@create="(name) => handleCreateCommentator(name, 2)"
						/>
					</UFormField>
				</div>
				<template #footer>
					<EventConfigFormFooter :is-dirty="isCommentatorsDirty" :loading="commentatorsSaving" @reset="resetCommentators" />
				</template>
			</UCard>
		</UForm>
	</div>
</template>
