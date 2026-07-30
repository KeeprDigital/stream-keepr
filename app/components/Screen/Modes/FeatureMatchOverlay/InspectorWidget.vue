<script setup lang="ts">
import type { FeatureMatchGraphicItemDefinitionConfig, FeatureMatchOverlayModeConfig, FeatureMatchSpecificGraphicItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { featureMatchOverlayGraphicItemDefinition } from '~/modules/feature-match-overlay/graphicItemDefinitions';
import { appearanceSummary, FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_KIND_OPTIONS, graphicItemSummary, graphicItemTypeLabel, rectSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayGeometryFields from './GeometryFields.vue';
import FeatureMatchOverlayOrderSection from './OrderSection.vue';
import FeatureMatchOverlayGraphicItemEditor from './WidgetEditor.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	eventId: number;
	item: FeatureMatchSpecificGraphicItemConfig;
}>();

const emit = defineEmits<{
	removed: [];
}>();

const editor = useFeatureMatchOverlayConfigEditor({
	config: toRef(props, 'config'),
	updateConfig: props.updateConfig,
	screenWidth: toRef(props, 'screenWidth'),
	screenHeight: toRef(props, 'screenHeight'),
});

const anchorValue = computed<FeatureMatchOverlayAnchorValue>(() => props.item.anchor ?? 'top-left');

function removeSelf() {
	editor.removeItem(props.item.id);
	emit('removed');
}

function replaceGraphicItemType(type: FeatureMatchGraphicItemDefinitionConfig['type']) {
	editor.updateItem(props.item.id, { graphicItem: featureMatchOverlayGraphicItemDefinition(type).defaultConfig() });
}
</script>

<template>
	<div class="min-w-0">
		<FeatureMatchOverlayControlSection
			title="Details"
			default-open
			:badge="graphicItemTypeLabel(item.graphicItem.type)"
			:summary="item.label"
		>
			<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
				<UFormField label="Name">
					<UInput
						:model-value="item.label"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateItem(item.id, { label: String($event) })"
					/>
				</UFormField>
				<ScreenSettingsToggle
					label="Visible"
					:model-value="item.visible"
					@update:model-value="editor.updateItem(item.id, { visible: $event })"
				/>
				<UButton
					color="error"
					variant="soft"
					icon="i-lucide-trash-2"
					aria-label="Remove layer"
					title="Remove layer"
					@click="removeSelf"
				/>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Bounds"
			:summary="rectSummary(item)"
			default-open
		>
			<FeatureMatchOverlayGeometryFields
				:rect="anchorFeatureMatchOverlayRect(item, anchorValue)"
				:screen-width="screenWidth"
				:screen-height="screenHeight"
				:anchor-value="anchorValue"
				@update-anchor="value => editor.updateItem(item.id, { anchor: value as FeatureMatchOverlayAnchorValue })"
				@update="(field, value, unit) => editor.updateItemRectFromAnchor(item.id, field, value, unit)"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Content"
			:summary="graphicItemSummary(item.graphicItem)"
		>
			<div class="space-y-3">
				<UFormField label="Graphic Item type">
					<USelect
						:model-value="item.graphicItem.type"
						:items="FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_KIND_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						@update:model-value="replaceGraphicItemType($event as FeatureMatchGraphicItemDefinitionConfig['type'])"
					/>
				</UFormField>
				<FeatureMatchOverlayGraphicItemEditor
					:graphic-item="item.graphicItem"
					:graphic-item-surface-style="item.surfaceStyle"
					:event-id="eventId"
					@update="graphicItem => editor.updateItem(item.id, { graphicItem: { ...item.graphicItem, ...graphicItem } as FeatureMatchGraphicItemDefinitionConfig })"
				/>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Appearance"
			:summary="appearanceSummary(item.surfaceStyle)"
		>
			<FeatureMatchOverlayBoxStyleFields
				:box-style="item.surfaceStyle"
				include-border
				include-padding
				include-overflow
				@update="updates => editor.updateItemSurfaceStyle(item.id, updates)"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayOrderSection
			@send-to-back="editor.sendItemToBack(item.id)"
			@move="delta => editor.moveItemOrder(item.id, delta)"
			@bring-to-front="editor.bringItemToFront(item.id)"
		/>
	</div>
</template>
