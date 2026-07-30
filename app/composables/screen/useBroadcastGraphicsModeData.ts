import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsPreviewState } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	isGraphicsPreviewStateMessage,
} from '~/modules/graphics/previewMessages';

/**
 * What a Broadcast Graphics Screen Output renders.
 *
 * A live output composes the Screen's persisted stack; playout decides which of
 * those graphics are on air, so until Take and Out exist no graphic is on air
 * and the Screen renders empty. An embedded editor preview instead composes the
 * working stack the editor pushes in, showing the one Broadcast Graphic being
 * authored.
 */
export function useBroadcastGraphicsModeData() {
	const { isPreview } = useScreenContext();
	const storedConfig = useScreenModeConfig('broadcast-graphics');
	const previewState = ref<GraphicsPreviewState | null>(null);

	const graphics = computed<readonly BroadcastGraphicConfig[]>(() =>
		previewState.value?.graphics ?? storedConfig.value.graphics ?? [],
	);

	const onAirGraphicIds = computed<readonly string[]>(() => {
		if (!previewState.value)
			return [];
		return previewState.value.previewGraphicId ? [previewState.value.previewGraphicId] : [];
	});

	const selectedTarget = computed<GraphicsSelectionTarget>(() =>
		previewState.value?.selectedTarget ?? { type: 'canvas' },
	);

	function handlePreviewStateMessage(message: MessageEvent) {
		if (!isPreview?.value)
			return;
		if (!isGraphicsPreviewStateMessage(message, { origin: window.location.origin, source: window.parent }))
			return;

		previewState.value = message.data.state;
	}

	/** Report a canvas selection back to the editor that embedded this preview. */
	function publishSelection(target: GraphicsSelectionTarget) {
		if (!isPreview?.value || !import.meta.client)
			return;

		window.parent?.postMessage({ type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target }, window.location.origin);
	}

	onMounted(() => {
		window.addEventListener('message', handlePreviewStateMessage);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('message', handlePreviewStateMessage);
	});

	return { graphics, onAirGraphicIds, selectedTarget, publishSelection };
}
