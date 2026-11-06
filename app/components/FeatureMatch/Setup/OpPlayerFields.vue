<script setup lang="ts">
import type { OpCardSummary } from '~~/shared/types/card/op';
import type { OpPlayerGameData } from '~~/shared/types/game';
import { opCardMatchesText, opLeaderOf } from '~~/shared/utils/card/op';

/**
 * A side's Leader, picked from every Leader the Event's One Piece card search
 * lists, loaded once and filtered as the operator types, so part of a name or
 * card number finds it. The side references the card in the card catalogue by
 * its number (ADR-0074), so the Leader shown is the catalogue's.
 */
const modelValue = defineModel<OpPlayerGameData>({
	required: true,
});

/** The largest page the `op-cards` route serves. */
const PAGE_SIZE = 250;

const eventStore = useEventStore();
const { searchCards } = useOpCardRepository();
const text = ref('');
const leaders = ref<OpCardSummary[]>([]);
const loading = ref(false);
/** `null` until bandai-keepr has answered; `false` while this installation has none configured. */
const available = ref<boolean | null>(null);
const loadError = ref<string | null>(null);

const leader = computed(() => modelValue.value.leader ?? null);
/** Leaders answer the text typed; with none, nothing is offered. */
const offered = computed(() => leaders.value.filter(card => opCardMatchesText(card, text.value)));

/** Every Leader, a page at a time; whether card data is available is known from the first page. */
async function loadLeaders() {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	loading.value = true;
	loadError.value = null;
	try {
		const loaded: OpCardSummary[] = [];
		while (true) {
			const answer = await searchCards(eventId, { category: 'leader', limit: PAGE_SIZE, offset: loaded.length });
			available.value = answer.available;
			if (!answer.available)
				break;
			loaded.push(...answer.items);
			if (answer.items.length === 0 || loaded.length >= answer.total)
				break;
		}
		leaders.value = loaded;
	}
	catch {
		loadError.value = 'Leaders could not be loaded. Try again.';
	}
	finally {
		loading.value = false;
	}
}

function pick(card: OpCardSummary) {
	modelValue.value = {
		...modelValue.value,
		leader: opLeaderOf(card),
	};
	text.value = '';
}

function clear() {
	modelValue.value = { ...modelValue.value, leader: null };
}

onMounted(loadLeaders);
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
				:loading="loading"
				:disabled="available === false"
				aria-label="Search Leaders"
				@keydown.enter.prevent
			/>

			<p v-if="available === false" class="text-sm text-muted">
				Card data unavailable: no bandai-keepr is configured for this installation.
			</p>
			<p v-else-if="loadError" class="flex items-center gap-2 text-sm text-error">
				{{ loadError }}
				<UButton
					label="Retry"
					size="xs"
					color="neutral"
					variant="outline"
					@click="loadLeaders"
				/>
			</p>
			<p v-else-if="text.trim() && !loading && offered.length === 0" class="text-sm text-muted" data-no-leaders>
				No Leaders match “{{ text.trim() }}”.
			</p>

			<ul v-if="offered.length > 0" class="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Leaders">
				<li v-for="card in offered" :key="card.number">
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
