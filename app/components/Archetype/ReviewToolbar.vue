<script setup lang="ts">
import type { QueueFilter, ReviewEntry } from '~/composables/workflows/useArchetypeReviewQueue';
import { isReviewedPlayerDeck } from '~~/shared/utils/playerDeck';

const props = defineProps<{
	currentIndex: number;
	filteredCount: number;
	queueFilter: QueueFilter;
	reviewedCount: number;
	totalDecks: number;
	progressPercent: number;
	initialLoading: boolean;
	entries: ReviewEntry[];
	selectedDeckId?: number | null;
}>();

const emit = defineEmits<{
	(e: 'update:queueFilter', value: QueueFilter): void;
	(e: 'back'): void;
	(e: 'advance'): void;
	(e: 'jumpToDeck', deckId: number): void;
}>();

const jumpOptions = computed(() => props.entries.map(entry => ({
	label: entry.player.name,
	value: entry.deck.id,
	deckName: entry.displayName,
	reviewed: isReviewedPlayerDeck(entry.deck),
})));

const selectedJumpDeckId = computed(() => props.selectedDeckId ?? undefined);
</script>

<template>
	<UDashboardToolbar>
		<template #left>
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-1">
					<UButton
						color="neutral"
						variant="ghost"
						icon="i-lucide-chevron-left"
						size="sm"
						:disabled="currentIndex === 0 || initialLoading"
						@click="emit('back')"
					/>
					<UButton
						color="neutral"
						variant="ghost"
						icon="i-lucide-chevron-right"
						size="sm"
						:disabled="currentIndex >= filteredCount - 1 || initialLoading"
						@click="emit('advance')"
					/>
				</div>

				<USeparator orientation="vertical" class="h-4" />

				<div class="flex items-center gap-1">
					<UButton
						size="sm"
						:color="queueFilter === 'unreviewed' ? 'primary' : 'neutral'"
						:variant="queueFilter === 'unreviewed' ? 'soft' : 'ghost'"
						@click="emit('update:queueFilter', 'unreviewed')"
					>
						Unreviewed
					</UButton>
					<UButton
						size="sm"
						:color="queueFilter === 'reviewed' ? 'primary' : 'neutral'"
						:variant="queueFilter === 'reviewed' ? 'soft' : 'ghost'"
						@click="emit('update:queueFilter', 'reviewed')"
					>
						Reviewed
					</UButton>
					<UButton
						size="sm"
						:color="queueFilter === 'all' ? 'primary' : 'neutral'"
						:variant="queueFilter === 'all' ? 'soft' : 'ghost'"
						@click="emit('update:queueFilter', 'all')"
					>
						All
					</UButton>
				</div>
			</div>
		</template>
		<template #right>
			<div class="flex items-center gap-3">
				<USelectMenu
					:model-value="selectedJumpDeckId"
					:items="jumpOptions"
					value-key="value"
					placeholder="Jump to player/deck…"
					:disabled="initialLoading || entries.length === 0"
					class="w-72"
					@update:model-value="(value) => typeof value === 'number' && emit('jumpToDeck', value)"
				>
					<template #item-label="{ item }">
						<div class="flex min-w-0 flex-col">
							<div class="flex items-center gap-2">
								<span class="truncate font-medium">{{ item.label }}</span>
								<UBadge :color="item.reviewed ? 'success' : 'neutral'" variant="subtle" size="sm">
									{{ item.reviewed ? 'Reviewed' : 'Unreviewed' }}
								</UBadge>
							</div>
							<span v-if="item.deckName" class="truncate text-xs text-muted">{{ item.deckName }}</span>
						</div>
					</template>
				</USelectMenu>

				<USeparator orientation="vertical" class="h-4" />

				<span class="text-sm text-muted">Reviewed</span>
				<span class="text-sm tabular-nums">{{ reviewedCount }} / {{ totalDecks }}</span>
				<UProgress :model-value="progressPercent" size="xs" class="w-48" />

				<USeparator orientation="vertical" class="h-4" />

				<span class="text-sm text-muted">Deck</span>
				<span class="text-sm tabular-nums">{{ filteredCount > 0 ? currentIndex + 1 : 0 }} of {{ filteredCount }}</span>
			</div>
		</template>
	</UDashboardToolbar>
</template>
