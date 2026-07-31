<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig, FeatureMatchSourceRole } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { appearanceSummary, rectSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayGeometryFields from './GeometryFields.vue';
import FeatureMatchOverlayOrderSection from './OrderSection.vue';
import FeatureMatchOverlaySourceFramingStyleFields from './SourceFramingStyleFields.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	item: FeatureMatchSourceItemConfig;
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

const SOURCE_ROLE_OPTIONS = [
	{ label: 'Main', value: 'main' },
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
] satisfies Array<{ label: string; value: FeatureMatchSourceRole }>;

function removeSelf() {
	editor.removeSource(props.item.id);
	emit('removed');
}
</script>

<template>
	<div class="min-w-0">
		<FeatureMatchOverlayControlSection
			title="Details"
			default-open
			badge="Source"
			:summary="item.label"
		>
			<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
				<UFormField label="Name">
					<UInput
						:model-value="item.label"
						size="sm"
						class="w-full"
						@update:model-value="editor.updateSource(item.id, { label: String($event) })"
					/>
				</UFormField>
				<ScreenSettingsToggle
					label="Visible"
					:model-value="item.visible"
					@update:model-value="editor.updateSource(item.id, { visible: $event })"
				/>
				<UButton
					color="error"
					variant="soft"
					icon="i-lucide-trash-2"
					aria-label="Remove Source Item"
					title="Remove Source Item"
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
				@update-anchor="value => editor.updateSource(item.id, { anchor: value as FeatureMatchOverlayAnchorValue })"
				@update="(field, value, unit) => editor.updateSourceRectFromAnchor(item.id, field, value, unit)"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Content"
			:summary="item.sourceRole || 'Video source'"
		>
			<div class="grid gap-3 md:grid-cols-2">
				<ScreenSettingsToggle
					label="Cut hole in canvas/frame"
					:model-value="item.frameCutout"
					@update:model-value="editor.updateSource(item.id, { frameCutout: $event })"
				/>
				<!--
					A Source Role, not a camera. It says what this area frames, which is
					the one thing about a Source Item that still means something on
					another installation — so it is chosen from the vocabulary rather
					than typed as local shorthand.
				-->
				<UFormField label="Source role">
					<USelect
						:model-value="item.sourceRole"
						:items="SOURCE_ROLE_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						aria-label="Source role"
						@update:model-value="editor.updateSource(item.id, { sourceRole: $event })"
					/>
				</UFormField>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection
			title="Appearance"
			:summary="appearanceSummary(item.framingStyle)"
		>
			<FeatureMatchOverlaySourceFramingStyleFields
				:framing-style="item.framingStyle"
				@update="updates => editor.updateSourceFramingStyle(item.id, updates)"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayOrderSection
			@send-to-back="editor.sendSourceToBack(item.id)"
			@move="delta => editor.moveSourceOrder(item.id, delta)"
			@bring-to-front="editor.bringSourceToFront(item.id)"
		/>
	</div>
</template>
