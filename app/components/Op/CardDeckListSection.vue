<script setup lang="ts">
import type { OpDeckListEntry } from '~~/shared/types/opDeckList';

/**
 * One collapsible section of a One Piece Deck List on the Cards page, as
 * `MtgCardDeckListSection` is for Magic. Choosing a card previews it on Card
 * Spotlight; an Unresolved Deck Card shows its number and cannot be chosen.
 */
const props = withDefaults(defineProps<{
	title: string;
	entries: OpDeckListEntry[];
	filter: string;
	defaultOpen?: boolean;
}>(), {
	defaultOpen: true,
});

const cardStore = useCardStore();

const filteredEntries = computed(() => {
	const search = props.filter.trim().toLowerCase();
	if (!search)
		return props.entries;
	return props.entries.filter(entry =>
		entry.number.toLowerCase().includes(search)
		|| entry.card?.name.toLowerCase().includes(search),
	);
});

function countOf(entries: OpDeckListEntry[]) {
	return entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

const countLabel = computed(() => {
	const total = countOf(props.entries);
	const filtered = countOf(filteredEntries.value);
	return props.filter.trim() && filtered !== total
		? `${filtered}/${total}`
		: String(total);
});

const resolvedEntries = computed(() => filteredEntries.value.flatMap(entry => entry.card
	? [
			{ ...entry, card: entry.card },
		]
	: []));

const unresolvedEntries = computed(() => filteredEntries.value.filter(entry => entry.card == null));
</script>

<template>
	<UCollapsible :default-open="defaultOpen" class="border-b border-default last:border-b-0">
		<template #default="{ open }">
			<button
				type="button"
				class="flex w-full items-center justify-between gap-3 py-3 text-left"
			>
				<div class="flex min-w-0 items-center gap-2">
					<h3 class="text-base font-semibold">
						{{ title }}
					</h3>
					<UBadge color="neutral" variant="soft" size="sm">
						{{ countLabel }}
					</UBadge>
				</div>
				<UIcon
					name="i-lucide-chevron-down"
					class="size-4 shrink-0 text-muted transition-transform"
					:class="{ 'rotate-180': open }"
				/>
			</button>
		</template>

		<template #content>
			<div class="pb-5">
				<div v-if="resolvedEntries.length" class="card-list-container">
					<div class="card-list">
						<div
							v-for="entry in resolvedEntries"
							:key="entry.number"
							class="card-list-item"
							:data-card-number="entry.number"
						>
							<OpCardImage
								:card="entry.card"
								selectable
								@selected="cardStore.selectOpCard({ number: entry.number })"
							/>
							<div class="card-quantity">
								{{ entry.quantity }}x
							</div>
						</div>
					</div>
				</div>

				<p v-else-if="!unresolvedEntries.length" class="py-6 text-center text-sm text-muted">
					No cards match this filter.
				</p>

				<div v-if="unresolvedEntries.length" class="unresolved-grid" :class="{ 'mt-4': resolvedEntries.length }">
					<div
						v-for="entry in unresolvedEntries"
						:key="entry.number"
						class="card-placeholder"
						data-unresolved-deck-card
						:data-card-number="entry.number"
					>
						<div class="placeholder-content">
							<span class="text-sm font-medium font-mono">{{ entry.number }}</span>
							<span class="text-xs text-muted">{{ entry.quantity }}x</span>
						</div>
					</div>
				</div>
			</div>
		</template>
	</UCollapsible>
</template>

<style scoped>
.card-list-container {
	container-name: card-list;
	container-type: inline-size;

	.card-list {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 1rem;
	}

	@container (max-width: 1600px) {
		.card-list {
			grid-template-columns: repeat(6, 1fr);
		}
	}

	@container (max-width: 1440px) {
		.card-list {
			grid-template-columns: repeat(5, 1fr);
		}
	}

	@container (max-width: 1024px) {
		.card-list {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	@container (max-width: 768px) {
		.card-list {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@container (max-width: 480px) {
		.card-list {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@container (max-width: 320px) {
		.card-list {
			grid-template-columns: repeat(1, 1fr);
		}
	}
}

.card-list-item {
	position: relative;
}

.card-quantity {
	position: absolute;
	bottom: 0.5rem;
	right: 0.5rem;
	background: rgba(0, 0, 0, 0.8);
	color: white;
	padding: 0.25rem 0.75rem;
	border-radius: 0.5rem;
	font-size: 1.125rem;
	font-weight: 700;
	pointer-events: none;
}

.unresolved-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 1rem;
}

.card-placeholder {
	aspect-ratio: 600 / 838;
	background: var(--ui-bg-elevated);
	border-radius: var(--mtg-card-radius);
	display: flex;
	align-items: center;
	justify-content: center;
	border: 2px dashed var(--ui-border);
}

.placeholder-content {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	padding: 1rem;
}
</style>
