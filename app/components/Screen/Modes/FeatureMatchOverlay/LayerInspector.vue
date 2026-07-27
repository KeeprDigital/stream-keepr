<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater, FeatureMatchOverlayLayerKind } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlaySelectionTarget } from '~/types';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { childSummary, itemSummary, layerIcon, layerTypeLabel, widgetIcon, widgetTypeLabel } from '~/modules/feature-match-overlay/layerSummaries';
import { featureMatchOverlaySelectionKey, resolveFeatureMatchOverlaySelection } from '~/modules/feature-match-overlay/selection';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayFrameStyleCard from './FrameStyleCard.vue';
import FeatureMatchOverlayInspectorGroup from './InspectorGroup.vue';
import FeatureMatchOverlayInspectorGroupChild from './InspectorGroupChild.vue';
import FeatureMatchOverlayInspectorSource from './InspectorSource.vue';
import FeatureMatchOverlayInspectorWidget from './InspectorWidget.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	eventId: number;
	selectedTarget: FeatureMatchOverlaySelectionTarget;
	variant: 'tree' | 'inspector';
}>();

const emit = defineEmits<{
	'update:selectedTarget': [target: FeatureMatchOverlaySelectionTarget];
}>();

const expandedGroups = ref<Record<string, boolean>>({});
const treeNodeRefs = ref<Record<string, HTMLElement>>({});

const LAYER_KIND_OPTIONS = [
	{ label: 'Source', value: 'source', icon: 'i-lucide-video' },
	{ label: 'Text', value: 'text-widget', icon: 'i-lucide-type' },
	{ label: 'Image', value: 'image-widget', icon: 'i-lucide-image' },
	{ label: 'Clock', value: 'clock-widget', icon: 'i-lucide-clock' },
	{ label: 'Player Life', value: 'life-widget', icon: 'i-lucide-heart-pulse' },
	{ label: 'Game Wins', value: 'wins-widget', icon: 'i-lucide-trophy' },
	{ label: 'Group', value: 'widget-group', icon: 'i-lucide-group' },
];

const { createLayoutItem, patchFrame } = useFeatureMatchOverlayConfigEditor({
	config: toRef(props, 'config'),
	updateConfig: props.updateConfig,
	screenWidth: toRef(props, 'screenWidth'),
	screenHeight: toRef(props, 'screenHeight'),
});

/** The selection target resolved against the Feature Match Layout. */
const selection = computed(() => resolveFeatureMatchOverlaySelection(props.config.layout, props.selectedTarget));

watch(() => props.selectedTarget, () => {
	scrollSelectedTreeNodeIntoView();
}, { immediate: true });

watch(() => props.config.layout.items, (items) => {
	const target = props.selectedTarget;
	if (target.type !== 'canvas' && !items.some(item => item.id === target.itemId))
		selectCanvas();
}, { deep: false });

function selectCanvas() {
	emit('update:selectedTarget', { type: 'canvas' });
}

function selectLayer(itemId: string) {
	emit('update:selectedTarget', { type: 'layer', itemId });
}

function selectWidget(itemId: string, childId: string) {
	emit('update:selectedTarget', { type: 'widget', itemId, childId });
}

function addLayoutItem(kind: string) {
	const id = createLayoutItem(kind as FeatureMatchOverlayLayerKind);
	selectLayer(id);
}

function onChildAdded(groupId: string, childId: string) {
	expandedGroups.value = { ...expandedGroups.value, [groupId]: true };
	selectWidget(groupId, childId);
}

function onChildRemoved(groupId: string) {
	selectLayer(groupId);
}

function toggleGroupExpanded(groupId: string) {
	expandedGroups.value = { ...expandedGroups.value, [groupId]: !(expandedGroups.value[groupId] ?? true) };
}

function isGroupExpanded(groupId: string) {
	return expandedGroups.value[groupId] ?? true;
}

function layerTreeKey(itemId: string) {
	return `layer:${itemId}`;
}

function widgetTreeKey(itemId: string, childId: string) {
	return `widget:${itemId}:${childId}`;
}

