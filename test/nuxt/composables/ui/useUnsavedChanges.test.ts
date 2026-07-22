import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the route leave guard callback so tests can invoke it directly
let capturedRouteLeaveGuard: (() => Promise<boolean>) | null = null;
const mockOpenFn = vi.fn(() => ({ result: Promise.resolve(true) }));
const mockOverlay = {
	create: vi.fn(() => ({
		open: mockOpenFn,
	})),
};

mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('onBeforeRouteLeave', () => (fn: any) => {
	capturedRouteLeaveGuard = fn;
});

describe('useUnsavedChanges', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedRouteLeaveGuard = null;
		mockOpenFn.mockReturnValue({ result: Promise.resolve(true) });
	});

	it('returns isDirty, registerDirtyState, and bypassGuard', () => {
		const result = useUnsavedChanges();
		expect(result).toHaveProperty('isDirty');
		expect(result).toHaveProperty('registerDirtyState');
		expect(result).toHaveProperty('bypassGuard');
	});

	it('starts not dirty', () => {
		const { isDirty } = useUnsavedChanges();
		expect(isDirty.value).toBe(false);
	});

	it('becomes dirty when a registered dirty state is true', () => {
		const { isDirty, registerDirtyState } = useUnsavedChanges();
		const dirty = ref(false);
		registerDirtyState(dirty);

		expect(isDirty.value).toBe(false);
		dirty.value = true;
		expect(isDirty.value).toBe(true);
	});

	it('returns to clean when dirty state resets', () => {
		const { isDirty, registerDirtyState } = useUnsavedChanges();
		const dirty = ref(true);
		registerDirtyState(dirty);

		expect(isDirty.value).toBe(true);
		dirty.value = false;
		expect(isDirty.value).toBe(false);
	});

	it('unregisters dirty state with returned function', () => {
		const { isDirty, registerDirtyState } = useUnsavedChanges();
		const dirty = ref(true);
		const unregister = registerDirtyState(dirty);

		expect(isDirty.value).toBe(true);
		unregister();
		expect(isDirty.value).toBe(false);
	});

	it('tracks multiple dirty states', () => {
		const { isDirty, registerDirtyState } = useUnsavedChanges();
		const dirty1 = ref(false);
		const dirty2 = ref(false);
		registerDirtyState(dirty1);
		registerDirtyState(dirty2);

		expect(isDirty.value).toBe(false);
		dirty2.value = true;
		expect(isDirty.value).toBe(true);
	});

	// ── onBeforeRouteLeave guard ──

	describe('route leave guard', () => {
		it('shows confirmation modal when dirty', async () => {
			const { registerDirtyState } = useUnsavedChanges();
			registerDirtyState(ref(true));

			await capturedRouteLeaveGuard!();

			expect(mockOpenFn).toHaveBeenCalled();
		});

		it('allows navigation when user confirms', async () => {
			mockOpenFn.mockReturnValueOnce({ result: Promise.resolve(true) });
			const { registerDirtyState } = useUnsavedChanges();
			registerDirtyState(ref(true));

			const result = await capturedRouteLeaveGuard!();

			expect(result).toBe(true);
		});

		it('blocks navigation when user cancels', async () => {
			mockOpenFn.mockReturnValueOnce({ result: Promise.resolve(false) });
			const { registerDirtyState } = useUnsavedChanges();
			registerDirtyState(ref(true));

			const result = await capturedRouteLeaveGuard!();

			expect(result).toBe(false);
		});
	});
});
