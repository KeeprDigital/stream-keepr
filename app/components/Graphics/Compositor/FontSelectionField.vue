<script setup lang="ts">
import type { GraphicApplicationFontId } from '~~/shared/modules/graphics';
import type { GraphicFontSelection } from '~~/shared/types/graphics';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { GRAPHIC_FONT_OPTIONS } from '~~/shared/modules/graphics';

/**
 * The property controls for one Graphic Font Selection: which arm it is on, and the
 * font that arm names.
 *
 * One component rather than one block per place a font is chosen, because a Text
 * Graphic Item's base typography and each of its Graphic Placeholder Styles offer the
 * same choice — an application font that ships with Stream Keepr, or one exact font
 * Graphic Asset Revision from the Graphics Asset Library, pinned exactly as a Media
 * Graphic Item pins content so it reaches the Screen's reference index and its Screen
 * Output Asset Capability through the same walk.
 *
 * What differs between the two is not the choice but what naming no font means, which
 * is `optional` and nothing else. So this reports *what the author chose* and leaves
 * the caller to say *what to do with it*: a `GraphicTypography` must name a font, so
 * its caller falls back to the application default, while a Graphic Placeholder Style
 * need not, so its caller removes the key instead. Neither policy belongs here.
 */
const props = defineProps<{
	/**
	 * The arm the author is on, which the caller owns rather than this control.
	 *
	 * It is not derivable from `font` alone: an author who has chosen "Library font"
	 * has not yet pinned a revision, and a Graphic Font Selection cannot express that
	 * — writing the asset arm at that moment would store a font that is nothing, which
	 * `graphicFontSelectionSchema` refuses on the way in. So the caller holds the arm
	 * until the picker pins one, and holds it where it can also clear it when the
	 * selection moves and this control would otherwise describe the previous item.
	 */
	source: 'base' | GraphicFontSelection['kind'];
	/** What the owner currently stores, which is absent while the arm is unstored. */
	font: GraphicFontSelection | undefined;
	/**
	 * Whether naming no font is an answer here.
	 *
	 * A Graphic Placeholder Style's font is optional, so "same as base" is a real third
	 * answer; a Text Graphic Item's base typography must name one, so it has two. That
	 * is also what decides the labelling: with three answers the control itself is the
	 * font and its application arm has to say "Application font" to be told apart from
	 * the first answer, while with two the control is the source and its arm is just
	 * the font.
	 */
	optional?: boolean;
	/** The Event whose Graphic Asset associations organise the picker's discovery. */
	eventId: number;
	/** What the picker calls the field it is pinning a revision for. */
	fieldLabel: string;
	size: 'sm' | 'xs';
	/** Distinguishes this control's fields from the other font control on the panel. */
	testIdPrefix: string;
}>();

const emit = defineEmits<{
	'update:source': [source: 'base' | GraphicFontSelection['kind']];
	/** The author picked an application font. */
	'application': [fontId: GraphicApplicationFontId];
	/** The picker pinned one exact font Graphic Asset Revision. */
	'select': [asset: GraphicAsset, reference: GraphicAssetReference];
	/** The picker let go of the revision it had pinned. */
	'clear': [];
}>();

const SOURCE_OPTIONS = computed(() => [
	...(props.optional ? [{ label: 'Same as base', value: 'base' }] : []),
	{ label: 'Application font', value: 'application' },
	{ label: 'Library font', value: 'asset' },
]);

const applicationFontId = computed(() =>
	props.font?.kind === 'application' ? props.font.fontId : undefined,
);

const assetReference = computed(() =>
	props.font?.kind === 'asset' ? props.font.reference : undefined,
);
</script>

<template>
	<UFormField :label="optional ? 'Font' : 'Font source'" :size="size">
		<USelect
			:model-value="source"
			:items="SOURCE_OPTIONS"
			value-key="value"
			size="sm"
			class="w-full"
			:data-testid="`${testIdPrefix}-font-source`"
			@update:model-value="emit('update:source', $event as 'base' | GraphicFontSelection['kind'])"
		/>
	</UFormField>

	<UFormField
		v-if="source === 'application'"
		:label="optional ? 'Application font' : 'Font'"
		:size="size"
	>
		<USelect
			:model-value="applicationFontId"
			:items="GRAPHIC_FONT_OPTIONS"
			value-key="value"
			size="sm"
			class="w-full"
			:data-testid="`${testIdPrefix}-font`"
			@update:model-value="emit('application', $event as GraphicApplicationFontId)"
		/>
	</UFormField>

	<UFormField v-else-if="source === 'asset'" label="Library font" :size="size">
		<GraphicsAssetFocusPicker
			:model-value="assetReference"
			:event-id="eventId"
			:field-label="fieldLabel"
			asset-kind="font"
			@update:model-value="$event ? undefined : emit('clear')"
			@select="(asset: GraphicAsset, reference: GraphicAssetReference) => emit('select', asset, reference)"
		/>
	</UFormField>
</template>
