<script setup lang="ts">
import type { Match } from '~/types';

const props = defineProps<{
	open: boolean;
}>();

const emit = defineEmits<{
	'update:open': [value: boolean];
	'populate': [match: Match];
}>();

const matchStore = useMatchStore();

const selectedMatchId = ref<number | undefined>(undefined);

const matchOptions = computed(() =>
	matchStore.matches.map(m => ({
		label: `Table ${m.tableNumber ?? '?'} — ${m.player1Data?.name ?? 'TBD'} vs ${m.player2Data?.name ?? 'TBD'}`,
		value: m.id,
	})),
);

const selectedMatch = computed(() => {
	if (!selectedMatchId.value)
		return null;
	return matchStore.matches.find(m => m.id === selectedMatchId.value) ?? null;
});

function confirm() {
	if (selectedMatch.value) {
		emit('populate', selectedMatch.value);
		selectedMatchId.value = undefined;
	}
}

function close() {
	emit('update:open', false);
	selectedMatchId.value = undefined;
}

useEnterToSubmit(confirm, { disabled: () => !props.open || !selectedMatch.value });
</script>

<template>
	<UModal
		:open="open"
		title="Populate from Melee.gg"
		:close="{ onClick: close }"
		:ui="{ footer: 'justify-end' }"
		@update:open="emit('update:open', $event)"
	>
		<template #body>
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted">
					Select a match from Melee.gg to populate this match's player data.
				</p>

				<USelectMenu
					v-model="selectedMatchId"
					:items="matchOptions"
					value-key="value"
					placeholder="Select a match..."
					searchable
					aria-label="Select match"
					class="w-full"
				/>

				<div v-if="selectedMatch" class="p-3 bg-elevated rounded-lg text-sm">
					<div class="flex justify-between">
						<span class="font-medium">Table {{ selectedMatch.tableNumber }}</span>
					</div>
					<div class="mt-2 flex gap-4">
						<div>
							<span class="text-muted">Player 1:</span>
							{{ selectedMatch.player1Data?.name || 'TBD' }}
						</div>
						<div>
							<span class="text-muted">Player 2:</span>
							{{ selectedMatch.player2Data?.name || 'TBD' }}
						</div>
					</div>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton variant="ghost" color="neutral" @click="close">
				Cancel
			</UButton>
			<UButton
				color="primary"
				:disabled="!selectedMatch"
				@click="confirm"
			>
				Populate Match
			</UButton>
		</template>
	</UModal>
</template>
