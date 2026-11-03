import type { ClipboardPasteRefusal, CopiedLayers, CopiedStyle, GraphicsClipboardHost } from '~/modules/graphics/clipboard';
import {
	clipboardRefusalMessage,
	readGraphicsClipboard,
	unselectableCopiedItems,
	writeGraphicsClipboard,
} from '~/modules/graphics/clipboard';
import { graphicAssetReferenceStatusOrUnavailable } from '~/utils/graphicAssetReferenceStatus';

/**
 * One graphics editor's side of the clipboard (#746): keeping what it copies in
 * this browser (E23), asking the Graphics Asset Library before a paste (E25), and
 * telling the author what happened. The rules are the clipboard module's.
 */
export function useGraphicsClipboard(host: GraphicsClipboardHost) {
	const toast = useToast();

	function refuse(refusal: ClipboardPasteRefusal) {
		toast.add({
			title: 'Nothing pasted',
			description: clipboardRefusalMessage(refusal),
			color: 'warning',
		});
	}

	function keep(entry: CopiedLayers | CopiedStyle, title: string): boolean {
		if (!writeGraphicsClipboard(entry)) {
			toast.add({ title: 'Nothing copied', description: 'This browser would not keep it.', color: 'error' });
			return false;
		}
		toast.add({ title, color: 'neutral' });
		return true;
	}

	/** Keep copied layers. Answers whether there were any to keep. */
	function copyLayers(copied: CopiedLayers | null): boolean {
		if (!copied)
			return false;
		const count = copied.items.length + copied.sources.length;
		keep(copied, count === 1
			? 'Copied 1 layer'
			: `Copied ${count} layers`);
		return true;
	}

	/** Keep a copied style. Answers whether there was one to keep. */
	function copyStyle(copied: CopiedStyle | null): boolean {
		if (!copied)
			return false;
		keep(copied, `Copied the style of "${copied.item.label}"`);
		return true;
	}

	/**
	 * The copied layers to paste, once every Graphic Asset they pin is still
	 * selectable; nothing, with the reason shown, otherwise.
	 */
	async function layersToPaste(): Promise<CopiedLayers | null> {
		const copied = readGraphicsClipboard('layers');
		if (!copied)
			return null;
		if (copied.host !== host) {
			refuse({ reason: 'other-host', from: copied.host });
			return null;
		}
		const items = await unselectableCopiedItems(copied, graphicAssetReferenceStatusOrUnavailable);
		if (items.length > 0) {
			refuse({ reason: 'unselectable', items });
			return null;
		}
		return copied;
	}

	/** The copied style to paste, or nothing. */
	function styleToPaste(): CopiedStyle | null {
		return readGraphicsClipboard('style');
	}

	return {
		copyLayers,
		copyStyle,
		layersToPaste,
		styleToPaste,
		refuse,
	};
}

/**
 * Whether ⌘C should copy the page's selected text rather than layers: the
 * author dragged across some words outside a field.
 */
export function hasTextSelection(): boolean {
	return import.meta.client && window.getSelection()?.type === 'Range';
}
