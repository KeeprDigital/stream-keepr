<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Round } from '~/types';
import { isManualOverrideRound, isMeleeManagedRound } from '~~/shared/utils/roundControl';

const props = defineProps<{
	round: Round;
	isMeleeEvent: boolean;
	eventId: number;
}>();

const emit = defineEmits<{
	syncMatches: [round: Round];
	enableManualOverride: [round: Round];
	editRound: [round: Round];
	deleteRound: [round: Round];
}>();

function formatSyncTime(date: Date | string | null): string {
	if (!date)
		return '';
	const d = new Date(date);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffMin = Math.floor(diffMs / 60000);
	if (diffMin < 1)
		return 'just now';
	if (diffMin < 60)
		return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24)
		return `${diffHr}h ago`;
	return d.toLocaleDateString();
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
	const round = props.round;
	const items: DropdownMenuItem[][] = [[
		{ label: 'Review Matches', icon: 'i-lucide-swords', onSelect: () => navigateTo(`/event/${props.eventId}/matches?roundId=${round.id}`) },
		{ label: 'Edit Round', icon: 'i-lucide-pencil', onSelect: () => emit('editRound', round) },
	]];

	if (isMeleeManagedRound(round) && round.lastSyncedAt) {
		items[0]!.push({
			label: 'Re-sync Matches',
			icon: 'i-lucide-refresh-cw',
			onSelect: () => emit('syncMatches', round),
		});
	}

	if (props.isMeleeEvent && round.externalSource === 'melee' && !isManualOverrideRound(round)) {
		items.push([{
			label: 'Switch to Manual Override',
			icon: 'i-lucide-pencil-ruler',
			color: 'warning' as const,
			onSelect: () => emit('enableManualOverride', round),
		}]);
	}

	items.push([{ label: 'Delete Round', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('deleteRound', round) }]);
	return items;
});
</script>

<template>
	<div class="relative flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 border-t border-(--ui-border)/50 transition-colors">
		<div class="flex items-center gap-2.5 min-w-0">
			<UIcon name="i-lucide-circle" class="text-muted shrink-0 size-4" />
			<span class="text-sm">{{ round.name }}</span>
			<UBadge
				v-if="isManualOverrideRound(round)"
				color="warning"
				variant="subtle"
				size="xs"
			>
				Manual Override
			</UBadge>
			<UBadge
				v-if="round.lastSyncedAt"
				color="info"
				variant="subtle"
				size="xs"
			>
				Synced {{ formatSyncTime(round.lastSyncedAt) }}
			</UBadge>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			<UButton
				size="xs"
				variant="ghost"
				color="neutral"
				icon="i-lucide-swords"
				:to="`/event/${eventId}/matches?roundId=${round.id}`"
			/>
			<UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
				<UButton
					icon="i-lucide-ellipsis"
					size="xs"
					variant="ghost"
					color="neutral"
				/>
			</UDropdownMenu>
		</div>
	</div>
</template>
