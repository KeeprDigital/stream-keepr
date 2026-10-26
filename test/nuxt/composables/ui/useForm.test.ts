import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useForm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('initializes formData from static initialData', () => {
		const { formData } = useForm({
			initialData: { name: 'Alice', age: 30 },
		});
		expect(formData.value).toEqual({ name: 'Alice', age: 30 });
	});

	it('initializes formData from ref initialData', () => {
		const initial = ref({ name: 'Bob', age: 25 });
		const { formData } = useForm({ initialData: initial });
		expect(formData.value).toEqual({ name: 'Bob', age: 25 });
	});

	it('reports isDirty when formData changes', () => {
		const { formData, isDirty } = useForm({
			initialData: { name: 'Alice' },
		});
		expect(isDirty.value).toBe(false);

		formData.value.name = 'Bob';
		expect(isDirty.value).toBe(true);
	});

	it('reports isDirty as false after reset', () => {
		const { formData, isDirty, reset } = useForm({
			initialData: { name: 'Alice' },
		});
		formData.value.name = 'Bob';
		expect(isDirty.value).toBe(true);

		reset();
		expect(isDirty.value).toBe(false);
		expect(formData.value.name).toBe('Alice');
	});

	it('clears clearOnReset ref on reset', () => {
		const errors = ref({ name: 'required' });
		const { formData, reset } = useForm({
			initialData: { name: '' },
			clearOnReset: errors,
		});
		formData.value.name = 'test';
		reset();
		expect(errors.value).toEqual({});
	});

	it('calls onReset callback', () => {
		const onReset = vi.fn();
		const { reset } = useForm({
			initialData: { name: '' },
			onReset,
		});
		reset();
		expect(onReset).toHaveBeenCalledOnce();
	});

	it('getChanges returns only changed fields', () => {
		const { formData, getChanges } = useForm({
			initialData: { name: 'Alice', age: 30, email: 'a@b.com' },
		});

		formData.value.name = 'Bob';
		const changes = getChanges();
		expect(changes).toEqual({ name: 'Bob' });
	});

	it('getChanges returns empty object when no changes', () => {
		const { getChanges } = useForm({
			initialData: { name: 'Alice' },
		});
		expect(getChanges()).toEqual({});
	});

	it('updateOriginal updates both formData and originalFormData', () => {
		const { formData, originalFormData, isDirty, updateOriginal } = useForm({
			initialData: { name: 'Alice' },
		});

		updateOriginal({ name: 'Bob' });
		expect(formData.value.name).toBe('Bob');
		expect(originalFormData.value.name).toBe('Bob');
		expect(isDirty.value).toBe(false);
	});

	it('deep clones initial data to prevent reference sharing', () => {
		const initial = {
			name: 'Alice',
			meta: { role: 'admin' },
		};
		const { formData, originalFormData } = useForm({ initialData: initial });

		formData.value.meta.role = 'user';
		expect(originalFormData.value.meta.role).toBe('admin');
	});

	describe('ref initialData watcher', () => {
		it('syncs formData when form is clean and initialData changes', async () => {
			const initial = ref({ name: 'Alice' });
			const { formData, isDirty } = useForm({ initialData: initial });

			initial.value = { name: 'Bob' };
			await nextTick();

			expect(formData.value.name).toBe('Bob');
			expect(isDirty.value).toBe(false);
		});

		it('reset clears dirty state after initialData changed while dirty', async () => {
			const initial = ref({ name: 'Alice' });
			const { formData, isDirty, reset } = useForm({ initialData: initial });

			// Simulate: user edits form, then external data changes (like store mutation)
			formData.value.name = 'Charlie';
			expect(isDirty.value).toBe(true);

			initial.value = { name: 'Charlie' };
			await nextTick();

			// Even though formData and initialData now structurally match,
			// the watcher did not sync formData because wasClean was false.
			// originalFormData was updated to {name: 'Charlie'}, and formData
			// is also {name: 'Charlie'}, so isDirty should be false.
			expect(isDirty.value).toBe(false);

			// But if they diverge, reset should bring them back in sync
			formData.value.name = 'Dave';
			expect(isDirty.value).toBe(true);

			reset();
			expect(isDirty.value).toBe(false);
			expect(formData.value.name).toBe('Charlie');
		});

		it('takes a remote change to a field the dirty form left untouched (#612)', async () => {
			const initial = ref({ commentator1TalentId: 1, commentator2TalentId: 2 });
			const { formData, getChanges } = useForm({ initialData: initial });

			formData.value.commentator1TalentId = 3;
			initial.value = { commentator1TalentId: 1, commentator2TalentId: 4 };
			await nextTick();

			expect(formData.value).toEqual({ commentator1TalentId: 3, commentator2TalentId: 4 });
			expect(getChanges()).toEqual({ commentator1TalentId: 3 });
		});

		it('keeps a local edit over a conflicting remote change to the same field, still as a change', async () => {
			const initial = ref({ commentator1TalentId: 1, commentator2TalentId: 2 });
			const { formData, isDirty, getChanges } = useForm({ initialData: initial });

			formData.value.commentator1TalentId = 3;
			initial.value = { commentator1TalentId: 5, commentator2TalentId: 2 };
			await nextTick();

			expect(formData.value.commentator1TalentId).toBe(3);
			expect(isDirty.value).toBe(true);
			expect(getChanges()).toEqual({ commentator1TalentId: 3 });
		});

		it('stops counting a local edit once the remote value matches it', async () => {
			const initial = ref({ commentator1TalentId: 1, commentator2TalentId: 2 });
			const { formData, isDirty, getChanges } = useForm({ initialData: initial });

			formData.value.commentator1TalentId = 3;
			initial.value = { commentator1TalentId: 3, commentator2TalentId: 4 };
			await nextTick();

			expect(formData.value).toEqual({ commentator1TalentId: 3, commentator2TalentId: 4 });
			expect(isDirty.value).toBe(false);
			expect(getChanges()).toEqual({});
		});

		it('merges nested objects per key, so a submitted object carries the remote sibling', async () => {
			const initial = ref({
				player1Data: { name: 'Alice', deckName: 'Burn' },
			});
			const { formData, getChanges } = useForm({ initialData: initial });

			formData.value.player1Data.name = 'Alicia';
			initial.value = {
				player1Data: { name: 'Alice', deckName: 'Control' },
			};
			await nextTick();

			expect(getChanges()).toEqual({
				player1Data: { name: 'Alicia', deckName: 'Control' },
			});
		});

		it('treats an edited array as one value and keeps it whole', async () => {
			const initial = ref({
				tags: ['a', 'b'],
				title: 'x',
			});
			const { formData, getChanges } = useForm({ initialData: initial });

			formData.value.tags.push('c');
			initial.value = {
				tags: ['a', 'z'],
				title: 'y',
			};
			await nextTick();

			expect(formData.value).toEqual({
				tags: ['a', 'b', 'c'],
				title: 'y',
			});
			expect(getChanges()).toEqual({
				tags: ['a', 'b', 'c'],
			});
		});

		it('merges rows carrying an id one row at a time', async () => {
			const initial = ref([
				{ id: 1, name: 'Alice', handle: 'a' },
				{ id: 2, name: 'Briony', handle: 'b' },
				{ id: 3, name: 'Caspar', handle: 'c' },
				{ id: 4, name: 'Dana', handle: 'd' },
			]);
			const { formData } = useForm({ initialData: initial });

			formData.value[0]!.name = 'Alicia';
			formData.value.splice(1, 1);
			formData.value.push({ name: 'Elias', handle: 'e' } as any);
			initial.value = [
				{ id: 1, name: 'Alice', handle: 'a2' },
				{ id: 2, name: 'Briony', handle: 'b' },
				{ id: 3, name: 'Caspar', handle: 'c2' },
				{ id: 5, name: 'Farah', handle: 'f' },
			];
			await nextTick();

			expect(formData.value).toEqual([
				{ id: 1, name: 'Alicia', handle: 'a2' },
				{ id: 3, name: 'Caspar', handle: 'c2' },
				{ name: 'Elias', handle: 'e' },
				{ id: 5, name: 'Farah', handle: 'f' },
			]);
		});

		it('keeps a row edited locally that a colleague removed', async () => {
			const initial = ref([
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Briony' },
			]);
			const { formData } = useForm({ initialData: initial });

			formData.value[0]!.name = 'Alicia';
			initial.value = [];
			await nextTick();

			expect(formData.value).toEqual([
				{ id: 1, name: 'Alicia' },
			]);
		});

		it('takes remote changes while a save is in flight and settles clean on its answer', async () => {
			const initial = ref({ commentator1TalentId: 1, commentator2TalentId: 2 });
			const { formData, isDirty, getChanges } = useForm({ initialData: initial });

			formData.value.commentator1TalentId = 3;
			// Submit: the store applies the change optimistically
			initial.value = { commentator1TalentId: 3, commentator2TalentId: 2 };
			await nextTick();
			// A colleague's change lands while the request is in flight
			initial.value = { commentator1TalentId: 3, commentator2TalentId: 4 };
			await nextTick();

			expect(formData.value).toEqual({ commentator1TalentId: 3, commentator2TalentId: 4 });
			expect(getChanges()).toEqual({});

			// The server's answer merges into the store
			initial.value = { commentator1TalentId: 3, commentator2TalentId: 4 };
			await nextTick();
			expect(isDirty.value).toBe(false);
		});

		it('keeps an edit made while a save is in flight', async () => {
			const initial = ref({ commentator1TalentId: 1, commentator2TalentId: 2 });
			const { formData, getChanges } = useForm({ initialData: initial });

			formData.value.commentator1TalentId = 3;
			initial.value = { commentator1TalentId: 3, commentator2TalentId: 2 };
			await nextTick();
			formData.value.commentator2TalentId = 5;
			initial.value = { commentator1TalentId: 3, commentator2TalentId: 4 };
			await nextTick();

			expect(formData.value).toEqual({ commentator1TalentId: 3, commentator2TalentId: 5 });
			expect(getChanges()).toEqual({ commentator2TalentId: 5 });
		});
	});

	describe('runSave', () => {
		/** A store that answers a save the way the real ones do: it holds `stored` before resolving. */
		function storeAnswering<T>(initial: Ref<T>, stored: T, succeeded = true) {
			return async () => {
				initial.value = stored;
				return succeeded;
			};
		}

		it('settles a submitted value on the normalized one the save stored', async () => {
			const initial = ref({ name: 'Alice', pronouns: 'she/her' as string | null });
			const { formData, isDirty, runSave } = useForm({ initialData: initial });

			formData.value.name = 'Alicia ';
			formData.value.pronouns = '';
			await runSave(storeAnswering(initial, { name: 'Alicia', pronouns: null }));

			expect(formData.value).toEqual({ name: 'Alicia', pronouns: null });
			expect(isDirty.value).toBe(false);
		});

		it('keeps a value edited while the save was in flight', async () => {
			const initial = ref({ name: 'Alice', lgs: 'Shop' });
			const { formData, getChanges, runSave } = useForm({ initialData: initial });

			formData.value.name = 'Alicia ';
			await runSave(async () => {
				formData.value.lgs = 'Other Shop';
				initial.value = { name: 'Alicia', lgs: 'Shop' };
				return true;
			});

			expect(formData.value).toEqual({ name: 'Alicia', lgs: 'Other Shop' });
			expect(getChanges()).toEqual({ lgs: 'Other Shop' });
		});

		it('leaves the form as it is when the save fails', async () => {
			const initial = ref({ name: 'Alice' });
			const { formData, isDirty, runSave } = useForm({ initialData: initial });

			formData.value.name = 'Alicia ';
			const result = await runSave(storeAnswering(initial, { name: 'Alice' }, false));

			expect(result).toBe(false);
			expect(formData.value).toEqual({ name: 'Alicia ' });
			expect(isDirty.value).toBe(true);
		});

		it('keeps the form as it is when the save never reached the baseline', async () => {
			const initial = ref({ name: 'Alice' });
			const { formData, runSave } = useForm({ initialData: initial });

			formData.value.name = 'Alicia ';
			await runSave(async () => true);

			expect(formData.value).toEqual({ name: 'Alicia ' });
		});

		it('takes a colleague\'s change that landed after the save', async () => {
			const initial = ref({ name: 'Alice' });
			const { formData, isDirty, runSave } = useForm({ initialData: initial });

			formData.value.name = 'Alicia ';
			await runSave(storeAnswering(initial, { name: 'Briony' }));

			expect(formData.value).toEqual({ name: 'Briony' });
			expect(isDirty.value).toBe(false);
		});
	});
	it('compares nested objects regardless of key order', async () => {
		const initial = ref({
			player: { name: 'Alice', lgs: undefined as string | undefined, archetypeId: undefined as number | undefined },
		});
		const { formData, isDirty } = useForm({ initialData: initial });

		formData.value.player = { name: 'Bob', lgs: 'Shop' } as typeof formData.value.player;
		// The merge appends a key the baseline added after the local ones; the
		// baseline holds it before `lgs`.
		initial.value = {
			player: { name: 'Bob', archetypeId: 7, lgs: 'Shop' },
		};
		await nextTick();

		expect(Object.keys(formData.value.player)).toEqual(['name', 'lgs', 'archetypeId']);
		expect(isDirty.value).toBe(false);
	});
});
