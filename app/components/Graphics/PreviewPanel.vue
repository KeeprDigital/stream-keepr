<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { PreviewZoom } from '~/modules/graphics/previewControls';
import { SCREEN_OUTPUT_OPTIONS } from '~~/shared/screenModeDefinitions';
import { PREVIEW_ZOOM_OPTIONS } from '~/modules/graphics/previewControls';

/**
 * The editor preview shared by the Broadcast Graphics and Feature Match Overlay
 * editors: output selection, zoom, a viewport sized to the canvas aspect ratio,
 * and the item and advisory safe-area guide switches.
 *
 * The host owns the preview iframe (the `viewport` slot) and everything said to
 * it: it builds the preview URL from `output`, `itemGuides` and `safeAreaGuides`,
 * and keeps its own state in sync. The `controls` slot adds host controls to the
 * toolbar; the default slot sits between the toolbar and the viewport.
 */
const props = defineProps<{
	canvasWidth: number;
	canvasHeight: number;
	/** A solid colour behind the viewport; omitted, it shows transparency. */
	background?: string;
	/** The tallest a fitted viewport is drawn, as a CSS length. Default: 46vh. */
	fitHeight?: string;
	/** Whether the panel can be collapsed. Default: true. */
	collapsible?: boolean;
}>();

const output = defineModel<ScreenOutput>('output', { default: 'overlay' });
const itemGuides = defineModel<boolean>('itemGuides', { default: true });
const safeAreaGuides = defineModel<boolean>('safeAreaGuides', { default: false });

const zoom = ref<PreviewZoom>('fit');

const viewportStyle = computed(() => [
	zoom.value === 'fit'
		? {
				aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`,
				width: props.fitHeight
					? `calc(${props.fitHeight} * ${props.canvasWidth / props.canvasHeight})`
					: `${46 * props.canvasWidth / props.canvasHeight}vh`,
				maxWidth: '100%',
			}
		: {
				width: `${props.canvasWidth * Number(zoom.value)}px`,
				height: `${props.canvasHeight * Number(zoom.value)}px`,
				maxWidth: 'none',
			},
	props.background
		? { backgroundColor: props.background }
		: {},
]);
</script>

<template>
	<ScreenSettingsCard title="Preview" :default-open="true" :collapsible="collapsible !== false">
		<template #actions="{ open }">
			<div v-if="open" class="flex flex-wrap items-center gap-3">
				<UFieldGroup size="sm">
					<UButton
						icon="i-lucide-square-dashed"
						:color="itemGuides ? 'primary' : 'neutral'"
						:variant="itemGuides ? 'subtle' : 'outline'"
						aria-label="Item guides"
						:aria-pressed="itemGuides"
						title="Item guides"
						data-testid="preview-item-guides"
						@click="() => { itemGuides = !itemGuides }"
					/>
					<UButton
						icon="i-lucide-scan"
						:color="safeAreaGuides ? 'primary' : 'neutral'"
						:variant="safeAreaGuides ? 'subtle' : 'outline'"
						aria-label="Safe areas"
						:aria-pressed="safeAreaGuides"
						title="Action-safe and title-safe guides"
						data-testid="preview-safe-area-guides"
						@click="() => { safeAreaGuides = !safeAreaGuides }"
					/>
				</UFieldGroup>
				<UFieldGroup size="sm">
					<UButton
						v-for="option in SCREEN_OUTPUT_OPTIONS"
						:key="option.value"
						:icon="option.icon"
						:color="output === option.value ? 'primary' : 'neutral'"
						:variant="output === option.value ? 'subtle' : 'outline'"
						:aria-label="`${option.label} preview output`"
						@click="() => { output = option.value }"
					>
						{{ option.label }}
					</UButton>
				</UFieldGroup>
				<UFieldGroup size="sm">
					<UButton
						v-for="option in PREVIEW_ZOOM_OPTIONS"
						:key="option.value"
						:color="zoom === option.value ? 'primary' : 'neutral'"
						:variant="zoom === option.value ? 'subtle' : 'outline'"
						:aria-label="`${option.label} preview zoom`"
						@click="() => { zoom = option.value }"
					>
						{{ option.label }}
					</UButton>
				</UFieldGroup>
				<slot name="controls" />
			</div>
		</template>

		<slot />

		<div class="overflow-auto">
			<div
				class="relative mx-auto overflow-hidden"
				:class="[
					zoom === 'fit' ? '' : 'shrink-0',
					{ 'transparent-checkerboard-backdrop': !background },
				]"
				:style="viewportStyle"
				data-testid="preview-viewport"
			>
				<slot name="viewport" />
			</div>
		</div>
	</ScreenSettingsCard>
</template>
