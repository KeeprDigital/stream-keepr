<script setup lang="ts">
const props = defineProps<{
	archetypeName: string;
	archetypeId: number;
	currentKeyCards: string[];
}>();

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const eventStore = useEventStore();
const archetypeStore = useArchetypeStore();
const { runRequest } = useRequestFeedback();

const eventId = computed(() => eventStore.eventId);
const saving = ref(false);

// ── Tag-style key card editing ──

const keyCards = ref<string[]>([...props.currentKeyCards]);
const newCardInput = ref('');

function addCard() {
	const name = newCardInput.value.trim();
	if (!name || keyCards.value.includes(name))
		return;
	keyCards.value.push(name);
	newCardInput.value = '';
}

function removeCard(name: string) {
	keyCards.value = keyCards.value.filter(c => c !== name);
}

const hasChanges = computed(() => {
	if (keyCards.value.length !== props.currentKeyCards.length)
		return true;
	return keyCards.value.some((c, i) => c !== props.currentKeyCards[i]);
});

async function handleSave() {
	if (!eventId.value || saving.value || !hasChanges.value)
		return;

	await runRequest(
		async () => {
			await archetypeStore.setKeyCards(eventId.value!, props.archetypeId, keyCards.value);
			return true;
		},
		{
			loadingRef: saving,
			success: false,
			error: ({ message }) => ({
				title: message,
				color: 'error',
			}),
			onSuccess: () => {
				emit('close');
			},
		},
	);
}

useEnterToSubmit(() => {
	void handleSave();
}, { disabled: () => saving.value || !hasChanges.value });
</script>

<template>
	<UModal :close="{ onClick: () => emit('close') }">
		<template #title>
			Edit Key Cards
		</template>
		<template #description>
			{{ archetypeName }}
		</template>

		<template #body>
			<!-- Current key cards as removable chips -->
			<div class="flex flex-wrap gap-1.5 mb-3 min-h-[2rem]">
				<UBadge
					v-for="card in keyCards"
					:key="card"
					variant="subtle"
					color="neutral"
					size="md"
					class="gap-1"
				>
					{{ card }}
					<button
						type="button"
						class="hover:text-error transition-colors ml-0.5"
						:aria-label="`Remove ${card}`"
						@click="removeCard(card)"
					>
						<UIcon name="i-lucide-x" class="size-3" />
					</button>
				</UBadge>
				<span v-if="keyCards.length === 0" class="text-xs text-muted py-1">
					No key cards set
				</span>
			</div>

			<!-- Add new card input -->
			<div class="flex items-center gap-2">
				<UInput
					v-model="newCardInput"
					data-enter-submit-ignore
					placeholder="Add card name..."
					class="flex-1"
					@keydown.enter.prevent.stop="addCard"
				/>
				<UButton
					size="sm"
					color="neutral"
					variant="outline"
					:disabled="!newCardInput.trim()"
					@click="addCard"
				>
					Add
				</UButton>
			</div>
		</template>

		<template #footer>
			<UButton color="neutral" variant="ghost" @click="emit('close')">
				Cancel
			</UButton>
			<UButton
				color="primary"
				:disabled="!hasChanges || saving"
				:loading="saving"
				@click="handleSave"
			>
				Save
			</UButton>
		</template>
	</UModal>
</template>
