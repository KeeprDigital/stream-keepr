<script setup lang="ts">
import type { FeatureMatchMenuItem } from '~/composables/featureMatch/useFeatureMatchMenuItems';
import type { FeatureMatchAssignment, Match } from '~/types';

const props = defineProps<{
	roundOptions?: Array<{ label: string; value: number }>;
	matchOptions?: FeatureMatchMenuItem[];
	selectedMatch?: Match | null;
	selectedAssignment?: FeatureMatchAssignment | null;
	saveAssignmentNote?: (note: string) => Promise<unknown>;
	assignmentNoteRemoteChanged?: boolean;
}>();

const deckListMatchId = defineModel<number | undefined>('deckListMatchId');
const deckListRoundId = defineModel<number | undefined>('deckListRoundId');

const cardStore = useCardStore();
const featureMatchOptions = useFeatureMatchMenuItems();
const matchOptions = computed(() => props.matchOptions ?? featureMatchOptions.value);

// When picker selection changes, load either a round-specific match or the live feature-match slot.
watch([deckListMatchId, () => props.selectedMatch], async ([matchId, selectedMatch]) => {
	if (!matchId) {
		cardStore.clearMatchDeckLists();
		return;
	}

	if (selectedMatch) {
		await cardStore.loadMatchupDeckLists(
			selectedMatch.player1Data?.name,
			selectedMatch.player2Data?.name,
			selectedMatch.player1Id,
			selectedMatch.player2Id,
			selectedMatch.player1Data?.deckId,
			selectedMatch.player2Data?.deckId,
		);
		return;
	}

	await cardStore.loadMatchDeckLists(matchId);
});
</script>

<template>
	<div class="space-y-3">
		<div class="flex flex-wrap items-center gap-4">
			<!-- Round Picker -->
			<USelect
				v-if="roundOptions?.length"
				v-model="deckListRoundId"
				:items="roundOptions"
				value-key="value"
				placeholder="Select round..."
				size="xl"
				class="w-full sm:w-64"
			/>

			<!-- Match Picker -->
			<USelect
				v-model="deckListMatchId"
				:items="matchOptions"
				value-key="value"
				placeholder="Select matchup..."
				size="xl"
				class="w-full sm:w-72"
				:ui="{ content: 'min-w-fit' }"
			>
				<template #item-label="{ item }">
					<div class="flex flex-col gap-0.5">
						<span class="font-medium">{{ item.label }}</span>
						<div v-if="item.player1DeckName || item.player2DeckName" class="flex items-center gap-1 text-xs text-muted">
							<template v-if="item.player1DeckName">
								<MtgManaColorDisplay v-if="item.player1Colors" :colors="item.player1Colors" size="xs" />
								<span>{{ item.player1DeckName }}</span>
							</template>
							<template v-if="item.player1DeckName && item.player2DeckName">
								<span class="text-dimmed">vs</span>
							</template>
							<template v-if="item.player2DeckName">
								<MtgManaColorDisplay v-if="item.player2Colors" :colors="item.player2Colors" size="xs" />
								<span>{{ item.player2DeckName }}</span>
							</template>
						</div>
					</div>
				</template>
			</USelect>

			<!-- Filter Input -->
			<UInput
				v-if="cardStore.deckListHasData"
				v-model="cardStore.deckListFilter"
				size="xl"
				placeholder="Filter cards..."
				icon="i-lucide-filter"
				class="min-w-48 flex-1"
			>
				<template v-if="cardStore.deckListFilter" #trailing>
					<UButton
						color="neutral"
						variant="link"
						size="sm"
						icon="i-lucide-x"
						aria-label="Clear filter"
						@click="() => { cardStore.deckListFilter = '' }"
					/>
				</template>
			</UInput>
		</div>
		<FeatureMatchNote
			v-if="selectedAssignment && saveAssignmentNote"
			:note="selectedAssignment.note ?? ''"
			:note-key="selectedAssignment.id"
			:save="saveAssignmentNote"
			:remote-changed="assignmentNoteRemoteChanged"
		/>
	</div>
</template>
