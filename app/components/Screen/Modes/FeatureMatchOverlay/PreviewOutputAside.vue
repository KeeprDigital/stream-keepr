<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { FeatureMatchOverlaySelectionTarget, Screen } from '~/types';
import { DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT, DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH } from '~~/shared/types/screenConfig';
import { screenOutputPath } from '~~/shared/utils/screenOutput';
import { isFeatureMatchOverlaySelectionTarget } from '~/modules/feature-match-overlay/selection';
import {
	GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE,
	isGraphicsPreviewSelectMessage,
} from '~/modules/graphics/previewMessages';

/**
 * The Feature Match Overlay editor preview: output selection, zoom, item guides,
 * and advisory action-safe and title-safe guides.
 *
 * Two selections travel through it, because the page has two authoring surfaces.
 * The host-owned one names the Frame or a Source Item; the
 * shared one names a Graphic Item inside the one composition. Each is pushed into
 * the frame and reported back in its own vocabulary, and the editor keeps at most
 * one of them non-canvas.
 *
 * Guides are asked for on the preview's own URL, so a live Screen Output — which
 * never carries the preview flag — can never draw one.
 */

const props = defineProps<{
	eventId: number;
	screen: Screen;
	config: FeatureMatchOverlayModeConfig;
	selectedTarget: FeatureMatchOverlaySelectionTarget;
	/** The shared item tree's selection, in the compositor's own vocabulary. */
	compositorTarget: GraphicsSelectionTarget;
	publicationBlocked?: boolean;
	publicationBlockReason?: string;
}>();

const emit = defineEmits<{
	selectTarget: [target: FeatureMatchOverlaySelectionTarget];
	selectCompositorTarget: [target: GraphicsSelectionTarget];
}>();

const OUTPUT_OPTIONS = [
	{ label: 'Overlay', value: 'overlay', icon: 'i-lucide-layers' },
	{ label: 'Fill', value: 'fill', icon: 'i-lucide-square' },
	{ label: 'Key', value: 'key', icon: 'i-lucide-contrast' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayOutput; icon: string }>;

const PREVIEW_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: '0.5' },
	{ label: '100%', value: '1' },
] as const;

type PreviewZoom = typeof PREVIEW_ZOOM_OPTIONS[number]['value'];

const toast = useToast();
const { copyToClipboard } = useCopyToClipboard();
const { screenOutputAccessUrl, openScreenOutput } = useScreenOutputAccessUrl();
const requestUrl = useRequestURL();
const previewOutput = ref<FeatureMatchOverlayOutput>('overlay');
const previewGuides = ref(true);
const previewSafeAreas = ref(false);
const previewZoom = ref<PreviewZoom>('fit');
const previewFrame = ref<HTMLIFrameElement | null>(null);

const outputBaseUrl = computed(() => import.meta.client ? window.location.origin : requestUrl.origin);
const previewUrl = computed(() => screenOutputPath({
	eventId: props.eventId,
	screenSlug: props.screen.slug,
	output: previewOutput.value,
	preview: true,
	itemGuides: previewGuides.value,
	safeAreaGuides: previewSafeAreas.value,
}));
const screenWidth = computed(() => props.screen.screenConfig?.width ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH);
const screenHeight = computed(() => props.screen.screenConfig?.height ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT);
const previewAspectStyle = computed(() => ({
	...(previewZoom.value === 'fit'
		? { aspectRatio: `${screenWidth.value} / ${screenHeight.value}`, maxHeight: '46vh' }
		: {
				width: `${screenWidth.value * Number(previewZoom.value)}px`,
				height: `${screenHeight.value * Number(previewZoom.value)}px`,
				maxWidth: 'none',
			}),
}));

/**
 * The output's address, shown so an operator can read where it lives.
 *
 * Deliberately without this Screen's Screen Output Asset Capability, which is a
 * secret and does not belong in a field on a page anyone can be standing behind.
 * The copy and download controls beside it obtain one and carry it; this is the
 * address, not the hand-out (#231).
 */
function outputUrl(output: FeatureMatchOverlayOutput) {
	return `${outputBaseUrl.value}${screenOutputPath({
		eventId: props.eventId,
		screenSlug: props.screen.slug,
		output,
	})}`;
}

function accessUrlOptions(output: FeatureMatchOverlayOutput, download = false) {
	return {
		eventId: props.eventId,
		screenId: props.screen.id,
		screenSlug: props.screen.slug,
		output,
		download,
	};
}

function syncSelectedTargetToPreview() {
	if (!import.meta.client || !previewFrame.value?.contentWindow)
		return;

	const target = { ...props.selectedTarget };

	previewFrame.value.contentWindow.postMessage({
		type: 'feature-match-overlay:selected-target',
		target,
	}, window.location.origin);
}

function syncConfigToPreview() {
	if (!import.meta.client || !previewFrame.value?.contentWindow)
		return;

	previewFrame.value.contentWindow.postMessage({
		type: 'feature-match-overlay:preview-config',
		config: JSON.parse(JSON.stringify(props.config)),
	}, window.location.origin);
}

function syncCompositorTargetToPreview() {
	if (!import.meta.client || !previewFrame.value?.contentWindow)
		return;

	previewFrame.value.contentWindow.postMessage({
		type: GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE,
		target: { ...props.compositorTarget },
	}, window.location.origin);
}

