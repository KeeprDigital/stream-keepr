<script setup lang="ts">
import type { PlayerDeckCardEntry, PlayerDeckResponse } from '~~/shared/types/metagame';
import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import type { Player } from '~/types';

interface PlayerDeckTokenSource {
	player: Player;
	deck: PlayerDeckResponse | null;
}

interface FeatureMatchTokenEntry extends DeckTokenRequirement {
	playerNames: string[];
	sourceCardNames: string[];
}

const props = defineProps<{
	open: boolean;
	matchTitle: string;
	playerOne: Player | null;
	playerTwo: Player | null;
}>();

const emit = defineEmits<{
	'update:open': [value: boolean];
}>();

const eventStore = useEventStore();
const deckCache = usePlayerDeckCache();
const loading = ref(false);
const playerDecks = shallowRef<PlayerDeckTokenSource[]>([]);

const players = computed(() => [props.playerOne, props.playerTwo].filter((player): player is Player => player != null));

function tokenKey(token: DeckTokenRequirement): string {
	return token.name.trim().toLowerCase();
}

function close() {
	emit('update:open', false);
}

async function loadTokenSources() {
	if (!props.open || !eventStore.eventId) {
		return;
	}

	loading.value = true;
	try {
		playerDecks.value = await Promise.all(players.value.map(async player => ({
			player,
			deck: await deckCache.fetchDeck(player.id, eventStore.eventId!, player.updatedAt),
		})));
	}
	finally {
		loading.value = false;
	}
}

watch(
	[
		() => props.open,
		() => props.playerOne?.id,
		() => props.playerOne?.updatedAt,
		() => props.playerTwo?.id,
		() => props.playerTwo?.updatedAt,
	],
	() => {
		void loadTokenSources();
	},
	{ immediate: true },
);

function addSourceCard(entry: FeatureMatchTokenEntry, card: PlayerDeckCardEntry) {
	if (!entry.sourceCardNames.includes(card.name)) {
		entry.sourceCardNames.push(card.name);
	}
}

function addPlayer(entry: FeatureMatchTokenEntry, playerName: string) {
	if (!entry.playerNames.includes(playerName)) {
		entry.playerNames.push(playerName);
	}
}

const tokenEntries = computed(() => {
	const tokenMap = new Map<string, FeatureMatchTokenEntry>();

	for (const { player, deck } of playerDecks.value) {
		for (const card of deck?.cards ?? []) {
			for (const token of card.deckTokens ?? []) {
				const trimmedName = token.name.trim();
				if (!trimmedName)
					continue;

				const key = tokenKey(token);
				const entry = tokenMap.get(key) ?? {
					id: token.id,
					scryfallId: token.scryfallId,
					name: trimmedName,
					typeLine: token.typeLine,
					uri: token.uri,
					playerNames: [],
					sourceCardNames: [],
				};

				addPlayer(entry, player.name);
				addSourceCard(entry, card);
				tokenMap.set(key, entry);
			}
		}
	}

	return [...tokenMap.values()]
		.map(entry => ({
			...entry,
			playerNames: [...entry.playerNames].sort((a, b) => a.localeCompare(b)),
			sourceCardNames: [...entry.sourceCardNames].sort((a, b) => a.localeCompare(b)),
		}))
		.sort((a, b) => b.playerNames.length - a.playerNames.length || a.name.localeCompare(b.name));
});
</script>

<template>
	<UModal
		:open="open"
		:title="`${matchTitle} Tokens`"
		:close="{ onClick: close }"
		:ui="{ content: 'sm:max-w-5xl', footer: 'justify-end' }"
		@update:open="emit('update:open', $event)"
	>
		<template #body>
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted">
					Tokens required by the selected feature match players.
				</p>

				<UILoadingSpinner v-if="loading" size="sm" label="Loading token requirements..." />

				<UIEmptyState
					v-else-if="tokenEntries.length === 0"
					variant="inline"
					icon="i-lucide-images"
					title="No required tokens"
					description="The selected players' current deck lists do not require any tokens."
				/>

				<div v-else class="grid gap-3 md:grid-cols-2">
					<div
						v-for="token in tokenEntries"
						:key="token.name"
						class="flex gap-3 rounded-md border border-default bg-elevated/50 p-3"
					>
						<MetagameCardThumbnail
							:scryfall-id="token.scryfallId"
							:name="token.name"
							size="sm"
						/>
						<div class="min-w-0 flex-1">
							<div class="font-medium truncate">
								{{ token.name }}
							</div>
							<div v-if="token.typeLine" class="text-xs text-muted truncate">
								{{ token.typeLine }}
							</div>
							<div class="mt-2 flex flex-wrap gap-1">
								<UBadge
									v-for="playerName in token.playerNames"
									:key="playerName"
									color="neutral"
									variant="soft"
									size="sm"
								>
									{{ playerName }}
								</UBadge>
							</div>
							<div v-if="token.sourceCardNames.length > 0" class="mt-2 text-xs text-muted">
								<span class="font-medium text-default">Sources:</span>
								{{ token.sourceCardNames.join(', ') }}
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton variant="ghost" color="neutral" @click="close">
				Close
			</UButton>
		</template>
	</UModal>
</template>
