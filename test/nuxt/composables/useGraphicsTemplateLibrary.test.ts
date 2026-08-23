import type { GraphicsTemplateSummary } from '~/composables/useGraphicsTemplateLibrary';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

const { mockLoad, mockNavigateTo, mockRoute } = vi.hoisted(() => ({
	mockLoad: vi.fn(),
	mockNavigateTo: vi.fn(),
	mockRoute: { fullPath: '/graphics-assets' },
}));

vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({ load: mockLoad }),
}));

mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('useRoute', () => () => mockRoute);

const repository = {
	list: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	receivePackage: vi.fn(),
	confirmPackage: vi.fn(),
	installPackage: vi.fn(),
};

const canAuthor = ref(true);

function template(overrides: Partial<GraphicsTemplateSummary> = {}): GraphicsTemplateSummary {
	return {
		id: 'template-1',
		name: 'Lower Third',
		description: null,
		revision: 4,
		authored: true,
		...overrides,
	};
}

function operation(overrides: Record<string, unknown> = {}) {
	return {
		id: 'operation-1',
		stage: 'awaiting-installation',
		...overrides,
	} as any;
}

const packageFile = new File(['package-bytes'], 'template.zip');

function mountLibrary() {
	let library!: ReturnType<typeof useGraphicsTemplateLibrary<GraphicsTemplateSummary>>;
	const wrapper = mount(defineComponent({
		setup() {
			library = useGraphicsTemplateLibrary<GraphicsTemplateSummary>({
				repository,
				canAuthor,
				unavailable: 'The Template library could not be read.',
			});
			return () => h('div');
		},
	}));

	return { wrapper, library };
}

async function mountedLibrary() {
	const { library } = mountLibrary();
	await flushPromises();
	return library;
}

