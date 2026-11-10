<script setup lang="ts">
import type { EventCanvas } from '~~/shared/eventCanvas';
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { CARD_ASPECT } from '~~/shared/utils/cardGrid';

/**
 * A card grid's Card Layout settings (ADR-0054), in one order: alignment, max
 * card size, stack reveal, columns and gap. Columns, max card size and gap are
 * each a number or Auto: an emptied field is Auto, and emits the `null` that
 * deletes its key. Labels and bounds come from `fields`, a mode's flat fields
 * or a board's layout block view, narrowed to the grid's content: columns to
 * `cardCount`, max card size to the largest card that fits `canvas`. Each edit
 * is emitted as the patch naming its layout key. Alignment and stack reveal
 * show only where `show` asks for them.
 *
 * In `view` `stack` the cards overlap in one column, so it has no columns or gap.
 */
interface CardLayout {
	columns?: number;
	maxCardSize?: number;
	cardGap?: number;
	alignment?: NinePoint;
	stackReveal?: number;
}

type CardLayoutKey = keyof CardLayout;
/** The values that are Auto while absent. */
type AutoKey = 'columns' | 'maxCardSize' | 'cardGap';

type CardLayoutPatch = {
	[K in CardLayoutKey]?: K extends AutoKey ? number | null : CardLayout[K];
};

const props = withDefaults(defineProps<{
	layout: CardLayout;
	fields: {
		columns: ScreenModeConfigField;
		maxCardSize: ScreenModeConfigField;
		cardGap: ScreenModeConfigField;
		alignment?: ScreenModeConfigField;
		stackReveal?: ScreenModeConfigField;
	};
	/** The most cards the grid holds: the most columns it can have. */
	cardCount?: number;
	/** The Event Canvas the grid is rendered in: no card is larger. */
	canvas?: EventCanvas;
	show?: { alignment?: boolean; stackReveal?: boolean };
	/** Each field's description in the mode's own words, over the defaults. */
	descriptions?: Partial<Record<CardLayoutKey, string>>;
	/** The grid's name, naming its alignment picker. */
	gridName?: string;
	/** How the cards are laid out: a grid, or a stack of overlapping cards. */
	view?: 'grid' | 'stack';
}>(), {
	view: 'grid',
	show: () => ({}),
	descriptions: () => ({}),
	gridName: 'Card grid',
});

const emit = defineEmits<{
	update: [patch: CardLayoutPatch];
}>();

const DEFAULT_DESCRIPTIONS: Record<CardLayoutKey, string> = {
	alignment: 'Where the cards sit when they don\'t fill their space.',
	maxCardSize: 'The widest a card may be, in px. Empty is Auto: as large as fits.',
	stackReveal: 'How much of each stacked card but the last shows, in px.',
	columns: 'Cards per row. Empty is Auto: the count that fits the cards largest.',
	cardGap: 'The space between cards in px. Empty is Auto: it follows the card size.',
};

function description(key: CardLayoutKey): string {
	return props.descriptions[key] ?? DEFAULT_DESCRIPTIONS[key];
}

/** The widest card that fits the Event Canvas whole. */
const largestCard = computed(() => props.canvas
	? Math.floor(Math.min(props.canvas.width, props.canvas.height * CARD_ASPECT))
	: undefined);

function write(patch: CardLayoutPatch) {
	emit('update', patch);
}
</script>

<template>
	<ScreenSettingsField
		v-if="show.alignment && fields.alignment && layout.alignment"
		:data-config-field="fields.alignment.key"
		:label="fields.alignment.label"
		:description="description('alignment')"
	>
		<UINinePointPicker
			:model-value="layout.alignment"
			:aria-label="`${gridName} alignment`"
			@update:model-value="write({ alignment: $event })"
		/>
	</ScreenSettingsField>

	<ScreenConfigField
		:field="fields.maxCardSize"
		:model-value="layout.maxCardSize"
		:max="largestCard"
		:description="description('maxCardSize')"
		placeholder="Auto"
		nullable
		@update:model-value="write({ maxCardSize: $event })"
	/>

	<ScreenConfigField
		v-if="show.stackReveal && fields.stackReveal"
		:field="fields.stackReveal"
		:model-value="layout.stackReveal"
		:description="description('stackReveal')"
		@update:model-value="$event !== null && write({ stackReveal: $event })"
	/>

	<template v-if="view === 'grid'">
		<ScreenConfigField
			:field="fields.columns"
			:model-value="layout.columns"
			:max="cardCount"
			:description="description('columns')"
			placeholder="Auto"
			nullable
			@update:model-value="write({ columns: $event })"
		/>

		<ScreenConfigField
			:field="fields.cardGap"
			:model-value="layout.cardGap"
			:description="description('cardGap')"
			placeholder="Auto"
			nullable
			@update:model-value="write({ cardGap: $event })"
		/>
	</template>
</template>