function setTreeNodeRef(key: string, element: unknown) {
	if (element instanceof HTMLElement)
		treeNodeRefs.value[key] = element;
	else
		delete treeNodeRefs.value[key];
}

function scrollSelectedTreeNodeIntoView() {
	if (props.variant === 'inspector')
		return;

	void nextTick(() => {
		treeNodeRefs.value[featureMatchOverlaySelectionKey(props.selectedTarget)]?.scrollIntoView({
			block: 'nearest',
			behavior: 'smooth',
		});
	});
}

const selectedInspectorHeader = computed(() => {
	const current = selection.value;

	if (current.kind === 'canvas') {
		return {
			icon: 'i-lucide-panels-top-left',
			label: 'Canvas',
			badge: 'Frame',
			summary: `${props.screenWidth}x${props.screenHeight} frame and background`,
			visible: true,
		};
	}

	if (current.kind === 'child') {
		return {
			icon: widgetIcon(current.child.widget.type),
			label: current.child.label,
			badge: widgetTypeLabel(current.child.widget.type),
			summary: `${current.group.label} • ${childSummary(current.child)}`,
			visible: current.child.visible !== false,
		};
	}

	if (current.kind !== 'missing') {
		return {
			icon: layerIcon(current.item),
			label: current.item.label,
			badge: layerTypeLabel(current.item),
			summary: itemSummary(current.item),
			visible: current.item.visible !== false,
		};
	}

	return {
		icon: 'i-lucide-circle-help',
		label: 'Selection unavailable',
		badge: 'Missing',
		summary: 'Choose another layer or widget',
		visible: false,
	};
});
</script>

