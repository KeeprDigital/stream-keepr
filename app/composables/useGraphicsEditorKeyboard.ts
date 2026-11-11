import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { GraphicsEditorLayer } from '~/modules/graphics/editor/host';
import { useEventListener } from '@vueuse/core';
import { hasTextSelection, useGraphicsClipboard } from '~/composables/useGraphicsClipboard';
import { LAYER_GROUP_REFUSAL_REASONS } from '~/modules/graphics/editor/layerGrouping';
import { isTypingTarget } from '~/utils/typingTarget';

const NUDGE: Record<string, { x: number; y: number }> = {
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
};

interface GraphicsEditorKeyboardOptions {
	/** While true, as when a dialog over the editor is open, every key passes through. */
	suspended?: () => boolean;
}

/**
 * The graphics editor's keyboard, for as long as the calling component is mounted.
 *
 * Copying is not a write, so an observer copies; pasting is (#746). What is copied
 * is kept in this browser, so it pastes into another Screen of the same host too.
 * Without the lease every other key but Escape passes through to the browser, so
 * ⌘Z or ⌘D are not swallowed; Escape still selects. A key typed into a field, or
 * already handled, is left alone.
 */
export function useGraphicsEditorKeyboard<D, L extends GraphicsEditorLayer>(
	editor: GraphicsEditor<D, L>,
	host: Parameters<typeof useGraphicsClipboard>[0],
	options: GraphicsEditorKeyboardOptions = {},
) {
	const toast = useToast();
	const clipboard = useGraphicsClipboard(host);
	const { layers, selection } = editor;

	/** ⌘G: group the selection, or say why it cannot be grouped (#920, E8). */
	function groupSelection() {
		const refusal = editor.groupRefusal.value;
		if (!refusal) {
			editor.group();
			return;
		}
		toast.add({
			title: 'Can\'t group these layers',
			description: LAYER_GROUP_REFUSAL_REASONS[refusal],
			color: 'warning',
		});
	}

	async function pasteLayers() {
		const copied = await clipboard.layersToPaste();
		const refusal = copied && editor.paste(copied);
		if (refusal)
			clipboard.refuse(refusal);
	}

	async function pasteStyle() {
		const copied = await clipboard.styleToPaste();
		const refusal = copied && editor.pasteStyle(copied);
		if (refusal)
			clipboard.refuse(refusal);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || isTypingTarget(event.target) || options.suspended?.())
			return;

		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		const current = selection.value;
		let handled = true;

		// By code: ⌥ changes the character a key types.
		if (mod && !event.shiftKey && event.code === 'KeyC' && !hasTextSelection()) {
			const copied = event.altKey
				? clipboard.copyStyle(editor.copyStyle())
				: clipboard.copyLayers(editor.copy());
			if (copied)
				event.preventDefault();
			return;
		}

		if (!editor.writable.value && event.key !== 'Escape')
			return;

		if (mod && key === 'z' && !event.shiftKey) {
			editor.undo();
		}
		else if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) {
			editor.redo();
		}
		else if (mod && key === 'd') {
			editor.duplicate();
		}
		else if (mod && !event.shiftKey && event.code === 'KeyV') {
			void (event.altKey
				? pasteStyle()
				: pasteLayers());
		}
		else if (mod && (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
			const forward = event.code === 'BracketRight';
			if (event.shiftKey) {
				editor.moveToEdge(current, forward ? 'front' : 'back');
			}
			else {
				editor.move(current, forward
					? 1
					: -1);
			}
		}
		else if (mod && event.shiftKey && key === 'h') {
			editor.toggleVisible();
		}
		else if (mod && event.shiftKey && key === 'g') {
			editor.ungroup();
		}
		else if (mod && key === 'g' && layers.value.length > 0) {
			groupSelection();
		}
		else if (mod && event.shiftKey && key === 'l') {
			editor.toggleLock();
		}
		else if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
			editor.remove();
		}
		else if (!mod && event.key in NUDGE && layers.value.length > 0) {
			const step = event.shiftKey ? 10 : 1;
			const direction = NUDGE[event.key]!;
			editor.nudge({ x: direction.x * step, y: direction.y * step });
		}
		else if (event.key === 'Escape' && layers.value.length > 0) {
			editor.collapseSelection();
		}
		else {
			handled = false;
		}

		if (handled)
			event.preventDefault();
	}

	useEventListener(import.meta.client
		? window
		: undefined, 'keydown', handleKeydown);
}
