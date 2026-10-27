<script setup lang="ts">
import type { ThemeAsset, ThemeAssetKind } from '~~/shared/modules/theme';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';

// An asset token: one exact Graphic Asset Revision of a kind the token admits,
// or none. The Theme or Screen storing it holds the revision as a Graphic Asset
// Reference, which protects it from retire and trash (ADR-0050).

const props = defineProps<{
	modelValue: ThemeAsset | null;
	label: string;
	/** The kinds of Graphic Asset this token may name. */
	assetKinds?: readonly ThemeAssetKind[];
	/** The Event whose adopted assets the picker offers first, if any. */
	eventId?: number;
}>();

const emit = defineEmits<{
	commit: [value: ThemeAsset | null];
}>();

const kinds = computed(() => [...(props.assetKinds ?? ['image'])]);
const reference = computed<GraphicAssetReference | undefined>(() => props.modelValue
	? { assetId: props.modelValue.assetId, revisionId: props.modelValue.revisionId }
	: undefined);

function select(asset: GraphicAsset, selected: GraphicAssetReference) {
	emit('commit', { kind: asset.kind, assetId: selected.assetId, revisionId: selected.revisionId });
}

/** Only the picker's Clear arrives here: a choice also fires `select`, which is the commit. */
function clear(next: GraphicAssetReference | undefined) {
	if (next === undefined && props.modelValue)
		emit('commit', null);
}
</script>

<template>
	<div data-token-part="asset" :data-asset-kind="modelValue?.kind ?? 'none'">
		<GraphicsAssetFocusPicker
			:model-value="reference"
			:event-id="eventId"
			:field-label="label"
			:asset-kind="kinds"
			@select="select"
			@update:model-value="clear"
		/>
	</div>
</template>
