<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig, FeatureMatchWidgetConfig, FeatureMatchWidgetGroupChildConfig, FeatureMatchWidgetGroupItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { childAppearanceBadge, childAppearanceSummary, childSummary, FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS, hasStyleOverrides, widgetIcon, widgetSummary, widgetTypeLabel } from '~/modules/feature-match-overlay/layerSummaries';
import { featureMatchOverlayWidgetDefinition } from '~/modules/feature-match-overlay/widgetDefinitions';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayGeometryFields from './GeometryFields.vue';
import FeatureMatchOverlayWidgetEditor from './WidgetEditor.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	eventId: number;
	group: FeatureMatchWidgetGroupItemConfig;
	child: FeatureMatchWidgetGroupChildConfig;
}>();

const emit = defineEmits<{
	removed: [];
}>();

const CHILD_SIZING_OPTIONS = [
	{ label: 'Fixed', value: 'fixed' },
	{ label: 'Content', value: 'content' },
	{ label: 'Fill', value: 'fill' },
];

const GROUP_ALIGN_OPTIONS = [
	{ label: 'Start', value: 'start' },
	{ label: 'Center', value: 'center' },
	{ label: 'End', value: 'end' },
	{ label: 'Stretch', value: 'stretch' },
];

const editor = useFeatureMatchOverlayConfigEditor({
	config: toRef(props, 'config'),
	updateConfig: props.updateConfig,
	screenWidth: toRef(props, 'screenWidth'),
	screenHeight: toRef(props, 'screenHeight'),
});

const childAnchorValue = computed<FeatureMatchOverlayAnchorValue>(() =>
	props.child.layout.mode === 'canvas' ? props.child.layout.anchor ?? 'top-left' : 'top-left');

const resolvedSurfaceStyle = computed(() => ({
	...(props.group.defaultChildSurfaceStyle ?? {}),
	...(props.child.surfaceStyle ?? {}),
}));

function removeSelf() {
	editor.removeGroupChild(props.group.id, props.child.id);
	emit('removed');
}

function replaceWidgetType(type: FeatureMatchWidgetConfig['type']) {
	editor.updateGroupChild(props.group.id, props.child.id, { widget: featureMatchOverlayWidgetDefinition(type).defaultConfig() });
}

function resetSurfaceStyle() {
	editor.updateGroup(props.group.id, {
		children: props.group.children.map((child) => {
			if (child.id !== props.child.id)
				return child;
			const { surfaceStyle: _surfaceStyle, ...childWithoutSurfaceStyle } = child;
			return childWithoutSurfaceStyle;
		}),
	});
}
</script>

<template>
	<div class="min-w-0">
		<div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted">
			<UIcon :name="widgetIcon(child.widget.type)" class="size-3.5" />
			<span>Widget</span>
		</div>

		<FeatureMatchOverlayControlSection
			title="Details"
			:badge="widgetTypeLabel(child.widget.type)"
			:summary="child.label"
		>
			<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
				<UFormField label="Name">
					<UInput
						:model-value="child.label"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { label: String($event) })"
					/>
				</UFormField>
				<ScreenSettingsToggle
					label="Visible"
					:model-value="child.visible"
					@update:model-value="editor.updateGroupChild(group.id, child.id, { visible: $event })"
				/>
				<UButton
					color="error"
					variant="soft"
					icon="i-lucide-trash-2"
					aria-label="Remove widget"
					title="Remove widget"
					@click="removeSelf"
				/>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Layout"
			:summary="childSummary(child)"
		>
			<FeatureMatchOverlayGeometryFields
				v-if="child.layout.mode === 'canvas'"
				:rect="anchorFeatureMatchOverlayRect(child.layout, childAnchorValue)"
				:screen-width="group.width"
				:screen-height="group.height"
				:anchor-value="childAnchorValue"
				@update-anchor="value => child.layout.mode === 'canvas' && editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, anchor: value as FeatureMatchOverlayAnchorValue } })"
				@update="(field, value, unit) => editor.updateGroupChildRectFromAnchor(group.id, child.id, field, value, unit)"
			/>

			<div v-else class="grid gap-3 md:grid-cols-3">
				<UFormField label="Sizing">
					<USelect
						:model-value="child.layout.sizing.mode"
						:items="CHILD_SIZING_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, sizing: { ...child.layout.sizing, mode: $event as any } } })"
					/>
				</UFormField>
				<UFormField label="Size">
					<UInputNumber
						:model-value="child.layout.sizing.size ?? 180"
						size="sm"
						class="w-full"
						:disabled="child.layout.sizing.mode !== 'fixed'"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, sizing: { ...child.layout.sizing, mode: 'fixed', size: Number($event) } } })"
					/>
				</UFormField>
				<UFormField label="Weight">
					<UInputNumber
						:model-value="child.layout.sizing.weight ?? 1"
						size="sm"
						class="w-full"
						:disabled="child.layout.sizing.mode !== 'fill'"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, sizing: { ...child.layout.sizing, mode: 'fill', weight: Number($event) } } })"
					/>
				</UFormField>
				<UFormField label="Min">
					<UInputNumber
						:model-value="child.layout.sizing.min ?? 0"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, sizing: { ...child.layout.sizing, min: Number($event) } } })"
					/>
				</UFormField>
				<UFormField label="Max">
					<UInputNumber
						:model-value="child.layout.sizing.max"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, sizing: { ...child.layout.sizing, max: $event == null ? undefined : Number($event) } } })"
					/>
				</UFormField>
				<UFormField label="Align Self">
					<USelect
						:model-value="child.layout.alignSelf"
						:items="GROUP_ALIGN_OPTIONS"
						value-key="value"
						placeholder="Group align"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateGroupChild(group.id, child.id, { layout: { ...child.layout, alignSelf: $event as any } })"
					/>
				</UFormField>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Content"
			:summary="widgetSummary(child.widget)"
		>
			<div class="space-y-3">
				<UFormField label="Widget type">
					<USelect
						:model-value="child.widget.type"
						:items="FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						@update:model-value="replaceWidgetType($event as FeatureMatchWidgetConfig['type'])"
					/>
				</UFormField>
				<FeatureMatchOverlayWidgetEditor
					:widget="child.widget"
					:widget-surface-style="resolvedSurfaceStyle"
					:event-id="eventId"
					@update="widget => editor.updateGroupChildWidget(group.id, child.id, widget)"
				/>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Overrides"
			:badge="childAppearanceBadge(child)"
			:summary="childAppearanceSummary(child)"
		>
			<div class="space-y-3">
				<div class="flex justify-end">
					<UButton
						size="xs"
						variant="soft"
						icon="i-lucide-rotate-ccw"
						:disabled="!hasStyleOverrides(child.surfaceStyle)"
						data-testid="reset-widget-appearance"
						@click="resetSurfaceStyle"
					>
						Reset to Defaults
					</UButton>
				</div>
				<FeatureMatchOverlayBoxStyleFields
					:box-style="child.surfaceStyle"
					:fallback-style="group.defaultChildSurfaceStyle"
					include-border
					include-padding
					include-overflow
					@update="updates => editor.updateGroupChildSurfaceStyle(group.id, child.id, updates)"
				/>
			</div>
		</FeatureMatchOverlayControlSection>
	</div>
</template>
