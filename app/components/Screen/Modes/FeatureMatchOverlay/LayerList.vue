<script setup lang="ts">
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditor } from '~/modules/feature-match-overlay/editorHost';
import type { FeatureMatchLayoutEditorLayer } from '~/modules/feature-match-overlay/editorSelection';
import type { GraphicsLayerListSection } from '~/modules/graphics/editor/host';
import { FEATURE_MATCH_LAYOUT_EDITOR_TREE } from '~/modules/feature-match-overlay/editorHost';

/**
 * The Feature Match Layout's one layer list: every Graphic Item, every Source
 * Item, and the canvas, front to back — the order they composite in — in the
 * shared graphics editor's layer list.
 *
 * The composition is mounted above the Frame and the Source Items as one layer,
 * so Graphic Items always sit in front of Source Items and the canvas is always
 * at the back. Each section reorders within itself; nothing here offers to move a
 * Source Item in front of a Graphic Item, because nothing renders one there.
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	editor: FeatureMatchLayoutEditor;
	canvasWidth: number;
	canvasHeight: number;
}>();

const sections = computed<GraphicsLayerListSection<FeatureMatchLayoutEditorLayer>[]>(() => {
	const layers = FEATURE_MATCH_LAYOUT_EDITOR_TREE.order(props.layout);
	return [
		{
			key: 'items',
			title: 'Graphic Items',
			layers: layers.filter(layer => layer.type === 'item'),
			empty: 'No Graphic Items yet',
		},
		{
			key: 'sources',
			title: 'Sources',
			layers: layers.filter(layer => layer.type === 'source'),
			empty: 'No Source Items yet',
		},
	];
});
</script>

<template>
	<GraphicsLayerList
		:editor="editor"
		:tree="FEATURE_MATCH_LAYOUT_EDITOR_TREE"
		:document="layout"
		:sections="sections"
		:canvas-width="canvasWidth"
		:canvas-height="canvasHeight"
	/>
</template>
