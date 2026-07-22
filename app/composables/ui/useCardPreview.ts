/**
 * Composable for managing card image preview state with hover and pin behavior.
 *
 * - Hovering a card shows its preview (unless another card is pinned).
 * - Clicking a card toggles pin (keeps preview visible even on mouse leave).
 * - Clicking anywhere else clears the pin.
 */
export function useCardPreview() {
	const activePreviewCard = ref<string | null>(null);
	const isPreviewPinned = ref(false);

	function handlePreviewUpdate(cardKey: string, open: boolean) {
		if (isPreviewPinned.value)
			return;
		if (open) {
			activePreviewCard.value = cardKey;
		}
		else if (activePreviewCard.value === cardKey) {
			activePreviewCard.value = null;
		}
	}

	function togglePreviewPin(cardKey: string) {
		if (isPreviewPinned.value && activePreviewCard.value === cardKey) {
			isPreviewPinned.value = false;
			activePreviewCard.value = null;
		}
		else {
			activePreviewCard.value = cardKey;
			isPreviewPinned.value = true;
		}
	}

	function clearPreviewPin() {
		if (isPreviewPinned.value) {
			isPreviewPinned.value = false;
			activePreviewCard.value = null;
		}
	}

	function resetPreview() {
		activePreviewCard.value = null;
		isPreviewPinned.value = false;
	}

	// Auto-register global click listener to clear pin
	onMounted(() => document.addEventListener('click', clearPreviewPin));
	onUnmounted(() => document.removeEventListener('click', clearPreviewPin));

	return {
		activePreviewCard,
		isPreviewPinned,
		handlePreviewUpdate,
		togglePreviewPin,
		clearPreviewPin,
		resetPreview,
	};
}
