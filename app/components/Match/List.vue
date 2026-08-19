<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { FeatureMatchAssignment, Match, Player } from '~/types';

const props = withDefaults(defineProps<{
	matches: Match[];
	players: Player[];
	featureMatches: Array<{ id: number; matchId: number | null }>;
	featureMatchAssignments?: FeatureMatchAssignment[];
	loading?: boolean;
	globalFilter?: string;
	resultsEditable?: boolean;
	saveAssignmentNote?: (assignmentId: number, note: string) => Promise<unknown>;
	isAssignmentRemoteChanged?: (assignmentId: number) => boolean;
}>(), {
	loading: false,
	globalFilter: '',
	resultsEditable: false,
});

const emit = defineEmits<{
	promote: [featureMatchId: number, matchId: number];
	viewDeckList: [player: Player];
	editResult: [match: Match];
}>();

const featureMatchItems = useFeatureMatchMenuItems();
let promoteResetTimer: ReturnType<typeof setTimeout> | null = null;

const filteredMatches = computed(() => {
	const query = props.globalFilter.toLowerCase().trim();
	if (!query)
		return props.matches;

	return props.matches.filter((match) => {
		const p1Name = match.player1Data?.name?.toLowerCase() ?? '';
		const p2Name = match.player2Data?.name?.toLowerCase() ?? '';
		const table = String(match.tableNumber ?? '');

		return p1Name.includes(query)
			|| p2Name.includes(query)
			|| table.includes(query);
	});
});

// ── Per-match resolved data ──

const promotingMatchId = ref<number | null>(null);

function getFeatureMatchAssignment(matchId: number): FeatureMatchAssignment | null {
	return props.featureMatchAssignments?.find(assignment => assignment.matchId === matchId) ?? null;
}

function getFeatureMatchLabel(matchId: number): string | null {
	const assignment = getFeatureMatchAssignment(matchId);
	if (assignment) {
		const assignedSlotIndex = props.featureMatches.findIndex(slot => slot.id === assignment.slotId);
		return assignedSlotIndex === -1 ? 'Featured' : `Featured ${assignedSlotIndex + 1}`;
	}

	const liveSlotIndex = props.featureMatches.findIndex(slot => slot.matchId === matchId);
	if (liveSlotIndex === -1)
		return null;
	return `Live ${liveSlotIndex + 1}`;
}

function getFeatureMatchMenuItems(matchId: number): DropdownMenuItem[][] {
	if (featureMatchItems.value.length === 0)
		return [];

	return [featureMatchItems.value.map(item => ({
		label: item.label,
		icon: 'i-lucide-tv' as const,
		player1DeckName: item.player1DeckName,
		player1Colors: item.player1Colors,
		player2DeckName: item.player2DeckName,
		player2Colors: item.player2Colors,
		onSelect: () => handlePromote(item.value, matchId),
	}))];
}

function handlePromote(featureMatchId: number, matchId: number) {
	if (promoteResetTimer)
		clearTimeout(promoteResetTimer);
	promotingMatchId.value = matchId;
	emit('promote', featureMatchId, matchId);
	// Reset after a short delay (parent handles the async action)
	promoteResetTimer = setTimeout(() => {
		if (promotingMatchId.value === matchId)
			promotingMatchId.value = null;
		promoteResetTimer = null;
	}, 2000);
}

onBeforeUnmount(() => {
	if (promoteResetTimer)
		clearTimeout(promoteResetTimer);
});
</script>

<template>
	<UILoadingSpinner v-if="loading" />
	<div v-else-if="filteredMatches.length === 0" class="px-4">
		<UIEmptyState
			variant="inline"
			icon="i-lucide-search-x"
			title="No matches found"
			description="Try a different search term."
		/>
	</div>
	<div v-else class="match-grid divide-y divide-default">
		<MatchListItem
			v-for="match in filteredMatches"
			:key="match.id"
			:match="match"
			:players="players"
			:feature-match-label="getFeatureMatchLabel(match.id)"
			:feature-match-assignment="getFeatureMatchAssignment(match.id)"
			:feature-match-menu-items="getFeatureMatchMenuItems(match.id)"
			:promoting="promotingMatchId === match.id"
			:results-editable="resultsEditable"
			:save-assignment-note="saveAssignmentNote"
			:assignment-note-remote-changed="getFeatureMatchAssignment(match.id) ? isAssignmentRemoteChanged?.(getFeatureMatchAssignment(match.id)!.id) : false"
			@promote="(fmId) => emit('promote', fmId, match.id)"
			@view-deck-list="(player) => emit('viewDeckList', player)"
			@edit-result="(selectedMatch) => emit('editResult', selectedMatch)"
		/>
	</div>
</template>

<style scoped>
.match-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 1.5rem minmax(0, 1fr);
}
</style>
