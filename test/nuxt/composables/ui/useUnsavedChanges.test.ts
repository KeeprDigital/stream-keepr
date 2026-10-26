import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the route leave guard callback so tests can invoke it directly
let capturedRouteLeaveGuard: (() => Promise<boolean>) | null = null;
const mockOpenFn = vi.fn(() => ({
	result: Promise.resolve(true),
}));
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
		mockOpenFn.mockReturnValue({
			result: Promise.resolve(true),
		});
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
		it.each([
			['confirms', true],
			['cancels', false],
		])('asks before leaving a dirty page, and leaves only when the operator confirms (%s)', async (_, confirmed) => {
			mockOpenFn.mockReturnValueOnce({ result: Promise.resolve(confirmed) });
			const { registerDirtyState } = useUnsavedChanges();
			registerDirtyState(ref(true));

			await expect(capturedRouteLeaveGuard!()).resolves.toBe(confirmed);
			expect(mockOpenFn).toHaveBeenCalledOnce();
		});

		it('leaves a clean page without asking', async () => {
			useUnsavedChanges().registerDirtyState(ref(false));

			await expect(capturedRouteLeaveGuard!()).resolves.toBe(true);
			expect(mockOpenFn).not.toHaveBeenCalled();
		});

		it('leaves a dirty page without asking once the guard is bypassed', async () => {
			const { registerDirtyState, bypassGuard } = useUnsavedChanges();
			registerDirtyState(ref(true));

			bypassGuard();

			await expect(capturedRouteLeaveGuard!()).resolves.toBe(true);
			expect(mockOpenFn).not.toHaveBeenCalled();
		});
	});
});
