<script setup lang="ts">
import type { BoardSelection } from '~~/shared/types/enums';
import type { DeckModeConfig } from '~~/shared/types/screenConfig';
import { resolveDeckBoards } from '~~/shared/types/screenConfig';

/**
 * A Deck List Screen's board show toggles, one per board, writing the one
 * `board` selection (#477): both hidden cannot be written, so the last board
 * shown stays on. A shown board its Deck Source holds no cards for says so,
 * since the output renders nothing for it by design (#477, #478).
 */
const props = defineProps<{
	config: Readonly<Record<string, any>>;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [patch: { board: BoardSelection }];
}>();

const playerStore = usePlayerStore();
const broadcastDeckListStore = useBroadcastDeckListStore();
const deckCache = usePlayerDeckCache();

type BoardKey = 'mainboard' | 'sideboard';

const BOARDS: { key: BoardKey; title: string }[] = [
	{ key: 'mainboard', title: 'Mainboard' },
	{ key: 'sideboard', title: 'Sideboard' },
];

const deck = computed(() => props.config as Partial<DeckModeConfig>);
const board = computed(() => resolveDeckBoards(deck.value).board);
const shown = computed<Record<BoardKey, boolean>>(() => ({
	mainboard: board.value !== 'sideboard',
	sideboard: board.value !== 'mainboard',
}));
const bothShown = computed(() => shown.value.mainboard && shown.value.sideboard);

function setShown(key: BoardKey, show: boolean) {
	const next = { ...shown.value, [key]: show };
	if (!next.mainboard && !next.sideboard)
		return;
	emit('update', {
		board: next.mainboard && next.sideboard
			? 'full'
			: next.mainboard ? 'mainboard' : 'sideboard',
	});
}

function description(key: BoardKey, title: string): string {
	return shown.value[key] && !bothShown.value
		? 'The only board shown, so it stays on; show the other board to hide this one.'
		: `Show the ${title.toLowerCase()} on the Screen.`;
}

const sideboardEmpty = ref(false);
const sideboardLookup = createGuardedSequence();
const selectedPlayerId = computed(() => deck.value.deckSource?.type === 'player'
	? deck.value.deckSource.playerId
	: null);

watch([
	selectedPlayerId,
	() => playerStore.players,
], async ([playerId]) => {
	const flight = sideboardLookup.begin();
	sideboardEmpty.value = false;
	const player = playerId
		? playerStore.players.find(candidate => candidate.id === playerId)
		: undefined;
	if (!player)
		return;
	try {
		const fetched = await deckCache.fetchDeck(player.id, props.eventId, player.updatedAt);
		if (flight.stale)
			return;
		sideboardEmpty.value = !!fetched && !fetched.cards.some(card => card.compartment === 'sideboard');
	}
	catch {
		// The hint is a convenience; a failed deck fetch just leaves it off.
	}
}, { immediate: true });

const emptyBoardHint = computed(() => {
	const deckSource = deck.value.deckSource;
	if (deckSource?.type === 'broadcast') {
		const summary = broadcastDeckListStore.summaries.find(list => list.id === deckSource.broadcastDeckListId);
		if (!summary)
			return null;
		if (bothShown.value && summary.mainboardQuantity === 0 && summary.sideboardQuantity === 0)
			return 'This Broadcast Deck List has no cards, so the output shows only its header.';
		if (shown.value.mainboard && summary.mainboardQuantity === 0)
			return 'This Broadcast Deck List has no mainboard cards, so the output shows nothing for the mainboard.';
		if (shown.value.sideboard && summary.sideboardQuantity === 0)
			return 'This Broadcast Deck List has no sideboard cards, so the output shows nothing for the sideboard.';
		return null;
	}
	return shown.value.sideboard && sideboardEmpty.value
		? 'This player\'s deck has no sideboard cards, so the output shows nothing for the sideboard.'
		: null;
});
</script>

<template>
	<div class="flex flex-col gap-4">
		<ScreenSettingsToggle
			v-for="entry in BOARDS"
			:key="entry.key"
			:data-board-toggle="entry.key"
			:label="`Show ${entry.title.toLowerCase()}`"
			:description="description(entry.key, entry.title)"
			:model-value="shown[entry.key]"
			@update:model-value="setShown(entry.key, !!$event)"
		/>
		<ScreenSettingsHint v-if="emptyBoardHint" data-testid="empty-board-hint">
			{{ emptyBoardHint }}
		</ScreenSettingsHint>
	</div>
</template>
