<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig, FeatureMatchWidgetConfig, FeatureMatchWidgetItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { appearanceSummary, FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS, rectSummary, widgetSummary, widgetTypeLabel } from '~/modules/feature-match-overlay/layerSummaries';
import { featureMatchOverlayWidgetDefinition } from '~/modules/feature-match-overlay/widgetDefinitions';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayGeometryFields from './GeometryFields.vue';
import FeatureMatchOverlayOrderSection from './OrderSection.vue';
import FeatureMatchOverlayWidgetEditor from './WidgetEditor.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	item: FeatureMatchWidgetItemConfig;
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

function replaceWidgetType(type: FeatureMatchWidgetConfig['type']) {
	editor.updateItem(props.item.id, { widget: featureMatchOverlayWidgetDefinition(type).defaultConfig() });
}
</script>

<template>
	<div class="min-w-0">
		<FeatureMatchOverlayControlSection
			title="Details"
			default-open
			:badge="widgetTypeLabel(item.widget.type)"
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
			:summary="widgetSummary(item.widget)"
		>
			<div class="space-y-3">
				<UFormField label="Widget type">
					<USelect
						:model-value="item.widget.type"
						:items="FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						@update:model-value="replaceWidgetType($event as FeatureMatchWidgetConfig['type'])"
					/>
				</UFormField>
				<FeatureMatchOverlayWidgetEditor
					:widget="item.widget"
					:widget-surface-style="item.surfaceStyle"
					@update="widget => editor.updateItem(item.id, { widget: { ...item.widget, ...widget } as FeatureMatchWidgetConfig })"
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
			:z-index="item.zIndex ?? 0"
			@send-to-back="editor.sendItemToBack(item.id)"
			@move="delta => editor.moveItemOrder(item.id, delta)"
			@bring-to-front="editor.bringItemToFront(item.id)"
			@update-z-index="zIndex => editor.setItemOrder(item.id, zIndex)"
		/>
	</div>
</template>
