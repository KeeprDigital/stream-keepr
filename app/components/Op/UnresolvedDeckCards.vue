<script setup lang="ts">
import type { OpCardSummary } from '~~/shared/types/card/op';
import type { OpUnresolvedDeckCard, OpUnresolvedDeckCardAnswer, OpUnresolvedDeckCardHolder } from '~~/shared/types/opUnresolvedDeckCard';
import { parseOpCardNumber } from '~~/shared/utils/card/op';

/**
 * A One Piece Card Game Event's Unresolved Deck Cards (ADR-0074): every card
 * number bandai-keepr did not know, Event-wide, with the Deck Lists holding
 * it. Each can be looked up again, or resolved to a card picked from a
 * bandai-keepr search, which rewrites every Deck List holding it. Players and
 * Slots follow the writes' own announcements; this list re-reads after each.
 */
const SEARCH_RESULT_LIMIT = 8;

const eventStore = useEventStore();
const featureMatchStore = useFeatureMatchStore();
const repository = useOpUnresolvedDeckCardRepository();
const cardRepository = useOpCardRepository();
const { runRequest } = useRequestFeedback();

const cards = ref<OpUnresolvedDeckCard[]>([]);
const loading = ref(false);
const retryingNumber = ref<string | null>(null);
/** The number whose resolve search is open. */
const resolvingNumber = ref<string | null>(null);
/** The picked card a resolution is writing. */
const resolvingTo = ref<string | null>(null);
const searchTerm = ref('');
const searching = ref(false);
const searchResults = ref<OpCardSummary[]>([]);
const searchUnavailable = ref(false);
let searchGeneration = 0;

function holderLabel(holder: OpUnresolvedDeckCardHolder): string {
	if (holder.kind === 'player')
		return holder.name;
	const position = featureMatchStore.featureMatches.findIndex(slot => slot.id === holder.slotId);
	const slot = position >= 0
		? `Feature Match ${position + 1}`
		: 'Feature Match';
	return holder.name
		? `${slot}: ${holder.name}`
		: slot;
}

function holderKey(holder: OpUnresolvedDeckCardHolder): string {
	return holder.kind === 'player'
		? `player:${holder.playerId}`
		: `slot:${holder.slotId}:${holder.side}`;
}

async function load() {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	const answer = await runRequest(() => repository.list(eventId), {
		loadingRef: loading,
		error: { title: 'Failed to load Unresolved Deck Cards', color: 'error' },
	});
	if (answer)
		cards.value = answer;
}

onMounted(load);

function rewrittenText(answer: OpUnresolvedDeckCardAnswer): string {
	return `${answer.rewritten} Deck List${answer.rewritten === 1
		? ''
		: 's'} now hold ${answer.card?.number} ${answer.card?.name}.`;
}

async function retry(number: string) {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	retryingNumber.value = number;
	await runRequest(() => repository.retry(eventId, number), {
		success: answer => answer.card
			? {
					title: `${number} resolved`,
					description: rewrittenText(answer),
					color: 'success',
				}
			: { title: `${number} is still unknown`, description: 'bandai-keepr has no card with this number yet.', color: 'warning' },
		error: { title: `Failed to retry ${number}`, color: 'error' },
	});
	retryingNumber.value = null;
	await load();
}

function openResolve(number: string) {
	searchGeneration++;
	resolvingNumber.value = resolvingNumber.value === number
		? null
		: number;
	searchTerm.value = '';
	searchResults.value = [];
	searchUnavailable.value = false;
	searching.value = false;
}

async function search() {
	const eventId = eventStore.eventId;
	const term = searchTerm.value.trim();
	if (!eventId || !term)
		return;
	const generation = ++searchGeneration;
	const number = parseOpCardNumber(term);
	const answer = await runRequest(() => cardRepository.searchCards(eventId, number
		? { number }
		: { q: term }), {
		loadingRef: searching,
		error: { title: 'Failed to search bandai-keepr', color: 'error' },
	});
	// A newer search, or a closed one, wins over this answer.
	if (!answer || generation !== searchGeneration)
		return;
	searchUnavailable.value = !answer.available;
	searchResults.value = answer.available
		? answer.items.slice(0, SEARCH_RESULT_LIMIT)
		: [];
}

