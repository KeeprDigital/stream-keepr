import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useCardPreview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('starts with no active preview', () => {
		const { activePreviewCard, isPreviewPinned } = useCardPreview();
		expect(activePreviewCard.value).toBeNull();
		expect(isPreviewPinned.value).toBe(false);
	});

	it('shows preview on handlePreviewUpdate with open=true', () => {
		const { activePreviewCard, handlePreviewUpdate } = useCardPreview();
		handlePreviewUpdate('card-1', true);
		expect(activePreviewCard.value).toBe('card-1');
	});

	it('hides preview on handlePreviewUpdate with open=false', () => {
		const { activePreviewCard, handlePreviewUpdate } = useCardPreview();
		handlePreviewUpdate('card-1', true);
		handlePreviewUpdate('card-1', false);
		expect(activePreviewCard.value).toBeNull();
	});

	it('toggles pin on', () => {
		const { activePreviewCard, isPreviewPinned, handlePreviewUpdate, togglePreviewPin } = useCardPreview();
		handlePreviewUpdate('card-1', true);
		togglePreviewPin('card-1');
		expect(isPreviewPinned.value).toBe(true);
		expect(activePreviewCard.value).toBe('card-1');
	});

	it('toggles pin off on same card', () => {
		const { activePreviewCard, isPreviewPinned, handlePreviewUpdate, togglePreviewPin } = useCardPreview();
		handlePreviewUpdate('card-1', true);
		togglePreviewPin('card-1');
		togglePreviewPin('card-1');
		expect(isPreviewPinned.value).toBe(false);
		expect(activePreviewCard.value).toBeNull();
	});

	it('switches pin to different card', () => {
		const { activePreviewCard, isPreviewPinned, handlePreviewUpdate, togglePreviewPin } = useCardPreview();
		handlePreviewUpdate('card-1', true);
		togglePreviewPin('card-1');
		togglePreviewPin('card-2');
		expect(isPreviewPinned.value).toBe(true);
		expect(activePreviewCard.value).toBe('card-2');
	});

	it('clearPreviewPin clears pin state', () => {
		const { activePreviewCard, isPreviewPinned, togglePreviewPin, clearPreviewPin } = useCardPreview();
		togglePreviewPin('card-1');
		expect(isPreviewPinned.value).toBe(true);

		clearPreviewPin();
		expect(isPreviewPinned.value).toBe(false);
		expect(activePreviewCard.value).toBeNull();
	});

	it('clearPreviewPin does nothing when not pinned', () => {
		const { activePreviewCard, handlePreviewUpdate, clearPreviewPin } = useCardPreview();
		handlePreviewUpdate('card-1', true);
		clearPreviewPin();
		// activePreviewCard should remain since it wasn't pinned
		expect(activePreviewCard.value).toBe('card-1');
	});

	it('resetPreview clears everything', () => {
		const { activePreviewCard, isPreviewPinned, togglePreviewPin, resetPreview } = useCardPreview();
		togglePreviewPin('card-1');
		resetPreview();
		expect(activePreviewCard.value).toBeNull();
		expect(isPreviewPinned.value).toBe(false);
	});
});
