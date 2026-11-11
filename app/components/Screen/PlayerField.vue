<script setup lang="ts">
import type { Player } from '~/types';
import { playerLabel, playerMatchesSearch } from '~~/shared/utils/playerName';
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Player picker of Screen settings, an Event Reference (ADR-0038): the
 * Event's Players, searched by name, Nickname or Bandai member number
 * (ADR-0074) since an Event holds hundreds. It loads the Players it lacks,
 * re-reads them on Reconnect Resync (#610), and emits the Player's id, or
 * `null` when cleared.
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	eventId: number;
	label?: string;
	description?: string;
	nullLabel?: string;
	/**
	 * The label a Player is offered under, or `null` to leave them out: a Deck
	 * Source offers only Players holding a deck, named with it. Unset, every
	 * Player is offered under their operator label (ADR-0077).
	 */
	offer?: (player: Player) => string | null;
}>(), {
	label: 'Player',
	nullLabel: 'Select a player…',
});

const emit = defineEmits<{
	'update:modelValue': [playerId: number | null];
}>();

const playerStore = usePlayerStore();

const search = ref('');
const items = computed(() => playerStore.players.flatMap((player) => {
	const label = props.offer
		? props.offer(player)
		: playerLabel(player);
	return label === null || !playerMatchesSearch(player, search.value)
		? []
		: [
				{ label, value: player.id },
			];
}));

useConsumedEventData(['players']);

onMounted(async () => {
	if (props.eventId && !playerStore.isLoaded)
		await playerStore.loadPlayersByEventId(props.eventId);
});
</script>

<template>
	<ScreenEventReferenceField
		v-model:search-term="search"
		:label="label"
		:description="description"
		:null-label="nullLabel"
		:model-value="modelValue"
		:items="items"
		searchable
		@update:model-value="emit('update:modelValue', $event)"
	/>
</template>
