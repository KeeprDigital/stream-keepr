<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { CardSizing } from '~~/shared/types/enums';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { CARD_SIZING_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';

/**
 * A card grid's layout settings, as Deck List's boards and Most Played Cards
 * lay their cards out (ADR-0054), in one order: sizing, alignment, a Fixed
 * card's width, stack reveal, auto columns, the column count while auto
 * columns is off, and gap. Labels and bounds come from `fields`, a mode's flat
 * fields or a board's layout block view; each edit is emitted as the patch
 * naming its layout key. Alignment and stack reveal show only where `show`
 * asks for them.
 */
interface CardGridLayout {
	cardSizing: CardSizing;
	cardWidth: number;
	cardGap: number;
	autoColumns: boolean;
	columns: number;
	alignment?: NinePoint;
	stackReveal?: number;
}

type CardGridLayoutKey = keyof CardGridLayout;

const props = withDefaults(defineProps<{
	layout: CardGridLayout;
	fields: {
		cardSizing: ScreenModeConfigField;
		cardWidth: ScreenModeConfigField;
		cardGap: ScreenModeConfigField;
		autoColumns: ScreenModeConfigField;
		columns: ScreenModeConfigField;
		alignment?: ScreenModeConfigField;
		stackReveal?: ScreenModeConfigField;
	};
	show?: { alignment?: boolean; stackReveal?: boolean };
	/** Each field's description in the mode's own words, over the defaults. */
	descriptions?: Partial<Record<CardGridLayoutKey, string>>;
	/** The grid's name, naming its alignment picker. */
	gridName?: string;
}>(), {
	show: () => ({}),
	descriptions: () => ({}),
	gridName: 'Card grid',
});

const emit = defineEmits<{
	update: [patch: Partial<CardGridLayout>];
}>();

const DEFAULT_DESCRIPTIONS: Record<CardGridLayoutKey, string> = {
	cardSizing: 'Fit shrinks the cards until every one fits the screen. Fixed takes the card width below and may run off the screen.',
	alignment: 'Where the cards sit when they don\'t fill their space.',
	cardWidth: 'Each card\'s width in px.',
	stackReveal: 'How much of each stacked card but the last shows, in px.',
	autoColumns: 'Choose the columns from the card count and the screen\'s size.',
	columns: 'Number of columns in the card grid.',
	cardGap: 'The space between cards in px.',
};

function description(key: CardGridLayoutKey): string {
	return props.descriptions[key] ?? DEFAULT_DESCRIPTIONS[key];
}

function write<K extends CardGridLayoutKey>(key: K, value: CardGridLayout[K] | null) {
	if (value !== null)
		emit('update', { [key]: value } as Partial<CardGridLayout>);
}
</script>

<template>
	<ScreenConfigField
		:field="fields.cardSizing"
		:model-value="layout.cardSizing"
		:items="CARD_SIZING_SELECT_OPTIONS"
		:description="description('cardSizing')"
		@update:model-value="write('cardSizing', $event)"
	/>

	<ScreenSettingsField
		v-if="show.alignment && fields.alignment && layout.alignment"
		:data-config-field="fields.alignment.key"
		:label="fields.alignment.label"
		:description="description('alignment')"
	>
		<UINinePointPicker
			:model-value="layout.alignment"
			:aria-label="`${gridName} alignment`"
			@update:model-value="write('alignment', $event)"
		/>
	</ScreenSettingsField>

	<ScreenConfigField
		v-if="layout.cardSizing === 'fixed'"
		:field="fields.cardWidth"
		:model-value="layout.cardWidth"
		:description="description('cardWidth')"
		@update:model-value="write('cardWidth', $event)"
	/>

	<ScreenConfigField
		v-if="show.stackReveal && fields.stackReveal"
		:field="fields.stackReveal"
		:model-value="layout.stackReveal"
		:description="description('stackReveal')"
		@update:model-value="write('stackReveal', $event)"
	/>

	<ScreenConfigField
		:field="fields.autoColumns"
		:model-value="layout.autoColumns"
		:description="description('autoColumns')"
		@update:model-value="write('autoColumns', $event)"
	/>

	<ScreenConfigField
		v-if="!layout.autoColumns"
		:field="fields.columns"
		:model-value="layout.columns"
		:description="description('columns')"
		@update:model-value="write('columns', $event)"
	/>

	<ScreenConfigField
		:field="fields.cardGap"
		:model-value="layout.cardGap"
		:description="description('cardGap')"
		@update:model-value="write('cardGap', $event)"
	/>
</template>