<template>
	<div class="contents">
		<div class="contents">
			<aside v-if="variant !== 'inspector'" class="space-y-4">
				<section class="rounded-lg border border-default/70 bg-default p-3">
					<div class="flex items-center justify-between gap-3">
						<div>
							<p class="text-sm font-semibold">
								Scene
							</p>
							<p class="text-xs text-muted">
								Canvas, layers, and widgets
							</p>
						</div>
						<UBadge variant="soft">
							{{ config.layout.items.length }} layers
						</UBadge>
					</div>
				</section>

				<UFormField label="Guided Add">
					<USelect
						:items="LAYER_KIND_OPTIONS"
						value-key="value"
						placeholder="Add layer..."
						class="w-full"
						data-testid="overlay-guided-add"
						@update:model-value="addLayoutItem(String($event))"
					/>
				</UFormField>

				<div class="space-y-1.5">
					<button
						:ref="element => setTreeNodeRef('canvas', element)"
						type="button"
						class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
						:class="selectedTarget.type === 'canvas' ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/20 hover:bg-muted/40'"
						data-testid="overlay-tree-canvas"
						@click="selectCanvas"
					>
						<UIcon name="i-lucide-panels-top-left" class="mt-0.5 size-4 shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">Canvas</span>
							<span class="mt-0.5 block truncate text-xs text-muted">{{ screenWidth }}x{{ screenHeight }} frame and background</span>
						</span>
					</button>

					<div v-for="item in config.layout.items" :key="item.id" class="space-y-1">
						<div class="flex gap-1">
							<button
								v-if="item.type === 'widget-group'"
								type="button"
								class="mt-2 size-7 shrink-0 rounded-md hover:bg-muted"
								:aria-label="isGroupExpanded(item.id) ? 'Collapse group' : 'Expand group'"
								@click="toggleGroupExpanded(item.id)"
							>
								<UIcon name="i-lucide-chevron-right" class="mx-auto size-4 transition-transform" :class="{ 'rotate-90': isGroupExpanded(item.id) }" />
							</button>
							<div v-else class="w-8 shrink-0" />
							<button
								:ref="element => setTreeNodeRef(layerTreeKey(item.id), element)"
								type="button"
								class="flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-3 text-left transition"
								:class="selectedTarget.type === 'layer' && selectedTarget.itemId === item.id ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/20 hover:bg-muted/40'"
								data-testid="overlay-tree-layer"
								@click="selectLayer(item.id)"
							>
								<UIcon :name="layerIcon(item)" class="mt-0.5 size-4 shrink-0 text-muted" />
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2">
										<span class="truncate text-sm font-medium">{{ item.label }}</span>
										<UBadge size="xs" variant="soft" class="shrink-0">{{ layerTypeLabel(item) }}</UBadge>
									</span>
									<span class="mt-0.5 block truncate text-xs text-muted">{{ itemSummary(item) }}</span>
								</span>
								<UIcon :name="item.visible === false ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="mt-0.5 size-4 shrink-0 text-muted" />
							</button>
						</div>

						<div v-if="item.type === 'widget-group' && isGroupExpanded(item.id)" class="ml-12 space-y-1.5">
							<button
								v-for="child in item.children"
								:key="child.id"
								:ref="element => setTreeNodeRef(widgetTreeKey(item.id, child.id), element)"
								type="button"
								class="flex w-full items-start gap-2 rounded-lg border p-2 text-left transition"
								:class="selectedTarget.type === 'widget' && selectedTarget.childId === child.id ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/10 hover:bg-muted/30'"
								data-testid="overlay-tree-widget"
								@click="selectWidget(item.id, child.id)"
							>
								<UIcon :name="widgetIcon(child.widget.type)" class="mt-0.5 size-4 shrink-0 text-muted" />
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2">
										<span class="truncate text-sm font-medium">{{ child.label }}</span>
										<UBadge size="xs" variant="soft">{{ widgetTypeLabel(child.widget.type) }}</UBadge>
									</span>
									<span class="mt-0.5 block truncate text-xs text-muted">{{ childSummary(child) }}</span>
								</span>
							</button>
						</div>
					</div>
				</div>
			</aside>

			<section v-if="variant !== 'tree'" class="min-w-0">
				<div class="mb-3 border-b border-default/70 pb-3">
					<div class="flex min-w-0 items-start gap-3">
						<UIcon :name="selectedInspectorHeader.icon" class="mt-0.5 size-5 shrink-0 text-muted" />
						<div class="min-w-0 flex-1">
							<div class="flex min-w-0 flex-wrap items-center gap-2">
								<p class="truncate text-sm font-semibold">
									{{ selectedInspectorHeader.label }}
								</p>
								<UBadge size="xs" variant="soft">
									{{ selectedInspectorHeader.badge }}
								</UBadge>
							</div>
							<p class="mt-0.5 truncate text-xs text-muted">
								{{ selectedInspectorHeader.summary }}
							</p>
						</div>
						<UIcon
							:name="selectedInspectorHeader.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'"
							class="mt-0.5 size-4 shrink-0 text-muted"
						/>
					</div>
				</div>

				<div v-if="selection.kind === 'canvas'" class="min-w-0">
					<FeatureMatchOverlayControlSection
						title="Canvas"
						default-open
						badge="Frame"
						:summary="`${screenWidth}x${screenHeight}`"
					>
						<FeatureMatchOverlayFrameStyleCard
							:config="config"
							:patch-frame="patchFrame"
							:event-id="eventId"
						/>
					</FeatureMatchOverlayControlSection>
				</div>

				<FeatureMatchOverlayInspectorGroupChild
					v-else-if="selection.kind === 'child'"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:event-id="eventId"
					:group="selection.group"
					:child="selection.child"
					@removed="onChildRemoved(selection.group.id)"
				/>

				<FeatureMatchOverlayInspectorSource
					v-else-if="selection.kind === 'source'"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:item="selection.item"
					@removed="selectCanvas"
				/>

				<FeatureMatchOverlayInspectorWidget
					v-else-if="selection.kind === 'widget'"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:event-id="eventId"
					:item="selection.item"
					@removed="selectCanvas"
				/>

				<FeatureMatchOverlayInspectorGroup
					v-else-if="selection.kind === 'group'"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:item="selection.item"
					@removed="selectCanvas"
					@child-added="childId => selection.kind === 'group' && onChildAdded(selection.item.id, childId)"
				/>
			</section>
		</div>
	</div>
</template>