describe('useGraphicsTemplateLibrary', () => {
	beforeEach(() => {
		for (const method of Object.values(repository))
			method.mockReset();
		repository.list.mockResolvedValue([template()]);
		canAuthor.value = true;
	});

	it('reads the library on mount', async () => {
		const library = await mountedLibrary();

		expect(repository.list).toHaveBeenCalledTimes(1);
		expect(library.entries.value).toEqual([template()]);
	});

	describe('fail-closed authoring', () => {
		it('refuses every write when this session may not author', async () => {
			canAuthor.value = false;
			const library = await mountedLibrary();

			await library.attempt('template-1', async () => {
				throw new Error('should not run');
			});
			await library.revise(template(), { name: 'Renamed' });
			library.askToRemove('template-1');
			await library.remove('template-1');
			await library.packageImport.receive(packageFile);
			await library.packageImport.confirm();

			expect(repository.update).not.toHaveBeenCalled();
			expect(repository.remove).not.toHaveBeenCalled();
			expect(repository.receivePackage).not.toHaveBeenCalled();
			expect(repository.confirmPackage).not.toHaveBeenCalled();
			expect(library.pendingDeleteId.value).toBeNull();
			expect(library.error.value).toBeNull();
		});

		it('lets only authored entries be revised', async () => {
			const library = await mountedLibrary();

			expect(library.canRevise(template())).toBe(true);
			expect(library.canRevise(template({ authored: false }))).toBe(false);

			canAuthor.value = false;

			expect(library.canRevise(template())).toBe(false);
		});
	});

	describe('attempt', () => {
		it('holds the entry busy while its write is in flight', async () => {
			const library = await mountedLibrary();
			let resolveWork!: () => void;
			const settled = library.attempt('template-1', () => new Promise((resolve) => {
				resolveWork = resolve;
			}));

			expect(library.busyTemplateId.value).toBe('template-1');

			resolveWork();
			await settled;

			expect(library.busyTemplateId.value).toBeNull();
			expect(library.error.value).toBeNull();
		});

		it('reports a refused write in the library\'s one message', async () => {
			const library = await mountedLibrary();

			await library.attempt('template-1', async () => {
				throw transportFailure({ status: 409, body: { message: 'The template has moved on.' } });
			});

			expect(library.error.value).toBe('The template has moved on.');
			expect(library.busyTemplateId.value).toBeNull();
		});
	});

	describe('revise', () => {
		it('states the revision the write was built against and re-reads on success', async () => {
			repository.update.mockResolvedValue(undefined);
			const library = await mountedLibrary();

			await library.revise(template(), { name: 'Renamed' });

			expect(repository.update).toHaveBeenCalledWith('template-1', { name: 'Renamed', revision: 4 });
			expect(repository.list).toHaveBeenCalledTimes(2);
			expect(library.error.value).toBeNull();
		});

		it('keeps the refusal message through the re-read that follows it', async () => {
			repository.update.mockRejectedValue(transportFailure({ status: 409, body: { message: 'The template has moved on.' } }));
			const library = await mountedLibrary();

			await library.revise(template(), { name: 'Renamed' });

			expect(repository.list).toHaveBeenCalledTimes(2);
			expect(library.error.value).toBe('The template has moved on.');
		});
	});

	describe('remove', () => {
		it('asks first: the same entry toggles, a second entry replaces', async () => {
			const library = await mountedLibrary();

			library.askToRemove('template-1');
			expect(library.pendingDeleteId.value).toBe('template-1');

			library.askToRemove('template-1');
			expect(library.pendingDeleteId.value).toBeNull();

			library.askToRemove('template-2');
			expect(library.pendingDeleteId.value).toBe('template-2');

			library.cancelRemove();
			expect(library.pendingDeleteId.value).toBeNull();
		});

		it('clears the pending confirmation and re-reads after a deletion', async () => {
			repository.remove.mockResolvedValue(undefined);
			const library = await mountedLibrary();
			library.askToRemove('template-1');

			await library.remove('template-1');

			expect(repository.remove).toHaveBeenCalledWith('template-1');
			expect(library.pendingDeleteId.value).toBeNull();
			expect(repository.list).toHaveBeenCalledTimes(2);
		});

		it('keeps the pending confirmation when the deletion is refused', async () => {
			repository.remove.mockRejectedValue(transportFailure({ status: 409, body: { message: 'The template is in use.' } }));
			const library = await mountedLibrary();
			library.askToRemove('template-1');

			await library.remove('template-1');

			expect(library.pendingDeleteId.value).toBe('template-1');
			expect(library.error.value).toBe('The template is in use.');
		});
	});

	describe('packageImport', () => {
		it('installs a clean package straight away', async () => {
			repository.receivePackage.mockResolvedValue(operation({ stage: 'awaiting-installation' }));
			repository.installPackage.mockResolvedValue(operation({ stage: 'completed' }));
			const library = await mountedLibrary();

			await library.packageImport.receive(packageFile);

			expect(repository.receivePackage).toHaveBeenCalledWith(packageFile);
			expect(repository.installPackage).toHaveBeenCalledWith('operation-1');
			expect(library.packageImport.reported).toBe(false);
			expect(repository.list).toHaveBeenCalledTimes(2);
		});

		it('holds a rejected report for the author to read', async () => {
			repository.receivePackage.mockResolvedValue(operation({
				stage: 'rejected',
				templatePackagePreflight: {
					outcome: 'rejected',
					issues: [{ code: 'unreadable-archive' }],
				},
			}));
			const library = await mountedLibrary();

			await library.packageImport.receive(packageFile);

			expect(repository.installPackage).not.toHaveBeenCalled();
			expect(library.packageImport.reported).toBe(true);
			expect(library.packageImport.rejected).toBe(true);
			expect(library.packageImport.awaitingConfirmation).toBe(false);
			expect(library.packageImport.issues).toEqual([{ code: 'unreadable-archive' }]);

			library.packageImport.dismiss();

			expect(library.packageImport.reported).toBe(false);
		});

		it('pauses on a report with warnings and installs on the confirmation bound to it', async () => {
			repository.receivePackage.mockResolvedValue(operation({
				stage: 'awaiting-confirmation',
				templatePackagePreflight: {
					outcome: 'accepted-with-warnings',
					issues: [{ code: 'duplicate-content' }],
					fingerprint: 'fingerprint-1',
				},
			}));
			repository.confirmPackage.mockResolvedValue(undefined);
			repository.installPackage.mockResolvedValue(operation({ stage: 'completed' }));
			const library = await mountedLibrary();

			await library.packageImport.receive(packageFile);

			expect(library.packageImport.awaitingConfirmation).toBe(true);
			expect(repository.installPackage).not.toHaveBeenCalled();

			await library.packageImport.confirm();

			expect(repository.confirmPackage).toHaveBeenCalledWith('operation-1', 'fingerprint-1');
			expect(repository.installPackage).toHaveBeenCalledWith('operation-1');
			expect(library.packageImport.reported).toBe(false);
		});

		it('does not confirm a report that carries no fingerprint', async () => {
			repository.receivePackage.mockResolvedValue(operation({
				stage: 'awaiting-confirmation',
				templatePackagePreflight: { outcome: 'accepted-with-warnings', issues: [] },
			}));
			const library = await mountedLibrary();
			await library.packageImport.receive(packageFile);

			await library.packageImport.confirm();

			expect(repository.confirmPackage).not.toHaveBeenCalled();
		});

		it('keeps showing an installation that did not complete', async () => {
			repository.receivePackage.mockResolvedValue(operation({ stage: 'awaiting-installation' }));
			repository.installPackage.mockResolvedValue(operation({ stage: 'failed' }));
			const library = await mountedLibrary();

			await library.packageImport.receive(packageFile);

			expect(library.packageImport.reported).toBe(true);
		});

		it('reports a refused package in the library\'s one message', async () => {
			repository.receivePackage.mockRejectedValue(transportFailure({ status: 507, body: { message: 'The byte store is exhausted.' } }));
			const library = await mountedLibrary();

			await library.packageImport.receive(packageFile);

			expect(library.error.value).toBe('The byte store is exhausted.');
			expect(library.packageImport.busy).toBe(false);
		});

		it('is busy while a package is being received', async () => {
			let resolveReceive!: (value: unknown) => void;
			repository.receivePackage.mockReturnValue(new Promise((resolve) => {
				resolveReceive = resolve;
			}));
			const library = await mountedLibrary();

			const settled = library.packageImport.receive(packageFile);
			expect(library.packageImport.busy).toBe(true);

			resolveReceive(operation({ stage: 'rejected', templatePackagePreflight: { outcome: 'rejected', issues: [] } }));
			await settled;

			expect(library.packageImport.busy).toBe(false);
		});
	});
});
