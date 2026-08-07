import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

/*
 * `useAsyncAction` is deliberately not mocked. A hand-written copy stood here under the
 * name `realExecuteAction`, which is the whole argument against it: a copy claiming to
 * be the real thing is a copy that can stop being it, and this suite exists to test the
 * optimistic update and rollback flow *through* that seam (#263).
 */

interface TestItem { id: number; name: string }

function createTestItems(items: TestItem[]): Ref<TestItem[]> {
	return ref(items.map(i => ({ ...i })));
}

describe('useStoreHelpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('optimisticUpdate', () => {
		it('applies updates optimistically and returns API result', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'Original' }]);
			const apiResult = { id: 1, name: 'FromAPI' };
			const apiCall = vi.fn().mockResolvedValue(apiResult);
			const errorRef = ref<string | null>(null);

			const result = await optimisticUpdate({
				items,
				id: 1,
				updates: { name: 'Updated' },
				apiCall,
				errorRef,
				entityLabel: 'Item',
			});

			expect(result).toEqual(apiResult);
			expect(items.value[0]!.name).toBe('FromAPI');
			expect(errorRef.value).toBeNull();
		});

		it('applies updates immediately before API call resolves', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'Original' }]);
			let nameDuringApiCall = '';

			const apiCall = vi.fn().mockImplementation(async () => {
				nameDuringApiCall = items.value[0]!.name;
				return { id: 1, name: 'FromAPI' };
			});

			await optimisticUpdate({
				items,
				id: 1,
				updates: { name: 'Optimistic' },
				apiCall,
				errorRef: ref(null),
				entityLabel: 'Item',
			});

			expect(nameDuringApiCall).toBe('Optimistic');
		});

		it('returns null and sets error when item not found', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'A' }]);
			const errorRef = ref<string | null>(null);

			const result = await optimisticUpdate({
				items,
				id: 999,
				updates: { name: 'X' },
				apiCall: vi.fn(),
				errorRef,
				entityLabel: 'Player',
			});

			expect(result).toBeNull();
			expect(errorRef.value).toBe('Player not found');
		});

		it('calls onSuccess after successful API call', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'A' }]);
			const onSuccess = vi.fn();

			await optimisticUpdate({
				items,
				id: 1,
				updates: { name: 'B' },
				apiCall: vi.fn().mockResolvedValue({ id: 1, name: 'B' }),
				errorRef: ref(null),
				entityLabel: 'Item',
				onSuccess,
			});

			expect(onSuccess).toHaveBeenCalledOnce();
		});

		it('handles update when item is among multiple items', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = createTestItems([
				{ id: 1, name: 'A' },
				{ id: 2, name: 'B' },
				{ id: 3, name: 'C' },
			]);
			const apiResult = { id: 2, name: 'Updated-B' };

			await optimisticUpdate({
				items,
				id: 2,
				updates: { name: 'Updated-B' },
				apiCall: vi.fn().mockResolvedValue(apiResult),
				errorRef: ref(null),
				entityLabel: 'Item',
			});

			expect(items.value[0]!.name).toBe('A');
			expect(items.value[1]!.name).toBe('Updated-B');
			expect(items.value[2]!.name).toBe('C');
		});

		/*
		 * What this helper reports is the failure's own `Error.message`, which for a
		 * `$fetch` failure is the transport's line. Reading the authority's sentence out of
		 * the response body is the caller's job, not this one's — the Event Data lifecycle
		 * wraps every `apiCall` it hands here in `withFailureSentence` for exactly that
		 * reason (#262). Pinning the raw line here is what keeps that division visible.
		 */
		it('rolls the prediction back and reports the failure when the API call is refused', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'Original' }]);
			const errorRef = ref<string | null>(null);

			const result = await optimisticUpdate({
				items,
				id: 1,
				updates: { name: 'Optimistic' },
				apiCall: vi.fn().mockRejectedValue(transportFailure({
					status: 409,
					request: `[PATCH] "/api/items/1"`,
				})),
				errorRef,
				entityLabel: 'Item',
			});

			expect(result).toBeNull();
			expect(items.value[0]!.name).toBe('Original');
			expect(errorRef.value).toBe('[PATCH] "/api/items/1": 409 Conflict');
		});
	});

	describe('optimisticDelete', () => {
		it('removes item and returns true on success', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = createTestItems([
				{ id: 1, name: 'A' },
				{ id: 2, name: 'B' },
			]);
			const errorRef = ref<string | null>(null);

			const result = await optimisticDelete({
				items,
				id: 1,
				apiCall: vi.fn().mockResolvedValue(undefined),
				errorRef,
				entityLabel: 'Item',
			});

			expect(result).toBe(true);
			expect(items.value).toHaveLength(1);
			expect(items.value[0]!.id).toBe(2);
			expect(errorRef.value).toBeNull();
		});

		it('removes item immediately before API resolves', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
			let lengthDuringApiCall = 0;

			const apiCall = vi.fn().mockImplementation(async () => {
				lengthDuringApiCall = items.value.length;
			});

			await optimisticDelete({
				items,
				id: 1,
				apiCall,
				errorRef: ref(null),
				entityLabel: 'Item',
			});

			expect(lengthDuringApiCall).toBe(1);
		});

		it('returns null and sets error when item not found', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'A' }]);
			const errorRef = ref<string | null>(null);

			const result = await optimisticDelete({
				items,
				id: 999,
				apiCall: vi.fn(),
				errorRef,
				entityLabel: 'Round',
			});

			expect(result).toBeNull();
			expect(errorRef.value).toBe('Round not found');
		});

		it('calls onSuccess after successful API call', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = createTestItems([{ id: 1, name: 'A' }]);
			const onSuccess = vi.fn();

			await optimisticDelete({
				items,
				id: 1,
				apiCall: vi.fn().mockResolvedValue(undefined),
				errorRef: ref(null),
				entityLabel: 'Item',
				onSuccess,
			});

			expect(onSuccess).toHaveBeenCalledOnce();
		});

		it('puts a refused delete back where it was, and reports the failure', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = createTestItems([
				{ id: 1, name: 'A' },
				{ id: 2, name: 'B' },
				{ id: 3, name: 'C' },
			]);
			const errorRef = ref<string | null>(null);

			const result = await optimisticDelete({
				items,
				id: 2,
				apiCall: vi.fn().mockRejectedValue(transportFailure({
					status: 409,
					request: `[DELETE] "/api/items/2"`,
				})),
				errorRef,
				entityLabel: 'Item',
			});

			expect(result).toBeNull();
			// Back at its own index, not appended — the operator's list must not reorder
			// itself because a delete was refused.
			expect(items.value.map(item => item.id)).toEqual([1, 2, 3]);
			expect(errorRef.value).toBe('[DELETE] "/api/items/2": 409 Conflict');
		});
	});
});
