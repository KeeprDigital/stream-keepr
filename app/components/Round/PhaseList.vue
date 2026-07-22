<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Phase, Round } from '~/types';

const props = defineProps<{
	phases: Phase[];
	rounds: Round[];
	loading: boolean;
	isMeleeEvent: boolean;
	eventId: number;
}>();

const emit = defineEmits<{
	editPhase: [phase: Phase];
	deletePhase: [phase: Phase];
	addRound: [phase: Phase];
	syncMatches: [round: Round];
	enableManualOverride: [round: Round];
	editRound: [round: Round];
	deleteRound: [round: Round];
}>();

const roundsByPhase = computed(() => {
	const map = new Map<number, Round[]>();
	for (const round of props.rounds) {
		if (!map.has(round.phaseId))
			map.set(round.phaseId, []);
		map.get(round.phaseId)!.push(round);
	}
	return map;
});

function getRoundsForPhase(phaseId: number): Round[] {
	return roundsByPhase.value.get(phaseId) ?? [];
}

function getPhaseSummary(phaseId: number): string {
	const count = getRoundsForPhase(phaseId).length;
	return `${count} round${count !== 1 ? 's' : ''}`;
}

function getPhaseMenuItems(phase: Phase): DropdownMenuItem[][] {
	return [[
		{ label: 'Edit Phase', icon: 'i-lucide-pencil', onSelect: () => emit('editPhase', phase) },
		{ label: 'Add Round', icon: 'i-lucide-plus', onSelect: () => emit('addRound', phase) },
	], [
		{ label: 'Delete Phase', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('deletePhase', phase) },
	]];
}
</script>

<template>
	<UILoadingSpinner v-if="loading" />
	<div v-else>
		<template v-for="(phase, phaseIdx) in phases" :key="phase.id">
			<div class="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-(--ui-bg-elevated)/50" :class="{ 'border-t border-default': phaseIdx > 0 }">
				<div class="flex items-center gap-2">
					<span class="text-xs font-semibold uppercase tracking-wide text-muted">{{ phase.name }}</span>
					<span class="text-xs text-muted">{{ getPhaseSummary(phase.id) }}</span>
				</div>
				<UDropdownMenu :items="getPhaseMenuItems(phase)" :content="{ align: 'end' }">
					<UButton
						icon="i-lucide-ellipsis"
						size="xs"
						variant="ghost"
						color="neutral"
					/>
				</UDropdownMenu>
			</div>

			<RoundListItem
				v-for="round in getRoundsForPhase(phase.id)"
				:key="round.id"
				:round="round"
				:is-melee-event="isMeleeEvent"
				:event-id="eventId"
				@sync-matches="emit('syncMatches', $event)"
				@enable-manual-override="emit('enableManualOverride', $event)"
				@edit-round="emit('editRound', $event)"
				@delete-round="emit('deleteRound', $event)"
			/>

			<div v-if="getRoundsForPhase(phase.id).length === 0" class="px-4 sm:px-6 py-6 text-center text-sm text-muted border-t border-default">
				No rounds yet
			</div>
		</template>
	</div>
</template>