async function resolve(number: string, card: OpCardSummary) {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	resolvingTo.value = card.number;
	const answer = await runRequest(() => repository.resolve(eventId, number, card.number), {
		success: resolved => ({
			title: `${number} resolved`,
			description: rewrittenText(resolved),
			color: 'success',
		}),
		error: { title: `Failed to resolve ${number}`, color: 'error' },
	});
	resolvingTo.value = null;
	if (answer)
		openResolve(number);
	await load();
}
</script>

<template>
	<UCard>
		<template #header>
			<div class="flex items-center justify-between gap-2">
				<div>
					<h2 class="font-semibold">
						Unresolved Deck Cards
					</h2>
					<p class="text-sm text-muted">
						Card numbers bandai-keepr didn't know, in every Deck List in the Event.
					</p>
				</div>
				<UButton
					icon="i-lucide-refresh-cw"
					color="neutral"
					variant="ghost"
					aria-label="Reload Unresolved Deck Cards"
					:loading="loading"
					@click="load"
				/>
			</div>
		</template>

		<p v-if="!loading && cards.length === 0" class="text-sm text-muted" data-unresolved-empty>
			Every card number in the Event's Deck Lists is known.
		</p>

		<ul v-else class="flex flex-col divide-y divide-default" aria-label="Unresolved Deck Cards">
			<li
				v-for="card in cards"
				:key="card.number"
				class="flex flex-col gap-2 py-3"
				:data-unresolved-number="card.number"
			>
				<div class="flex items-center gap-3">
					<span class="font-mono font-medium">{{ card.number }}</span>
					<UBadge color="neutral" variant="subtle" data-copies>
						{{ card.copies }} {{ card.copies === 1 ? 'copy' : 'copies' }}
					</UBadge>
					<div class="ml-auto flex gap-2">
						<UButton
							label="Retry"
							icon="i-lucide-rotate-cw"
							color="neutral"
							variant="outline"
							size="sm"
							:aria-label="`Retry ${card.number}`"
							:loading="retryingNumber === card.number"
							@click="retry(card.number)"
						/>
						<UButton
							label="Resolve"
							icon="i-lucide-search"
							color="primary"
							variant="soft"
							size="sm"
							:aria-label="`Resolve ${card.number}`"
							:aria-expanded="resolvingNumber === card.number"
							@click="openResolve(card.number)"
						/>
					</div>
				</div>

				<ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" :aria-label="`Deck Lists holding ${card.number}`">
					<li
						v-for="deckList in card.deckLists"
						:key="holderKey(deckList.holder)"
						data-holder
						:data-as-leader="deckList.asLeader"
					>
						{{ deckList.quantity }}x {{ holderLabel(deckList.holder) }}<span v-if="deckList.asLeader"> (Leader)</span>
					</li>
				</ul>

				<div v-if="resolvingNumber === card.number" class="flex flex-col gap-2">
					<form
						class="flex gap-2"
						:aria-label="`Search bandai-keepr for ${card.number}`"
						@submit.prevent="search"
					>
						<UInput
							v-model="searchTerm"
							class="flex-1"
							placeholder="Card name or number"
							aria-label="Search bandai-keepr"
							:loading="searching"
						/>
						<UButton
							type="submit"
							label="Search"
							color="neutral"
							variant="outline"
							:loading="searching"
						/>
					</form>
					<UAlert
						v-if="searchUnavailable"
						color="warning"
						variant="subtle"
						icon="i-lucide-cloud-off"
						title="Card data unavailable"
						data-search-unavailable
					/>
					<ul v-else class="flex flex-col gap-1" :aria-label="`Cards to resolve ${card.number} to`">
						<li v-for="result in searchResults" :key="result.number" class="flex items-center gap-2 text-sm">
							<span class="w-20 font-mono text-muted">{{ result.number }}</span>
							<span class="min-w-0 flex-1 truncate">{{ result.name }}</span>
							<span class="text-muted capitalize">{{ result.category }}</span>
							<UButton
								label="Use"
								size="xs"
								color="primary"
								variant="outline"
								:aria-label="`Resolve ${card.number} to ${result.number}`"
								:loading="resolvingTo === result.number"
								:disabled="resolvingTo !== null && resolvingTo !== result.number"
								@click="resolve(card.number, result)"
							/>
						</li>
					</ul>
				</div>
			</li>
		</ul>
	</UCard>
</template>
