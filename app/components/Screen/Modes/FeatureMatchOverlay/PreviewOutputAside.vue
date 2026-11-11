<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { EditorSelectionFrame } from '~/modules/graphics/editor/layerFrame';
import type { ExpectedSender, GraphicsPreviewAnimationPlan, MessageEnvelope } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { FeatureMatchOverlaySelectionTarget, Screen } from '~/types';
import { FEATURE_MATCH_LAYOUT_ANIMATION_PHASES, FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { SCREEN_OUTPUT_OPTIONS } from '~~/shared/screenModeDefinitions';
import {
	FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE,
	FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE,
	isFeatureMatchOverlayPreviewSelectMessage,
} from '~/modules/feature-match-overlay/previewMessages';
import {
	GRAPHICS_PREVIEW_ANIMATION_MESSAGE,
	GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE,
	GRAPHICS_PREVIEW_THEME_MESSAGE,
} from '~/modules/graphics/previewMessages';

/**
 * The Feature Match Overlay editor preview: the shared editor preview shell
 * (`GraphicsEditorPreview`: frame, guides, zoom, canvas handles, Graphic
 * Animation Preview), plus the shared output hand-out, this host's PNG capture,
 * stress dataset and animation subjects.
 *
 * Two selections travel through it, because the page has two authoring surfaces.
 * The host-owned one names the Frame or a Source Item; the
 * shared one names a Graphic Item inside the one composition. Each is pushed into
 * the frame and reported back in its own vocabulary, and the editor keeps at most
 * one of them non-canvas.
 *
 * The Feature Match Stress Dataset (#743) is asked for on the preview's own URL,
 * as the guides are, so a live Screen Output can never resolve against it: editor
 * state, never written, and offered whether or not this session may author, since
 * it changes nothing but what the preview shows.
 */

const props = defineProps<{
	eventId: number;
	screen: Screen;
	config: FeatureMatchOverlayModeConfig;
	selectedTarget: FeatureMatchOverlaySelectionTarget;
	/** The shared item tree's selection, in the compositor's own vocabulary. */
	compositorTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	publicationBlocked?: boolean;
	publicationBlockReason?: string;
	/** Where the selected layer sits on the canvas, when the canvas can move it. */
	selectionFrame?: EditorSelectionFrame | null;
	selectionLabel?: string;
	/** Where each selected locked layer sits on the canvas, badged as locked. */
	lockedBoxes?: readonly GraphicRect[];
	/** The tallest the fitted preview is drawn, as a CSS length. */
	fitHeight?: string;
	/**
	 * The stored values of a Theme to preview bound Graphic Items under, null to
	 * follow the Screen's Event's Theme, or absent to tell the frame nothing yet.
	 */
	previewThemeValues?: StoredThemeTokens | null;
}>();

const emit = defineEmits<{
	/** `toggle` is a ⌘- or Ctrl-click: add the layer to the selection, or take it out (#740). */
	selectTarget: [target: FeatureMatchOverlaySelectionTarget, toggle: boolean];
	selectCompositorTarget: [target: GraphicsSelectionTarget, toggle: boolean];
	/** The selected layer moved or resized on the canvas; one `gesture` per drag. */
	manipulate: [rect: GraphicRect, gesture: number];
	/** Each frame of a canvas rotate drag, as the selected Graphic Item's new Graphic Rotation. */
	rotate: [rotation: number, gesture: number];
	/** A canvas drag began, and ended: the frames between are one edit. */
	gestureStart: [];
	gestureEnd: [];
}>();

const toast = useToast();
const { openScreenOutput } = useScreenOutputAccessUrl();
const stressDataset = ref(false);

/**
 * Graphic Animation Preview (#749): a run plays the whole Feature Match Layout —
 * every item's enter, on-screen and exit — or the selected Graphic Item alone
 * (E31). The shared controls describe the run and this pushes it to the frame,
 * which plays it over the working layout. It never writes and never reaches a
 * live Screen Output, so it is offered whether or not this session may author.
 */
const ANIMATION_SUBJECTS = [
	{ value: 'composition', label: 'Whole layout' },
	{ value: 'item', label: 'Selected item' },
] as const;
const animationSubject = ref<typeof ANIMATION_SUBJECTS[number]['value']>('composition');
const animationPlan = ref<GraphicsPreviewAnimationPlan | null>(null);
const animationTarget = computed(() => {
	if (animationSubject.value === 'composition')
		return { graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID };
	return props.compositorTarget.type === 'item'
		? { graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: props.compositorTarget.itemId }
		: null;
});

/**
 * What the frame is told: the whole working mode config, the host-owned
 * selection and the compositor's, the Theme previewed under once there is one to
 * name, and the run in play.
 */
const previewMessages = computed(() => [
	{ type: FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE, config: props.config },
	{ type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE, target: props.selectedTarget },
	{ type: GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE, target: props.compositorTarget },
	...(props.previewThemeValues === undefined
		? []
		: [
				{ type: GRAPHICS_PREVIEW_THEME_MESSAGE, tokens: props.previewThemeValues },
			]),
	{ type: GRAPHICS_PREVIEW_ANIMATION_MESSAGE, plan: animationPlan.value },
]);

/**
 * The host-owned selection reported back by the frame, through this host's own
 * guard — which is built on the same shared sender check the shell uses for
 * everything else it hears (#260).
 *
 * It hand-rolled that check until #252. The copy compared `message.source`
 * against the frame's `contentWindow` and nothing else, so once the frame was
 * gone — null `contentWindow`, and a `MessageEvent` carries a null source unless
 * a window sent it — the two matched and a selection from nobody was emitted as
 * the frame's own.
 */
function receiveHostSelection(message: MessageEnvelope, expected: ExpectedSender) {
	if (!isFeatureMatchOverlayPreviewSelectMessage(message, expected))
		return false;
	emit('selectTarget', message.data.target, message.data.toggle === true);
	return true;
}

async function downloadOutput(output: FeatureMatchOverlayOutput) {
	if (props.publicationBlocked)
		return;
	toast.add({ title: 'Preparing download', description: `${output.toUpperCase()} PNG will download from a temporary output tab.`, color: 'info' });
	// A capture browser that cannot resolve this Screen's assets produces a PNG that
	// looks finished and is missing every image, video and library font in it, so a
	// capture that cannot carry a capability is refused rather than exported (#231).
	const result = await openScreenOutput({
		eventId: props.eventId,
		screenId: props.screen.id,
		screenSlug: props.screen.slug,
		output,
		download: true,
	});
	if (result === 'access-refused') {
		toast.add({
			title: 'Download unavailable',
			description: `Asset access for this Screen could not be obtained, so the ${output.toUpperCase()} PNG would have been missing its media.`,
			color: 'error',
		});
	}
	// A capture runs in a tab, so a pop-up blocker stops it outright — and the download
	// was already announced, leaving the operator watching for a file that is not
	// coming. Blamed on asset access until #258, which asks them to retry a capture
	// their browser will refuse identically.
	else if (result === 'window-blocked') {
		toast.add({
			title: 'Download unavailable',
			description: `This browser blocked the capture tab, so the ${output.toUpperCase()} PNG was never rendered. Allow pop-ups for this site, then download again.`,
			color: 'error',
		});
	}
}

/** The PNG capture stays the editor's own, beside the shared hand-out (#1104). */
const OUTPUT_VALUES = SCREEN_OUTPUT_OPTIONS.map(option => option.value);
const downloadItems = SCREEN_OUTPUT_OPTIONS.map(option => ({
	label: `${option.label} PNG`,
	icon: option.icon,
	onSelect: () => void downloadOutput(option.value),
}));
</script>

<template>
	<div class="space-y-6 min-w-0">
		<GraphicsEditorPreview
			v-model:animation-plan="animationPlan"
			:event-id="eventId"
			:screen-slug="screen.slug"
			:canvas-width="canvasWidth"
			:canvas-height="canvasHeight"
			title="Feature Match Overlay preview"
			:messages="previewMessages"
			:url-options="{ stressDataset }"
			:receive="receiveHostSelection"
			:animation-target="animationTarget"
			:animation-phases="FEATURE_MATCH_LAYOUT_ANIMATION_PHASES"
			animation-hint="Select a Graphic Item to preview its animation alone."
			:selection-frame="selectionFrame"
			:selection-label="selectionLabel"
			:locked-boxes="lockedBoxes"
			:collapsible="false"
			:fit-height="fitHeight"
			@select="(target, toggle) => emit('selectCompositorTarget', target, toggle)"
			@manipulate="(rect, gesture) => emit('manipulate', rect, gesture)"
			@rotate="(rotation, gesture) => emit('rotate', rotation, gesture)"
			@gesture-start="emit('gestureStart')"
			@gesture-end="emit('gestureEnd')"
		>
			<template #controls>
				<UButton
					size="sm"
					icon="i-lucide-ruler"
					:color="stressDataset ? 'primary' : 'neutral'"
					:variant="stressDataset ? 'subtle' : 'outline'"
					:aria-pressed="stressDataset"
					title="Preview the longest plausible Feature Match values, over any bound Slot. Nothing is saved."
					data-testid="preview-stress-dataset"
					@click="() => { stressDataset = !stressDataset }"
				>
					Stress test
				</UButton>
				<ScreenOutputHandOut
					:event-id="eventId"
					:screen="screen"
					:outputs="OUTPUT_VALUES"
					:disabled="publicationBlocked"
					:disabled-reason="publicationBlockReason"
				/>
				<UDropdownMenu :items="downloadItems" :disabled="publicationBlocked">
					<UButton
						size="sm"
						variant="soft"
						color="neutral"
						icon="i-lucide-download"
						trailing-icon="i-lucide-chevron-down"
						label="PNG"
						:disabled="publicationBlocked"
						:title="publicationBlocked ? publicationBlockReason : 'Download a Screen Output as a PNG, captured with the asset access that resolves its media'"
						data-testid="download-output"
					/>
				</UDropdownMenu>
			</template>

			<template #animation>
				<UFieldGroup size="xs">
					<UButton
						v-for="subject in ANIMATION_SUBJECTS"
						:key="subject.value"
						:color="animationSubject === subject.value ? 'primary' : 'neutral'"
						:variant="animationSubject === subject.value ? 'subtle' : 'outline'"
						:aria-pressed="animationSubject === subject.value"
						:data-testid="`animation-preview-subject-${subject.value}`"
						@click="() => { animationSubject = subject.value }"
					>
						{{ subject.label }}
					</UButton>
				</UFieldGroup>
			</template>
		</GraphicsEditorPreview>
	</div>
</template>
