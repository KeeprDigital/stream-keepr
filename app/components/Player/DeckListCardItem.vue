<script setup lang="ts">
import type { DeckListCard } from '~~/shared/types/deckList';

const props = defineProps<{
	card: DeckListCard;
	imageUrl: string | null;
	isActive: boolean;
	showQuantity?: boolean;
	previewKey?: string;
	/** Whether this card is marked as a key card */
	keyCard?: boolean;
	/** Whether click-to-select key card mode is enabled */
	selectable?: boolean;
}>();

const emit = defineEmits<{
	(e: 'preview', cardKey: string, open: boolean): void;
	(e: 'pin', cardKey: string): void;
	(e: 'toggleKeyCard'): void;
}>();

const cardKey = computed(() => props.previewKey ?? `${props.card.compartment}-${props.card.name}`);

function handleClick() {
	if (props.selectable) {
		emit('toggleKeyCard');
	}
}
</script>

<template>
	<li>
		<CardHoverPreview
			:image-url="imageUrl"
			:alt="card.name"
			:is-active="isActive"
			@preview="(open: boolean) => emit('preview', cardKey, open)"
			@pin="emit('pin', cardKey)"
		>
			<span
				class="flex items-center gap-2 text-sm rounded px-1 -mx-1 transition-colors"
				:class="[
					keyCard
						? 'bg-primary/10 text-primary'
						: isActive
							? 'bg-elevated'
							: 'hover:bg-elevated/50',
					selectable ? 'cursor-pointer' : '',
				]"
				:role="selectable ? 'checkbox' : undefined"
				:tabindex="selectable ? 0 : undefined"
				:aria-checked="selectable ? keyCard : undefined"
				:aria-label="selectable ? (keyCard ? `Remove ${card.name} from key cards` : `Add ${card.name} to key cards`) : undefined"
				@click.stop="handleClick"
				@keydown.enter.stop="handleClick"
				@keydown.space.prevent.stop="handleClick"
			>
				<span v-if="showQuantity !== false" class="font-mono w-5 text-center shrink-0 text-muted">{{ card.quantity }}</span>
				<span>{{ card.name }}</span>
				<UBadge
					v-if="card.highlanderPoints"
					color="neutral"
					variant="soft"
					size="sm"
					class="min-w-7 justify-center px-2 py-0.5 text-sm font-bold leading-none"
				>
					{{ card.highlanderPoints }}
				</UBadge>
			</span>
		</CardHoverPreview>
	</li>
</template>
