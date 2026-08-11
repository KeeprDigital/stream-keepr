<script setup lang="ts">
const eventStore = useEventStore();
const { runRequest } = useRequestFeedback();
const toast = useToast();

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
const commentatorCreating = ref(false);

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

function findTalentNamed(name: string) {
	const wanted = name.toLowerCase();
	return event.value?.talents.find(talent => talent.name.toLowerCase() === wanted) ?? null;
}

/**
 * What USelectMenu's create item means, and why it cannot be taken at face value.
 *
 * The component offers to create whatever its **own** options do not carry, and
 * re-emits `create` for every Enter while that offer is on screen. Neither fact is
 * about the event's talents, and a talent name carries no uniqueness constraint, so
 * either one alone lands a second row for one person:
 *
 * - The offer stays up for the whole round trip, because the talent that would
 *   filter it away does not exist until the request lands. A second Enter inside
 *   that window is the reported bug, and `commentatorCreating` is what closes it.
 * - This position's options exclude the other position's commentator, so typing
 *   that name here leaves nothing to match and the offer appears for a talent the
 *   event already has. `findTalentNamed` is what sees through that.
 *
 * A duplicate created either way is not recoverable from the Talents card: the save
 * there matches on names, so dropping one of two namesakes reads as no change at all
 * (`modules/event-data/talentUpdates.ts`). Refusing to make one is the half of that
 * pair that keeps the operator out of the state to begin with.
 */
async function handleCreateCommentator(name: string, commentatorNumber: 1 | 2) {
	const trimmedName = name?.trim();
	if (!trimmedName || !event.value || commentatorCreating.value)
		return;

	const existing = findTalentNamed(trimmedName);
	if (existing) {
		const otherNumber = commentatorNumber === 1 ? 2 : 1;
		const otherName = commentatorFormData.value[`commentator${otherNumber}Name`];

		if (otherName?.toLowerCase() === existing.name.toLowerCase()) {
			toast.add({
				title: 'Error',
				description: `${existing.name} is already assigned to the other commentator position`,
				color: 'error',
			});
			return;
		}

		commentatorFormData.value[`commentator${commentatorNumber}Name`] = existing.name;
		return;
	}

	await runRequest(
		() => eventStore.addTalent({ name: trimmedName }),
		{
			loadingRef: commentatorCreating,
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
