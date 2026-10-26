import { describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { transportFailure } from '~~/test/helpers/transportFailure';

// `useAsyncAction` runs for real: these are its optimistic update and rollback flows (#263).

interface TestItem { id: number; name: string }

/**
 * The sentence the authority wrote about a refused write. This helper reports the transport
 * line, not the sentence: reading the sentence is the caller's job (`withFailureSentence`,
 * #262, #288), so each refusal asserts the sentence is *not* what it reports.
 */
const REFUSAL_SENTENCE = 'This Item belongs to a Round that has already been played';

function refusal(method: string, path: string) {
	return transportFailure({
		status: 409,
		request: `[${method}] "${path}"`,
		body: { statusCode: 409, statusMessage: 'Conflict', message: REFUSAL_SENTENCE },
	});
}

function itemsOf(...names: string[]) {
	return ref<TestItem[]>(names.map((name, i) => ({ id: i + 1, name })));
}

describe('useStoreHelpers', () => {
	describe('optimisticUpdate', () => {
		it('shows the prediction while the call is pending, then the authority\'s answer', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = itemsOf('A', 'B', 'C');
			const call = deferred<TestItem>();
			const onSuccess = vi.fn();
			const errorRef = ref<string | null>(null);

			const result = optimisticUpdate({
				items,
				id: 2,
				updates: { name: 'Predicted' },
				apiCall: () => call.promise,
				errorRef,
				entityLabel: 'Item',
				onSuccess,
			});
			expect(items.value.map(item => item.name)).toEqual(['A', 'Predicted', 'C']);

			call.resolve({ id: 2, name: 'From API' });

			await expect(result).resolves.toEqual({ id: 2, name: 'From API' });
			expect(items.value.map(item => item.name)).toEqual(['A', 'From API', 'C']);
			expect(onSuccess).toHaveBeenCalledOnce();
			expect(errorRef.value).toBeNull();
		});

		it('rolls the prediction back and reports the failure when the call is refused', async () => {
			const { optimisticUpdate } = useStoreHelpers();
			const items = itemsOf('Original');
			const errorRef = ref<string | null>(null);

			const result = await optimisticUpdate({
				items,
				id: 1,
				updates: { name: 'Predicted' },
				apiCall: vi.fn().mockRejectedValue(refusal('PATCH', '/api/items/1')),
				errorRef,
				entityLabel: 'Item',
			});

			expect(result).toBeNull();
			expect(items.value[0]!.name).toBe('Original');
			expect(errorRef.value).toBe('[PATCH] "/api/items/1": 409 Conflict');
			expect(errorRef.value).not.toBe(REFUSAL_SENTENCE);
		});
	});

	describe('optimisticDelete', () => {
		it('removes the item while the call is pending, and keeps it removed', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = itemsOf('A', 'B');
			const call = deferred();
			const onSuccess = vi.fn();

			const result = optimisticDelete({
				items,
				id: 1,
				apiCall: () => call.promise,
				errorRef: ref(null),
				entityLabel: 'Item',
				onSuccess,
			});
			expect(items.value.map(item => item.id)).toEqual([2]);

			call.resolve();

			await expect(result).resolves.toBe(true);
			expect(items.value.map(item => item.id)).toEqual([2]);
			expect(onSuccess).toHaveBeenCalledOnce();
		});

		it('puts a refused delete back at its own index, and reports the failure', async () => {
			const { optimisticDelete } = useStoreHelpers();
			const items = itemsOf('A', 'B', 'C');
			const errorRef = ref<string | null>(null);

			const result = await optimisticDelete({
				items,
				id: 2,
				apiCall: vi.fn().mockRejectedValue(refusal('DELETE', '/api/items/2')),
				errorRef,
				entityLabel: 'Item',
			});

			expect(result).toBeNull();
			expect(items.value.map(item => item.id)).toEqual([1, 2, 3]);
			expect(errorRef.value).toBe('[DELETE] "/api/items/2": 409 Conflict');
			expect(errorRef.value).not.toBe(REFUSAL_SENTENCE);
		});
	});

	it.each([
		['optimisticUpdate', 'Player'],
		['optimisticDelete', 'Round'],
	] as const)('%s reports an item it does not hold, without calling the authority', async (helper, entityLabel) => {
		const helpers = useStoreHelpers();
		const apiCall = vi.fn();
		const errorRef = ref<string | null>(null);

		const result = await (helpers[helper] as (options: object) => Promise<unknown>)({
			items: itemsOf('A'),
			id: 999,
			updates: {},
			apiCall,
			errorRef,
			entityLabel,
		});

		expect(result).toBeNull();
		expect(errorRef.value).toBe(`${entityLabel} not found`);
		expect(apiCall).not.toHaveBeenCalled();
	});
});
