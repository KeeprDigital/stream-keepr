import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useForm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('initializes formData from static initialData', () => {
		const { formData } = useForm({ initialData: { name: 'Alice', age: 30 } });
		expect(formData.value).toEqual({ name: 'Alice', age: 30 });
	});

	it('initializes formData from ref initialData', () => {
		const initial = ref({ name: 'Bob', age: 25 });
		const { formData } = useForm({ initialData: initial });
		expect(formData.value).toEqual({ name: 'Bob', age: 25 });
	});

	it('reports isDirty when formData changes', () => {
		const { formData, isDirty } = useForm({ initialData: { name: 'Alice' } });
		expect(isDirty.value).toBe(false);

		formData.value.name = 'Bob';
		expect(isDirty.value).toBe(true);
	});

	it('reports isDirty as false after reset', () => {
		const { formData, isDirty, reset } = useForm({ initialData: { name: 'Alice' } });
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
		const { reset } = useForm({ initialData: { name: '' }, onReset });
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
		const { getChanges } = useForm({ initialData: { name: 'Alice' } });
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
		const initial = { name: 'Alice', meta: { role: 'admin' } };
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
	});
});
