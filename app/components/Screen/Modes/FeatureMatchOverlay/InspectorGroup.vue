<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig, FeatureMatchWidgetConfig, FeatureMatchWidgetGroupItemConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { appearanceSummary, FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS, groupLayoutSummary, groupWidgetDefaultsSummary, rectSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayGeometryFields from './GeometryFields.vue';
import FeatureMatchOverlayOrderSection from './OrderSection.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	item: FeatureMatchWidgetGroupItemConfig;
}>();

const emit = defineEmits<{
	removed: [];
	childAdded: [childId: string];
}>();

const GROUP_ARRANGEMENT_OPTIONS = [
	{ label: 'Row', value: 'row' },
	{ label: 'Column', value: 'column' },
	{ label: 'Canvas', value: 'canvas' },
];

const GROUP_ALIGN_OPTIONS = [
	{ label: 'Start', value: 'start' },
	{ label: 'Center', value: 'center' },
	{ label: 'End', value: 'end' },
	{ label: 'Stretch', value: 'stretch' },
];

const GROUP_JUSTIFY_OPTIONS = [
	{ label: 'Start', value: 'start' },
	{ label: 'Center', value: 'center' },
	{ label: 'End', value: 'end' },
	{ label: 'Space Between', value: 'space-between' },
];

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

function addChild(type: FeatureMatchWidgetConfig['type']) {
	const childId = editor.createGroupChild(props.item.id, type);
	if (childId)
		emit('childAdded', childId);
}
</script>

<template>
	<div class="min-w-0">
		<div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted">
			<UIcon name="i-lucide-group" class="size-3.5" />
			<span>Group</span>
		</div>

		<FeatureMatchOverlayControlSection
			title="Details"
			default-open
			badge="Group"
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
			title="Appearance"
			:summary="appearanceSummary(item.surfaceStyle)"
		>
			<FeatureMatchOverlayBoxStyleFields
				:box-style="item.surfaceStyle"
				:include-text="false"
				include-border
				@update="updates => editor.updateGroup(item.id, { surfaceStyle: { ...(item.surfaceStyle ?? {}), ...updates } })"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayOrderSection
			:z-index="item.zIndex ?? 0"
			@send-to-back="editor.sendItemToBack(item.id)"
			@move="delta => editor.moveItemOrder(item.id, delta)"
			@bring-to-front="editor.bringItemToFront(item.id)"
			@update-z-index="zIndex => editor.setItemOrder(item.id, zIndex)"
		/>

		<div class="pt-2 mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted">
			<UIcon name="i-lucide-layout-template" class="size-3.5" />
			<span>Widgets</span>
		</div>

		<FeatureMatchOverlayControlSection
			title="Arrangement"
			:summary="groupLayoutSummary(item)"
		>
			<div class="space-y-4">
				<div class="grid gap-3 md:grid-cols-4">
					<UFormField label="Arrangement">
						<USelect
							:model-value="item.arrangement.mode"
							:items="GROUP_ARRANGEMENT_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="editor.convertGroupArrangement(item.id, $event as 'row' | 'column' | 'canvas')"
						/>
					</UFormField>
					<UFormField label="Padding">
						<UInputNumber
							:model-value="item.arrangement.padding ?? 0"
							size="sm"
							class="w-full"
							@update:model-value="editor.updateGroup(item.id, { arrangement: { ...item.arrangement, padding: Number($event) } })"
						/>
					</UFormField>
					<UFormField label="Gap">
						<UInputNumber
							:model-value="'gap' in item.arrangement ? item.arrangement.gap : 0"
							size="sm"
							class="w-full"
							:disabled="item.arrangement.mode === 'canvas'"
							@update:model-value="editor.updateGroup(item.id, { arrangement: { ...item.arrangement, gap: Number($event) } as any })"
						/>
					</UFormField>
					<UFormField label="Overflow">
						<USelect
							:model-value="item.overflow ?? 'clip'"
							:items="['clip', 'visible']"
							size="sm"
							class="w-full"
							@update:model-value="editor.updateGroup(item.id, { overflow: $event as any })"
						/>
					</UFormField>
				</div>
				<div v-if="item.arrangement.mode !== 'canvas'" class="grid gap-3 md:grid-cols-2">
					<UFormField label="Align">
						<USelect
							:model-value="item.arrangement.align"
							:items="GROUP_ALIGN_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="editor.updateGroup(item.id, { arrangement: { ...item.arrangement, align: $event as any } })"
						/>
					</UFormField>
					<UFormField label="Justify">
						<USelect
							:model-value="item.arrangement.justify"
							:items="GROUP_JUSTIFY_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="editor.updateGroup(item.id, { arrangement: { ...item.arrangement, justify: $event as any } })"
						/>
					</UFormField>
				</div>
				<UFormField label="Add widget">
					<USelect
						:items="FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS"
						value-key="value"
						size="sm"
						placeholder="Add widget..."
						class="w-full"
						data-testid="overlay-guided-add-widget"
						@update:model-value="addChild($event as FeatureMatchWidgetConfig['type'])"
					/>
				</UFormField>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Defaults"
			badge="Inherited"
			:summary="groupWidgetDefaultsSummary(item)"
		>
			<FeatureMatchOverlayBoxStyleFields
				:box-style="item.defaultChildSurfaceStyle"
				include-border
				include-padding
				include-overflow
				@update="updates => editor.updateGroupDefaultChildSurfaceStyle(item.id, updates)"
			/>
		</FeatureMatchOverlayControlSection>
	</div>
</template>
