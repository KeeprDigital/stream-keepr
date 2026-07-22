<script setup lang="ts">
import type { MatchPlayerDeckData } from '~/types/card/deckList';
import { formatHighlanderPointsLabel } from '~~/shared/utils/highlander';

const props = defineProps<{
	playerData: MatchPlayerDeckData | null;
	filter: string;
}>();

const playerStore = usePlayerStore();
const { openDeckLists } = usePlayerDeckListModal();

function openDeckListModal() {
	if (!props.playerData?.deckList)
		return;
	const player = playerStore.players.find(
		p => p.name.toLowerCase() === props.playerData!.playerName.toLowerCase(),
	);
	openDeckLists({
		playerName: props.playerData.playerName,
		playerId: player?.id,
		deckLists: [props.playerData.deckList],
	});
}
const highlanderImageUrlsByCardName = computed<Record<string, string | null>>(() => {
	const imageUrls: Record<string, string | null> = {};
	for (const card of [...(props.playerData?.mainboard ?? []), ...(props.playerData?.sideboard ?? [])]) {
		imageUrls[card.name] = card.mtgCard?.imageData?.front?.normal ?? null;
	}
	if (props.playerData?.deckList?.companion) {
		imageUrls[props.playerData.deckList.companion.name] = props.playerData.deckList.companion.scryfallId
			? `https://api.scryfall.com/cards/${props.playerData.deckList.companion.scryfallId}?format=image&version=normal`
			: null;
	}
	return imageUrls;
});
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
				<template v-if="playerData.deckList">
					<button type="button" class="flex items-center gap-1 text-muted truncate hover:text-primary transition-colors cursor-pointer" @click="openDeckListModal">
						<UIcon name="i-lucide-list" class="w-3.5 h-3.5 shrink-0" />
						{{ playerData.deckList.name }}
					</button>
					<MtgManaColorDisplay :colors="playerData.deckList.colors" size="sm" />
					<div v-if="playerData.deckList.companion" class="flex items-center gap-2 min-w-0">
						<span class="text-xs uppercase tracking-wide text-muted shrink-0">Companion</span>
						<span class="font-medium truncate">{{ playerData.deckList.companion.name }}</span>
					</div>
					<UBadge
						v-if="playerData.deckList.highlander"
						color="neutral"
						variant="soft"
						size="sm"
						class="px-3 py-1 text-sm font-semibold"
					>
						{{ formatHighlanderPointsLabel(playerData.deckList.highlander) }}
					</UBadge>
					<div v-if="playerData.deckCounters.length > 0" class="flex items-center gap-1.5 min-w-0">
						<span class="text-xs uppercase tracking-wide text-muted shrink-0">Counters</span>
						<UBadge
							v-for="counter in playerData.deckCounters"
							:key="counter.key"
							color="neutral"
							variant="soft"
							size="sm"
							class="gap-1"
						>
							<UIcon :name="counter.icon" class="size-3.5" />
							{{ counter.label }}
						</UBadge>
					</div>
				</template>
			</div>

			<MtgHighlanderSummary
				:highlander="playerData.deckList?.highlander"
				:image-urls-by-card-name="highlanderImageUrlsByCardName"
				compact
				class="mb-4"
			/>

			<!-- No deck list -->
			<UIEmptyState
				v-if="!playerData.deckList"
				variant="inline"
				icon="i-lucide-layers"
				title="No deck list"
				class="flex-1"
			/>

			<!-- All compartments share one scroll flow and can be collapsed independently. -->
			<div v-else>
				<MtgCardDeckListSection
					title="Mainboard"
					:cards="playerData.mainboard"
					:filter="filter"
					:default-open="true"
				/>
				<MtgCardDeckListSection
					v-if="playerData.sideboard.length"
					title="Sideboard"
					:cards="playerData.sideboard"
					:filter="filter"
					:default-open="true"
				/>
				<MtgCardDeckListSection
					v-if="playerData.tokens.length"
					title="Tokens"
					:cards="playerData.tokens"
					:filter="filter"
					:default-open="false"
				/>
			</div>
		</template>
	</div>
</template>
