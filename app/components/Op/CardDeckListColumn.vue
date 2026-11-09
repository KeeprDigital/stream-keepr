<script setup lang="ts">
import type { OpDeckListEntry } from '~~/shared/types/opDeckList';
import type { OpMatchPlayerDeckData } from '~/types/card/deckList';

/**
 * One side of a One Piece Feature Match Slot: who sits there, their Leader, and
 * their Deck List as a Leader section and one Mainboard section.
 */
const props = defineProps<{
	playerData: OpMatchPlayerDeckData | null;
	filter: string;
}>();

const playerStore = usePlayerStore();
const { openPlayerDeckList } = usePlayerDeckListModal();

/** A linked Player's Deck List opens read-only, as the Metagame opens it; a pasted one has no Player to open. */
const linkedPlayer = computed(() => props.playerData?.playerId == null
	? null
	: playerStore.players.find(player => player.id === props.playerData!.playerId) ?? null);

function isLeaderEntry(entry: OpDeckListEntry, leaderNumber: string | null) {
	return entry.number === leaderNumber || entry.card?.category === 'leader';
}

const leaderEntries = computed(() => {
	const deckList = props.playerData?.deckList;
	return deckList?.entries.filter(entry => isLeaderEntry(entry, deckList.leaderNumber)) ?? [];
});

const mainboardEntries = computed(() => {
	const deckList = props.playerData?.deckList;
	return deckList?.entries.filter(entry => !isLeaderEntry(entry, deckList.leaderNumber)) ?? [];
});

const leaderName = computed(() => props.playerData?.leader?.name
	?? leaderEntries.value[0]?.card?.name
	?? leaderEntries.value[0]?.number
	?? null);
</script>

<template>
	<div class="flex flex-col">
		<!-- No player -->
		<template v-if="!playerData">
			<UIEmptyState
				variant="inline"
				icon="i-lucide-user-x"
				title="No player"
				class="flex-1"
			/>
		</template>

		<template v-else>
			<!-- Player header -->
			<div class="flex items-center gap-2 mb-3 px-1">
				<span class="font-semibold text-lg truncate">{{ playerData.playerName }}</span>
				<template v-if="leaderName">
					<button
						v-if="linkedPlayer && playerData.deckList"
						type="button"
						class="flex items-center gap-1 text-muted truncate hover:text-primary transition-colors cursor-pointer"
						@click="openPlayerDeckList(linkedPlayer)"
					>
						<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
						{{ leaderName }}
					</button>
					<span v-else class="text-muted truncate">{{ leaderName }}</span>
					<OpColorDisplay v-if="playerData.leader" :colors="playerData.leader.colors" size="sm" />
				</template>
			</div>

			<!-- A Deck List the side holds but could not be read -->
			<UIEmptyState
				v-if="playerData.failed"
				variant="inline"
				icon="i-lucide-triangle-alert"
				title="Failed to load deck list"
				class="flex-1"
			/>

			<!-- No deck list -->
			<UIEmptyState
				v-else-if="!playerData.deckList"
				variant="inline"
				icon="i-lucide-layers"
				title="No deck list"
				class="flex-1"
			/>

			<!-- Both sections share one scroll flow and can be collapsed independently. -->
			<div v-else>
				<OpCardDeckListSection
					v-if="leaderEntries.length"
					title="Leader"
					:entries="leaderEntries"
					:filter="filter"
					:default-open="true"
				/>
				<OpCardDeckListSection
					title="Mainboard"
					:entries="mainboardEntries"
					:filter="filter"
					:default-open="true"
				/>
			</div>
		</template>
	</div>
</template>
