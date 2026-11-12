<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig, FeatureMatchSourceRole } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { Screen } from '~/types';
import GraphicsGeometryFields from '~/components/Graphics/GeometryFields.vue';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { appearanceSummary, rectSummary } from '~/modules/feature-match-overlay/layerSummaries';
import FeatureMatchOverlaySourceFramingStyleFields from './SourceFramingStyleFields.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	/** The Screen whose Screen Theme Override the Appearance section's Look writes. */
	screen: Screen;
	eventId: number;
	screenWidth: number;
	screenHeight: number;
	item: FeatureMatchSourceItemConfig;
}>();

const editor = useFeatureMatchOverlayConfigEditor({
	config: toRef(props, 'config'),
	updateConfig: props.updateConfig,
});

const SOURCE_ROLE_OPTIONS = [
	{ label: 'Main', value: 'main' },
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
] satisfies Array<{ label: string; value: FeatureMatchSourceRole }>;
</script>

<template>
	<div class="min-w-0">
		<ScreenSettingsSection
			id="feature-match-overlay-details"
			density="row"
			title="Details"
			:summary="item.label"
		>
			<ScreenSettingsField label="Name" stacked>
				<UInput
					:model-value="item.label"
					size="sm"
					class="w-full"
					@update:model-value="editor.updateSource(item.id, { label: String($event) })"
				/>
			</ScreenSettingsField>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="feature-match-overlay-bounds"
			density="row"
			title="Bounds"
			:summary="rectSummary(item)"
			default-open
		>
			<GraphicsGeometryFields
				:key="item.id"
				:rect="item"
				:container="{ width: screenWidth, height: screenHeight }"
				:anchor="item.anchor ?? 'top-left'"
				@update:anchor="anchor => editor.updateSource(item.id, { anchor })"
				@update="patch => editor.updateSource(item.id, patch)"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="feature-match-overlay-content"
			density="row"
			title="Content"
			:summary="item.sourceRole || 'Video source'"
			default-open
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
				<ScreenSettingsField label="Source role" stacked>
					<USelect
						:model-value="item.sourceRole"
						:items="SOURCE_ROLE_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						aria-label="Source role"
						@update:model-value="editor.updateSource(item.id, { sourceRole: $event })"
					/>
				</ScreenSettingsField>
			</div>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="feature-match-overlay-appearance"
			density="row"
			title="Appearance"
			:summary="appearanceSummary(item.framingStyle)"
		>
			<div class="space-y-4">
				<FeatureMatchOverlaySourceFramingStyleFields
					:framing-style="item.framingStyle"
					@update="updates => editor.updateSourceFramingStyle(item.id, updates)"
				/>
				<!-- Every Source Item shares this Look, so it writes a Screen Theme Override, not this item. -->
				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="source-appearance" />
			</div>
		</ScreenSettingsSection>
	</div>
</template>
