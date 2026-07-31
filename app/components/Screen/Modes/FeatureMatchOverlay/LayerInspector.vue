<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlaySelectionTarget } from '~/types';
import {
	FEATURE_MATCH_SOURCE_ITEM_ICON,
	FEATURE_MATCH_SOURCE_ITEM_LABEL,
} from '~~/shared/featureMatchSourceItems';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { sourceSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { featureMatchOverlaySelectionKey, resolveFeatureMatchOverlaySelection } from '~/modules/feature-match-overlay/selection';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayFrameStyleCard from './FrameStyleCard.vue';
import FeatureMatchOverlayInspectorSource from './InspectorSource.vue';

/**
 * The host-owned half of the Feature Match Overlay editor: the Frame and the
 * Source Items.
 *
 * Everything else a Feature Match Layout carries is authored by the shared
 * compositor, which has its own tree and inspector. This component is what is
 * left of the Feature Match Overlay's own editor once the legacy widget
 * vocabulary is gone.
 */

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

const treeNodeRefs = ref<Record<string, HTMLElement>>({});

const { createSourceItem, patchFrame } = useFeatureMatchOverlayConfigEditor({
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

watch(() => props.config.layout.sources, (sources) => {
	const target = props.selectedTarget;
	if (target.type === 'source' && !sources.some(item => item.id === target.itemId))
		selectCanvas();
}, { deep: false });

function selectCanvas() {
	emit('update:selectedTarget', { type: 'canvas' });
}

function selectSource(itemId: string) {
	emit('update:selectedTarget', { type: 'source', itemId });
}

function addSourceItem() {
	selectSource(createSourceItem());
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

	if (current.kind === 'source') {
		return {
			icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
			label: current.item.label,
			badge: FEATURE_MATCH_SOURCE_ITEM_LABEL,
			summary: sourceSummary(current.item),
			visible: current.item.visible !== false,
		};
	}

	return {
		icon: 'i-lucide-circle-help',
		label: 'Selection unavailable',
		badge: 'Missing',
		summary: 'Choose the Canvas or another Source Item',
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
								Frame and Sources
							</p>
							<p class="text-xs text-muted">
								Canvas and external video source areas
							</p>
						</div>
						<UBadge variant="soft">
							{{ config.layout.sources.length }} sources
						</UBadge>
					</div>
				</section>

				<UButton
					icon="i-lucide-plus"
					size="sm"
					variant="soft"
					class="w-full justify-center"
					data-testid="overlay-add-source"
					@click="addSourceItem"
				>
					Add Source Item
				</UButton>

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

					<button
						v-for="item in config.layout.sources"
						:key="item.id"
						:ref="element => setTreeNodeRef(featureMatchOverlaySelectionKey({ type: 'source', itemId: item.id }), element)"
						type="button"
						class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
						:class="selectedTarget.type === 'source' && selectedTarget.itemId === item.id ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/20 hover:bg-muted/40'"
						data-testid="overlay-tree-source"
						@click="selectSource(item.id)"
					>
						<UIcon :name="FEATURE_MATCH_SOURCE_ITEM_ICON" class="mt-0.5 size-4 shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="flex items-center gap-2">
								<span class="truncate text-sm font-medium">{{ item.label }}</span>
								<UBadge size="xs" variant="soft" class="shrink-0">{{ FEATURE_MATCH_SOURCE_ITEM_LABEL }}</UBadge>
							</span>
							<span class="mt-0.5 block truncate text-xs text-muted">{{ sourceSummary(item) }}</span>
						</span>
						<UIcon :name="item.visible === false ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="mt-0.5 size-4 shrink-0 text-muted" />
					</button>
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

				<FeatureMatchOverlayInspectorSource
					v-else-if="selection.kind === 'source'"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:item="selection.item"
					@removed="selectCanvas"
				/>
			</section>
		</div>
	</div>
</template>
