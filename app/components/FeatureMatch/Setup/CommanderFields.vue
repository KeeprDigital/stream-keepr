<script setup lang="ts">
import type { Commander, MtgPlayerGameData } from '~~/shared/types/game';
import { colourIdentityColours, MAX_SEAT_COMMANDERS } from '~~/shared/utils/commander';
import { commanderOfDeckListEntry } from '~~/shared/utils/commanderDeckList';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';
import { COMMANDER_SEARCH_MIN_LENGTH, searchCommanderCards, searchCommanderPrintings } from '~/utils/commanderSearch';

/**
 * A Seat's one or two Commanders, picked from Scryfall's card search and each
 * held as one printing (ADR-0087). Any card may be picked: nothing checks that
 * it can be a Commander or that a pair may share a deck. While the Seat holds
 * a Feature Match Deck List they are picked from its cards instead, each as
 * the list's printing; clearing the list returns to the card search.
 */
const props = defineProps<{
	/** The Seat's Slot, whose Deck List the Commanders are picked from while one is held. */
	slotId?: number;
}>();

const modelValue = defineModel<MtgPlayerGameData>({
	required: true,
});

const eventStore = useEventStore();
const deckListRepository = useFeatureMatchDeckListRepository();

const text = ref('');
const offered = ref<Commander[]>([]);
const searching = ref(false);
/** The text of the last search that answered no card, or failed. */
const unmatched = ref<string | null>(null);
const searchFailed = ref(false);
/** The place, among the held Commanders, of the one whose printings are offered, and those printings. */
const printingsOpenAt = ref<number | null>(null);
const printings = ref<Commander[]>([]);
/** Whether the offered Commander's printings have been answered. */
const printingsAnswered = ref(false);
let searchGeneration = 0;

const commanders = computed(() => modelValue.value.commanders ?? []);
const canAdd = computed(() => commanders.value.length < MAX_SEAT_COMMANDERS);
const deckList = computed(() => modelValue.value.featureMatchDeckList ?? null);
/** The held Deck List's cards, each as the Commander it would be, and the list they were read from. */
let deckListCards: { id: number; cards: Commander[] } | null = null;

async function searchDeckList(id: number, text: string): Promise<Commander[]> {
	const eventId = eventStore.eventId;
	if (!eventId || !props.slotId)
		return [];
	if (deckListCards?.id !== id) {
		const saved = await deckListRepository.readCommander(eventId, props.slotId, id);
		deckListCards = {
			id,
			cards: saved.entries.map(commanderOfDeckListEntry),
		};
	}
	const wanted = text.toLowerCase();
	return deckListCards.cards.filter(card =>
		card.name.toLowerCase().includes(wanted)
		&& !commanders.value.some(commander => commander.scryfallId === card.scryfallId));
}

function hold(next: Commander[]) {
	modelValue.value = { ...modelValue.value, commanders: next };
}

function printingLabel(commander: Commander) {
	return `${commander.setCode.toUpperCase()} ${commander.collectorNumber}`;
}

async function searchNow() {
	const generation = ++searchGeneration;
	const submitted = text.value.trim();
	unmatched.value = null;
	searchFailed.value = false;
	const held = deckList.value;
	// A list is searched from the first letter; Scryfall asks for more of a name.
	if (submitted.length < (held ? 1 : COMMANDER_SEARCH_MIN_LENGTH)) {
		offered.value = [];
		return;
	}
	searching.value = true;
	try {
		const cards = held
			? await searchDeckList(held.id, submitted)
			: await searchCommanderCards(submitted);
		if (generation !== searchGeneration)
			return;
		offered.value = cards;
		if (cards.length === 0)
			unmatched.value = submitted;
	}
	catch {
		if (generation !== searchGeneration)
			return;
		offered.value = [];
		searchFailed.value = true;
	}
	finally {
		if (generation === searchGeneration)
			searching.value = false;
	}
}

const searchSoon = useDebounceFn(searchNow, 300);

function pick(commander: Commander) {
	hold([...commanders.value, commander]);
	text.value = '';
	offered.value = [];
}

function remove(index: number) {
	hold(commanders.value.filter((_, held) => held !== index));
	printingsOpenAt.value = null;
}

async function offerPrintings(index: number) {
	if (printingsOpenAt.value === index) {
		printingsOpenAt.value = null;
		return;
	}
	printingsOpenAt.value = index;
	printings.value = [];
	printingsAnswered.value = false;
	try {
		const found = await searchCommanderPrintings(commanders.value[index]!);
		if (printingsOpenAt.value === index) {
			printings.value = found;
			printingsAnswered.value = true;
		}
	}
	catch {
		if (printingsOpenAt.value === index)
			printingsOpenAt.value = null;
	}
}

