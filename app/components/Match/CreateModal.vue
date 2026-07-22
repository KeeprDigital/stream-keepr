<script setup lang="ts">
import type { Round } from '~/types';

const props = defineProps<{
	defaultRoundId?: number | null;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'created'): void;
}>();

const eventStore = useEventStore();
const matchStore = useMatchStore();
const roundStore = useRoundStore();
const playerStore = usePlayerStore();
const { runRequest } = useRequestFeedback();

const saving = ref(false);
const formId = 'create-match-form';

// Form state
const formData = ref({
	selectedRoundId: props.defaultRoundId ?? undefined as number | undefined,
	selectedPlayer1Id: undefined as number | undefined,
	selectedPlayer2Id: undefined as number | undefined,
	tableNumber: undefined as number | undefined,
});

// Round options for the round picker
const roundOptions = computed(() =>
	roundStore.rounds.map((r: Round) => ({
		label: r.name,
		value: r.id,
	})),
);

// Player options for the player picker
const playerOptions = computed(() =>
	playerStore.players.map(p => ({
		label: p.name,
		value: p.id,
	})),
);

const isValid = computed(() => formData.value.selectedRoundId !== undefined);

async function handleSubmit() {
	const eventId = eventStore.eventId;
	const selectedRoundId = formData.value.selectedRoundId;
	if (!selectedRoundId || !eventId)
		return;

	await runRequest(
		() => matchStore.createMatch(eventId, {
			roundId: selectedRoundId,
			player1Id: formData.value.selectedPlayer1Id ?? null,
			player2Id: formData.value.selectedPlayer2Id ?? null,
			tableNumber: formData.value.tableNumber ?? null,
		}),
		{
			loadingRef: saving,
			success: false,
			error: { title: 'Failed to create match', color: 'error' },
			onSuccess: () => {
				emit('created');
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
		title="Create Match"
		:close="{ onClick: handleCancel }"
		:ui="{ footer: 'justify-end' }"
		@update:open="val => !val && handleCancel()"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formData"
				class="flex flex-col gap-4"
				@submit="handleSubmit"
			>
				<UFormField label="Round" required>
					<USelectMenu
						v-model="formData.selectedRoundId"
						:items="roundOptions"
						value-key="value"
						placeholder="Select a round"
						class="w-full"
					/>
				</UFormField>

				<UFormField label="Player 1">
					<USelectMenu
						v-model="formData.selectedPlayer1Id"
						:items="playerOptions"
						value-key="value"
						placeholder="Select player (optional)"
						searchable
						class="w-full"
					/>
				</UFormField>

				<UFormField label="Player 2">
					<USelectMenu
						v-model="formData.selectedPlayer2Id"
						:items="playerOptions"
						value-key="value"
						placeholder="Select player (optional)"
						searchable
						class="w-full"
					/>
				</UFormField>

				<UFormField label="Table Number">
					<UInput
						v-model.number="formData.tableNumber"
						type="number"
						placeholder="Table number (optional)"
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
				label="Create Match"
				:loading="saving"
				:disabled="!isValid"
			/>
		</template>
	</UModal>
</template>
