<script setup lang="ts">
import type { Player } from '~/types';

// A Player's name opens their match history; a name with no Player behind it is plain text.
const props = defineProps<{
	player: Player | null | undefined;
	/** The text shown, when it is not the Player's own name (a Match's snapshot, 'TBD'). */
	name?: string;
}>();

const { openPlayerMatchHistory } = usePlayerMatchHistoryModal();

const label = computed(() => props.name ?? props.player?.name ?? '');
</script>

<template>
	<button
		v-if="player"
		type="button"
		class="text-left hover:text-primary transition-colors cursor-pointer"
		title="View Match History"
		@click="openPlayerMatchHistory(player)"
	>
		{{ label }}
	</button>
	<span v-else>{{ label }}</span>
</template>
