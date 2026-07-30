<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import {
	GRAPHICS_PREVIEW_STATE_MESSAGE,
	isGraphicsPreviewSelectMessage,
} from '~/modules/graphics/previewMessages';

/**
 * The shared graphics preview: output selection, zoom, item selection and item
 * guides, and advisory action-safe and title-safe guides.
 *
 * The preview is a real Screen Output frame, asked explicitly for its guides.
 * A live Screen Output is never asked, so no guide can reach one.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	/** The Broadcast Graphic under authoring, composed in place of the on-air set. */
	previewGraphicId: string | null;
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{ selectTarget: [target: GraphicsSelectionTarget] }>();

const OUTPUT_OPTIONS = [
	{ label: 'Overlay', value: 'overlay', icon: 'i-lucide-layers' },
	{ label: 'Fill', value: 'fill', icon: 'i-lucide-square' },
	{ label: 'Key', value: 'key', icon: 'i-lucide-contrast' },
] satisfies Array<{ label: string; value: ScreenOutput; icon: string }>;

const PREVIEW_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: '0.5' },
	{ label: '100%', value: '1' },
] as const;

type PreviewZoom = typeof PREVIEW_ZOOM_OPTIONS[number]['value'];

const previewOutput = ref<ScreenOutput>('overlay');
const previewZoom = ref<PreviewZoom>('fit');
const itemGuides = ref(true);
const safeAreaGuides = ref(false);
const previewFrame = ref<HTMLIFrameElement | null>(null);

const previewUrl = computed(() => {
	const guides = itemGuides.value ? '&guides=1' : '';
	const safe = safeAreaGuides.value ? '&safe=1' : '';
	return `/event/${props.eventId}/screen/${props.screen.slug}?output=${previewOutput.value}&fit=1&preview=1${guides}${safe}`;
});

const previewAspectStyle = computed(() => (previewZoom.value === 'fit'
	? { aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`, maxHeight: '46vh' }
	: {
			width: `${props.canvasWidth * Number(previewZoom.value)}px`,
			height: `${props.canvasHeight * Number(previewZoom.value)}px`,
			maxWidth: 'none',
		}));

function pushPreviewState() {
	if (!import.meta.client || !previewFrame.value?.contentWindow)
		return;

	previewFrame.value.contentWindow.postMessage({
		type: GRAPHICS_PREVIEW_STATE_MESSAGE,
		state: {
			graphics: JSON.parse(JSON.stringify(props.graphics)),
			previewGraphicId: props.previewGraphicId,
			selectedTarget: { ...props.selectedTarget },
		},
	}, window.location.origin);
}

function handlePreviewSelection(message: MessageEvent) {
	if (!isGraphicsPreviewSelectMessage(message, {
		origin: window.location.origin,
		source: previewFrame.value?.contentWindow ?? null,
	})) {
		return;
	}

	emit('selectTarget', message.data.target);
}

onMounted(() => {
	window.addEventListener('message', handlePreviewSelection);
});

onBeforeUnmount(() => {
	window.removeEventListener('message', handlePreviewSelection);
});

watch(
	() => [props.graphics, props.previewGraphicId, props.selectedTarget] as const,
	() => pushPreviewState(),
	{ deep: true },
);
</script>

<template>
	<ScreenSettingsCard title="Preview" :default-open="true">
		<template #actions="{ open }">
			<div v-if="open" class="flex flex-wrap items-center gap-3">
				<UFormField label="Item guides" size="xs" class="flex items-center gap-2">
					<USwitch v-model="itemGuides" size="sm" data-testid="compositor-item-guides" />
				</UFormField>
				<UFormField label="Safe areas" size="xs" class="flex items-center gap-2">
					<USwitch v-model="safeAreaGuides" size="sm" data-testid="compositor-safe-area-guides" />
				</UFormField>
				<UFieldGroup size="sm">
					<UButton
						v-for="output in OUTPUT_OPTIONS"
						:key="output.value"
						:icon="output.icon"
						:color="previewOutput === output.value ? 'primary' : 'neutral'"
						:variant="previewOutput === output.value ? 'subtle' : 'outline'"
						:aria-label="`${output.label} preview output`"
						@click="() => { previewOutput = output.value }"
					>
						{{ output.label }}
					</UButton>
				</UFieldGroup>
				<UFieldGroup size="sm">
					<UButton
						v-for="zoom in PREVIEW_ZOOM_OPTIONS"
						:key="zoom.value"
						:color="previewZoom === zoom.value ? 'primary' : 'neutral'"
						:variant="previewZoom === zoom.value ? 'subtle' : 'outline'"
						:aria-label="`${zoom.label} preview zoom`"
						@click="() => { previewZoom = zoom.value }"
					>
						{{ zoom.label }}
					</UButton>
				</UFieldGroup>
			</div>
		</template>

		<div class="transparent-checkerboard-backdrop overflow-auto rounded-md">
			<div
				class="relative mx-auto"
				:class="previewZoom === 'fit' ? 'w-full' : 'shrink-0'"
				:style="previewAspectStyle"
			>
				<iframe
					ref="previewFrame"
					:key="previewUrl"
					:src="previewUrl"
					class="absolute inset-0 size-full border-0"
					title="Graphics compositor preview"
					@load="pushPreviewState"
				/>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