/** Whether the printings offered hold one besides the printing held. */
function offersAnotherPrinting(commander: Commander) {
	return printings.value.some(printing => printing.scryfallId !== commander.scryfallId);
}

function pickPrinting(index: number, printing: Commander) {
	hold(commanders.value.map((commander, held) => held === index
		? printing
		: commander));
	printingsOpenAt.value = null;
}
</script>

<template>
	<!-- A group of controls, so a fieldset, not a form field whose label would claim them all. -->
	<fieldset class="flex w-full flex-col gap-2">
		<legend class="text-sm font-medium">
			Commanders
		</legend>
		<p v-if="deckList" class="text-sm text-muted" data-picked-from-deck-list>
			One or two of the Deck List's cards. Clear the list to search every card.
		</p>
		<p v-else class="text-sm text-muted">
			One or two, each as the printing you pick.
		</p>
		<div class="flex flex-col gap-2">
			<ul v-if="commanders.length > 0" class="flex flex-col gap-2" aria-label="Commanders">
				<li
					v-for="(commander, index) in commanders"
					:key="`${index}-${commander.scryfallId}`"
					class="flex flex-col gap-2 rounded-md border border-default p-2"
					data-commander
					:data-printing="commander.scryfallId"
				>
					<div class="flex items-center gap-3">
						<img
							:src="scryfallCardImageUrl(commander.scryfallId) ?? undefined"
							:alt="commander.name"
							class="h-14 rounded-sm"
							style="aspect-ratio: 488 / 680"
							loading="lazy"
						>
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">
								{{ commander.name }}
							</p>
							<p class="flex items-center gap-2 text-sm text-muted">
								{{ printingLabel(commander) }}
								<MtgManaColorDisplay :colors="colourIdentityColours(commander.colorIdentity)" size="sm" />
							</p>
						</div>
						<UButton
							v-if="!deckList"
							label="Printing"
							color="neutral"
							variant="outline"
							size="xs"
							:aria-label="`Change printing of ${commander.name}`"
							:aria-expanded="printingsOpenAt === index"
							@click="offerPrintings(index)"
						/>
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="ghost"
							:aria-label="`Remove ${commander.name}`"
							@click="remove(index)"
						/>
					</div>
					<ul
						v-if="printingsOpenAt === index && offersAnotherPrinting(commander)"
						class="flex max-h-56 flex-wrap gap-1 overflow-y-auto"
						:aria-label="`Printings of ${commander.name}`"
					>
						<li v-for="printing in printings" :key="printing.scryfallId">
							<button
								type="button"
								class="flex flex-col items-center gap-1 rounded-md p-1 text-xs hover:bg-elevated"
								:class="{ 'bg-elevated': printing.scryfallId === commander.scryfallId }"
								:aria-label="`Pick printing ${printingLabel(printing)}`"
								:aria-pressed="printing.scryfallId === commander.scryfallId"
								@click="pickPrinting(index, printing)"
							>
								<img
									:src="scryfallCardImageUrl(printing.scryfallId) ?? undefined"
									alt=""
									class="h-24 rounded-sm"
									style="aspect-ratio: 488 / 680"
									loading="lazy"
								>
								{{ printingLabel(printing) }}
							</button>
						</li>
					</ul>
					<p
						v-else-if="printingsOpenAt === index && printingsAnswered"
						class="text-sm text-muted"
						data-no-printings
					>
						No other printing of this card.
					</p>
				</li>
			</ul>

			<template v-if="canAdd">
				<UInput
					v-model="text"
					class="w-full"
					icon="i-lucide-search"
					:placeholder="deckList ? 'Search the Deck List' : commanders.length > 0 ? 'Add a second Commander' : 'Search cards'"
					:loading="searching"
					aria-label="Search Commanders"
					@update:model-value="searchSoon"
					@keydown.enter.prevent="searchNow"
				/>

				<p v-if="searchFailed" class="text-sm text-error" data-search-failed>
					Card search failed. Try again.
				</p>
				<p v-else-if="unmatched" class="text-sm text-muted" data-no-cards>
					No cards match “{{ unmatched }}”.
				</p>

				<ul v-if="offered.length > 0" class="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Cards">
					<li v-for="card in offered" :key="card.scryfallId">
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-md p-1 text-left hover:bg-elevated"
							:aria-label="`Pick Commander ${card.name}`"
							@click="pick(card)"
						>
							<img
								:src="scryfallCardImageUrl(card.scryfallId) ?? undefined"
								alt=""
								class="h-12 rounded-sm"
								style="aspect-ratio: 488 / 680"
								loading="lazy"
							>
							<span class="min-w-0 flex-1 truncate">{{ card.name }}</span>
							<MtgManaColorDisplay :colors="colourIdentityColours(card.colorIdentity)" size="sm" />
						</button>
					</li>
				</ul>
			</template>
		</div>
	</fieldset>
</template>
