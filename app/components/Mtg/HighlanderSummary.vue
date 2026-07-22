<script setup lang="ts">
import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import { formatHighlanderIssueSummary, formatHighlanderPointedCardNote, formatHighlanderPointsLabel } from '~~/shared/utils/highlander';

const props = defineProps<{
	highlander?: HighlanderDeckSummary | null;
	imageUrlsByCardName?: Record<string, string | null>;
	compact?: boolean;
}>();

const eventStore = useEventStore();
const {
	activePreviewCard,
	handlePreviewUpdate,
	togglePreviewPin,
} = useCardPreview();

const syncPath = computed(() => eventStore.eventId ? `/event/${eventStore.eventId}/sync` : null);

function getImageUrl(cardName: string): string | null {
	return props.imageUrlsByCardName?.[cardName] ?? null;
}
</script>

<template>
	<div
		v-if="highlander"
		class="rounded-lg border border-default bg-elevated/40"
		:class="props.compact ? 'flex flex-col gap-2 p-2' : 'flex flex-col gap-3 p-3'"
	>
		<div class="flex items-center justify-between gap-3">
			<p class="text-sm font-medium">
				{{ formatHighlanderPointsLabel(highlander) }}
			</p>
			<UBadge v-if="!props.compact && highlander.status === 'unknown'" color="warning" variant="subtle">
				Unknown
			</UBadge>
			<UBadge v-else-if="!props.compact && highlander.status === 'illegal'" color="error" variant="subtle">
				Illegal
			</UBadge>
		</div>

		<div v-if="!props.compact">
			<p class="text-xs uppercase tracking-wide text-muted mb-2">
				Pointed Cards
			</p>
			<div v-if="highlander.pointedCards.length > 0" class="flex flex-col gap-2">
				<div v-for="card in highlander.pointedCards" :key="card.name" class="flex items-center gap-3 text-sm">
					<UBadge
						color="neutral"
						variant="soft"
						size="sm"
						class="min-w-8 shrink-0 justify-center px-2.5 py-1 text-sm font-bold leading-none"
					>
						{{ card.points }}
					</UBadge>
					<CardHoverPreview
						:image-url="getImageUrl(card.name)"
						:alt="card.name"
						:is-active="activePreviewCard === card.name"
						@preview="(open: boolean) => handlePreviewUpdate(card.name, open)"
						@pin="togglePreviewPin(card.name)"
					>
						<div class="flex items-center gap-2 min-w-0">
							<span class="truncate">{{ card.name }}</span>
							<span v-if="formatHighlanderPointedCardNote(card)" class="text-xs text-muted shrink-0">
								{{ formatHighlanderPointedCardNote(card) }}
							</span>
						</div>
					</CardHoverPreview>
				</div>
			</div>
			<p v-else class="text-sm text-muted">
				0 Points
			</p>
		</div>

		<div v-else-if="highlander.pointedCards.length > 0" class="flex flex-wrap gap-1.5" data-testid="highlander-compact-cards">
			<CardHoverPreview
				v-for="card in highlander.pointedCards"
				:key="card.name"
				:image-url="getImageUrl(card.name)"
				:alt="card.name"
				:is-active="activePreviewCard === card.name"
				@preview="(open: boolean) => handlePreviewUpdate(card.name, open)"
				@pin="togglePreviewPin(card.name)"
			>
				<span class="inline-flex items-center gap-1 rounded-full border border-default bg-default px-2 py-1 text-xs leading-none">
					<span class="font-semibold text-primary">{{ card.points }}</span>
					<span>{{ card.name }}</span>
					<span v-if="formatHighlanderPointedCardNote(card)" class="text-muted">
						{{ formatHighlanderPointedCardNote(card) }}
					</span>
				</span>
			</CardHoverPreview>
		</div>

		<UAlert
			v-if="!props.compact && highlander.status === 'unknown'"
			color="warning"
			variant="subtle"
			icon="i-lucide-triangle-alert"
			title="7 Point Highlander status is unavailable until decklists are refreshed. Refresh decklists to populate 7 Point Highlander data."
		>
			<template #description>
				<div class="flex flex-col gap-2 text-sm">
					<p v-if="highlander.unknownCards.length > 0">
						Unresolved cards: {{ highlander.unknownCards.map(card => card.name).join(', ') }}
					</p>
					<UButton
						v-if="syncPath"
						:to="syncPath"
						color="warning"
						variant="outline"
						class="self-start"
					>
						Open Sync
					</UButton>
				</div>
			</template>
		</UAlert>

		<UAlert
			v-if="!props.compact && highlander.status === 'illegal'"
			color="error"
			variant="subtle"
			icon="i-lucide-triangle-alert"
			:title="`Illegal: ${formatHighlanderIssueSummary(highlander)}`"
		>
			<template #description>
				<div class="flex flex-col gap-2 text-sm">
					<p v-if="highlander.duplicateCards.length > 0">
						Singleton violations: {{ highlander.duplicateCards.map(card => `${card.name} (${card.quantity})`).join(', ') }}
					</p>
					<p v-if="highlander.maxPoints != null && highlander.points > highlander.maxPoints">
						Points cap exceeded: {{ highlander.points }}/{{ highlander.maxPoints }} Points
					</p>
				</div>
			</template>
		</UAlert>
	</div>
</template>