function syncPreviewState() {
	syncConfigToPreview();
	syncSelectedTargetToPreview();
	syncCompositorTargetToPreview();
}

function handlePreviewSelection(message: MessageEvent) {
	if (
		message.origin !== window.location.origin
		|| message.source !== previewFrame.value?.contentWindow
		|| typeof message.data !== 'object'
		|| message.data === null
		|| message.data.type !== 'feature-match-overlay:select'
		|| !isFeatureMatchOverlaySelectionTarget(message.data.target)
	) {
		return;
	}

	emit('selectTarget', message.data.target);
}

function handleCompositorPreviewSelection(message: MessageEvent) {
	if (!isGraphicsPreviewSelectMessage(message, {
		origin: window.location.origin,
		source: previewFrame.value?.contentWindow ?? null,
	})) {
		return;
	}

	emit('selectCompositorTarget', message.data.target);
}

onMounted(() => {
	window.addEventListener('message', handlePreviewSelection);
	window.addEventListener('message', handleCompositorPreviewSelection);
});

onBeforeUnmount(() => {
	window.removeEventListener('message', handlePreviewSelection);
	window.removeEventListener('message', handleCompositorPreviewSelection);
});

watch(() => props.selectedTarget, () => {
	syncSelectedTargetToPreview();
}, { deep: true });

watch(() => props.compositorTarget, () => {
	syncCompositorTargetToPreview();
}, { deep: true });

watch(() => props.config, () => {
	syncConfigToPreview();
}, { deep: true });

// Either switch changes the preview URL, which reloads the frame; the working
// state has to be pushed into the new document once it exists.
watch([previewGuides, previewSafeAreas], () => {
	void nextTick(syncPreviewState);
});

async function copyOutputUrl(output: FeatureMatchOverlayOutput) {
	if (props.publicationBlocked)
		return;
	await copyToClipboard(await screenOutputAccessUrl(accessUrlOptions(output)), {
		successTitle: 'URL copied',
		successDescription: `${output.toUpperCase()} output URL copied.`,
		errorDescription: `Failed to copy ${output.toUpperCase()} output URL to clipboard.`,
	});
}

async function downloadOutput(output: FeatureMatchOverlayOutput) {
	if (props.publicationBlocked)
		return;
	toast.add({ title: 'Preparing download', description: `${output.toUpperCase()} PNG will download from a temporary output tab.`, color: 'info' });
	// A capture browser that cannot resolve this Screen's assets produces a PNG that
	// looks finished and is missing every image, video and library font in it, so a
	// capture that cannot carry a capability is refused rather than exported (#231).
	if (!await openScreenOutput(accessUrlOptions(output, true))) {
		toast.add({
			title: 'Download unavailable',
			description: `Asset access for this Screen could not be obtained, so the ${output.toUpperCase()} PNG would have been missing its media.`,
			color: 'error',
		});
	}
}
</script>

<template>
	<div class="space-y-6 min-w-0">
		<ScreenSettingsCard title="Preview" :default-open="true">
			<template #actions="{ open }">
				<div v-if="open" class="flex flex-wrap items-center gap-3">
					<UFormField label="Item guides" size="xs" class="flex items-center gap-2">
						<USwitch v-model="previewGuides" size="sm" data-testid="preview-item-guides" />
					</UFormField>
					<UFormField label="Safe areas" size="xs" class="flex items-center gap-2">
						<USwitch v-model="previewSafeAreas" size="sm" data-testid="preview-safe-area-guides" />
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
							@click="() => { previewZoom = zoom.value }"
						>
							{{ zoom.label }}
						</UButton>
					</UFieldGroup>
					<UPopover>
						<UButton
							size="sm"
							variant="soft"
							color="neutral"
							icon="i-lucide-link"
							trailing-icon="i-lucide-chevron-down"
							:disabled="publicationBlocked"
							:title="publicationBlockReason"
						>
							Outputs
						</UButton>
						<template #content>
							<div class="w-[min(38rem,calc(100vw-2rem))] space-y-3 p-3">
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-sm font-medium">
											Output URLs
										</p>
										<p class="text-xs text-muted">
											Copy broadcast URLs or download PNG captures.
										</p>
									</div>
								</div>
								<div class="space-y-2">
									<div
										v-for="output in OUTPUT_OPTIONS"
										:key="output.value"
										class="grid gap-2 rounded-lg border border-default/70 bg-muted/20 p-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_auto] sm:items-center"
									>
										<UBadge variant="soft" class="justify-center uppercase">
											{{ output.value }}
										</UBadge>
										<UInput
											:model-value="outputUrl(output.value)"
											readonly
											size="sm"
											class="min-w-0"
										/>
										<UButton
											size="sm"
											variant="soft"
											icon="i-lucide-copy"
											:disabled="publicationBlocked"
											:title="publicationBlockReason"
											:data-testid="`copy-output-${output.value}`"
											@click="copyOutputUrl(output.value)"
										>
											Copy
										</UButton>
										<UButton
											size="sm"
											icon="i-lucide-download"
											:disabled="publicationBlocked"
											:title="publicationBlockReason"
											:data-testid="`download-output-${output.value}`"
											@click="downloadOutput(output.value)"
										>
											PNG
										</UButton>
									</div>
								</div>
							</div>
						</template>
					</UPopover>
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
						title="Feature Match Overlay preview"
						@load="syncPreviewState"
					/>
				</div>
			</div>
		</ScreenSettingsCard>
	</div>
</template>
