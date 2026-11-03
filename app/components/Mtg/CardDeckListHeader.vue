<script setup lang="ts">
import type { FeatureMatchMenuItem } from '~/composables/featureMatch/useFeatureMatchMenuItems';
import type { FeatureMatchAssignment, Match } from '~/types';
import type { CardDeckListSource } from '~/types/card/page';

const props = defineProps<{
	roundOptions?: Array<{ label: string; value: number }>;
	matchOptions?: FeatureMatchMenuItem[];
	selectedMatch?: Match | null;
	selectedAssignment?: FeatureMatchAssignment | null;
	saveAssignmentNote?: (note: string) => Promise<unknown>;
	assignmentNoteRemoteChanged?: boolean;
}>();

const deckListSource = defineModel<CardDeckListSource | null>('deckListSource');
const deckListRoundId = defineModel<number | undefined>('deckListRoundId');

const cardStore = useCardStore();
const featureMatchOptions = useFeatureMatchMenuItems();
const matchOptions = computed(() => props.matchOptions ?? featureMatchOptions.value);
/** The picker lists a Round's Matches when given them, and the Feature Match Slots otherwise. */
const pickerKind = computed<CardDeckListSource['kind']>(() => props.matchOptions
	? 'match'
	: 'slot');
const pickedId = computed<number | undefined>({
	get: () => deckListSource.value?.kind === pickerKind.value
		? deckListSource.value.id
		: undefined,
	set: (id) => {
		deckListSource.value = id
			? { kind: pickerKind.value, id }
			: null;
	},
});

function loadSelectedMatchup(selectedMatch: Match) {
	return cardStore.loadMatchupDeckLists(
		selectedMatch.player1Data?.name,
		selectedMatch.player2Data?.name,
		selectedMatch.player1Id,
		selectedMatch.player2Id,
		selectedMatch.player1Data?.deckId,
		selectedMatch.player2Data?.deckId,
	);
}

/** Load the decks the selection names: a Feature Match Slot's, or a Round's Match's once it has loaded. */
async function loadSource(source: CardDeckListSource | null | undefined, selectedMatch: Match | null | undefined) {
	if (!source) {
		cardStore.clearMatchDeckLists();
		return;
	}

	if (source.kind === 'slot') {
		await cardStore.loadMatchDeckLists(source.id);
		return;
	}

	if (selectedMatch)
		await loadSelectedMatchup(selectedMatch);
}

// A selection restored before mount, as by a linked reload, has no decks loaded yet.
if (deckListSource.value && !cardStore.deckListHasData)
	void loadSource(deckListSource.value, props.selectedMatch);

watch([
	deckListSource,
	() => props.selectedMatch,
], ([source, selectedMatch]) => loadSource(source, selectedMatch));
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
				v-model="pickedId"
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
