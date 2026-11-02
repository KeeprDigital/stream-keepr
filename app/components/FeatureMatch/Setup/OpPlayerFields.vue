<script setup lang="ts">
import type { OpCardSummary } from '~~/shared/types/card/op';
import type { OpPlayerGameData } from '~~/shared/types/game';
import { opLeaderOf } from '~~/shared/utils/card/op';
import { opCardSearchParams } from '~/modules/card-screen/opSpotlight';
import { createGuardedSequence } from '~/utils/guardedSequence';

/**
 * A side's Leader, picked from the Event's One Piece card search narrowed to
 * Leaders. The side holds an inline snapshot of the card (ADR-0057), so the
 * Leader it holds stays shown when card data is unavailable.
 */
const modelValue = defineModel<OpPlayerGameData>({
	required: true,
});

const eventStore = useEventStore();
const { searchCards } = useOpCardRepository();
const searches = createGuardedSequence();

const text = ref('');
const results = ref<OpCardSummary[]>([]);
const searching = ref(false);
/** `null` until bandai-keepr has answered; `false` while this installation has none configured. */
const available = ref<boolean | null>(null);
const failed = ref(false);

const leader = computed(() => modelValue.value.leader ?? null);

async function searchNow() {
	const eventId = eventStore.eventId;
	const query = text.value.trim();
	const flight = searches.begin();
	if (!eventId || !query) {
		results.value = [];
		searching.value = false;
		return;
	}
	searching.value = true;
	try {
		const answer = await searchCards(eventId, opCardSearchParams({ text: query, category: 'leader' }));
		if (!flight.current)
			return;
		available.value = answer.available;
		results.value = answer.available
			? answer.items
			: [];
		failed.value = false;
	}
	catch {
		if (!flight.current)
			return;
		results.value = [];
		failed.value = true;
	}
	finally {
		if (flight.current)
			searching.value = false;
	}
}

const search = useDebounceFn(searchNow, 300);

function pick(card: OpCardSummary) {
	modelValue.value = {
		...modelValue.value,
		leader: opLeaderOf(card),
	};
	searches.supersede();
	text.value = '';
	results.value = [];
	searching.value = false;
}

function clear() {
	modelValue.value = { ...modelValue.value, leader: null };
}
</script>

<template>
	<UFormField
		label="Leader"
		name="leader"
		:description="available === false ? undefined : 'Search Leaders by name or card number.'"
		class="w-full"
	>
		<div class="flex flex-col gap-2">
			<div
				v-if="leader"
				class="flex items-center gap-3 rounded-md border border-default p-2"
				data-leader
			>
				<img
					:src="leader.imageUrl"
					:alt="leader.name"
					class="h-14 rounded-sm"
					style="aspect-ratio: 600 / 838"
					loading="lazy"
				>
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">
						{{ leader.name }}
					</p>
					<p class="flex items-center gap-2 text-sm text-muted">
						{{ leader.number }}
						<OpColorDisplay :colors="leader.colors" size="sm" />
					</p>
				</div>
				<UButton
					icon="i-lucide-x"
					color="neutral"
					variant="ghost"
					aria-label="Clear Leader"
					@click="clear"
				/>
			</div>

			<UInput
				v-model="text"
				class="w-full"
				icon="i-lucide-search"
				:placeholder="leader ? 'Change Leader' : 'Search Leaders'"
				:loading="searching"
				:disabled="available === false"
				aria-label="Search Leaders"
				@update:model-value="search"
				@keydown.enter.prevent="searchNow"
			/>

			<p v-if="available === false" class="text-sm text-muted">
				Card data unavailable: no bandai-keepr is configured for this installation.
			</p>
			<p v-else-if="failed" class="text-sm text-error">
				Leader search failed. Try again.
			</p>

			<ul v-if="results.length > 0" class="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Leaders">
				<li v-for="card in results" :key="card.number">
					<button
						type="button"
						class="flex w-full items-center gap-3 rounded-md p-1 text-left hover:bg-elevated"
						:aria-label="`Pick Leader ${card.name} (${card.number})`"
						@click="pick(card)"
					>
						<img
							:src="card.imageUrl"
							alt=""
							class="h-12 rounded-sm"
							style="aspect-ratio: 600 / 838"
							loading="lazy"
						>
						<span class="min-w-0 flex-1 truncate">{{ card.name }}</span>
						<span class="text-sm text-muted">{{ card.number }}</span>
						<OpColorDisplay :colors="opLeaderOf(card).colors" size="sm" />
					</button>
				</li>
			</ul>
		</div>
	</UFormField>
</template>
