import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { transportFailure } from '~~/test/helpers/transportFailure';

enableAutoUnmount(afterEach);

const mockList = vi.fn();
const mockSave = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockPlace = vi.fn();
const mockReceivePackage = vi.fn();
const mockConfirmPackage = vi.fn();
const mockInstallPackage = vi.fn();

mockNuxtImport('useBroadcastGraphicTemplateRepository', () => () => ({
	list: mockList,
	get: vi.fn(),
	save: mockSave,
	update: mockUpdate,
	remove: mockRemove,
	place: mockPlace,
	packageUrl: (templateId: string) =>
		`/api/graphics-templates/broadcast-graphics/${templateId}/template-package`,
	receivePackage: mockReceivePackage,
	confirmPackage: mockConfirmPackage,
	installPackage: mockInstallPackage,
}));

const mockGetScreenById = vi.fn();
const mockScreens = ref<Array<{ id: number; stateVersion: number }>>([{ id: 3, stateVersion: 12 }]);

mockNuxtImport('useScreenStore', () => () => ({
	getScreenById: mockGetScreenById,
	get screens() {
		return mockScreens.value;
	},
}));

const ScreenSettingsCardStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<section><h2>{{ title }}</h2><slot /></section>',
});
const UIEmptyStateStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<div data-testid="empty-state">{{ title }}</div>',
});
const UAlertStub = defineComponent({
	props: { title: { type: String, required: false }, description: { type: String, required: false } },
	template: '<div><strong>{{ title }}</strong><span>{{ description }}</span><slot /></div>',
});
const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});
const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, default: '' } },
	emits: ['update:modelValue', 'change', 'blur'],
	template: '<input :value="modelValue" @change="$emit(\'change\', $event)" @blur="$emit(\'blur\', $event)" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<label><span>{{ label }}</span><slot /></label>',
});

const lowerThird: BroadcastGraphicConfig = {
	id: 'placed-lower-third',
	name: 'Lower third',
	items: [],
};

function summary(overrides: Partial<BroadcastGraphicTemplateSummary> = {}): BroadcastGraphicTemplateSummary {
	return {
		id: 'template-1',
		name: 'Lower third',
		description: null,
		revision: 1,
		authored: true,
		itemCount: 4,
		inputCount: 2,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	};
}

/** One Graphics Ingestion Operation carrying a Template Package preflight report. */
function receivedPackage(
	stage: string,
	preflight: Record<string, unknown> = { outcome: 'ready', issues: [] },
): Record<string, unknown> {
	return {
		id: 'operation-1',
		stage,
		templatePackagePreflight: { fingerprint: 'fingerprint-1', ...preflight },
	};
}

/**
 * Choosing a `.skgraphic` the way an author does. The hidden file input is the
 * component's real entry point, so driving it is what proves the button behind it
 * is wired to anything.
 */
async function chooseImportFile(wrapper: { get: (selector: string) => any }) {
	const input = wrapper.get('[data-testid="template-library-import-input"]');
	const file = new File([new Uint8Array([1, 2, 3])], 'lower-third.skgraphic');
	Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
	await input.trigger('change');
	await flushPromises();
}

async function mountLibrary(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/BroadcastGraphicTemplateLibrary.vue';
	const { default: TemplateLibrary } = await import(componentPath);

	const wrapper = mount(TemplateLibrary, {
		props: {
			eventId: 7,
			screenId: 3,
			selectedGraphic: lowerThird,
			writable: true,
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UAlert: UAlertStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				UFormField: UFormFieldStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('graphicsBroadcastGraphicTemplateLibrary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockList.mockResolvedValue([summary()]);
		mockSave.mockResolvedValue({ ...summary(), document: lowerThird });
		mockUpdate.mockResolvedValue({ ...summary(), name: 'Renamed', document: lowerThird });
		mockPlace.mockResolvedValue({
			screen: { id: 3 },
			graphic: { ...lowerThird, id: 'placed-copy' },
		});
		mockRemove.mockResolvedValue(undefined);
		mockScreens.value = [{ id: 3, stateVersion: 12 }];
	});

	it('browses the installation library', async () => {
		const wrapper = await mountLibrary();

		expect(mockList).toHaveBeenCalled();
		const entry = wrapper.get('[data-template-id="template-1"]');
		// An author may rename in place, so the name is an editable field rather than text.
		expect(entry.get<HTMLInputElement>('[data-testid="template-name"]').element.value)
			.toBe('Lower third');
		expect(entry.text()).toContain('4 items');
	});

	it('saves the selected Broadcast Graphic as a template', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-library-save"]').trigger('click');
		await flushPromises();

		expect(mockSave).toHaveBeenCalledWith({ eventId: 7, screenId: 3, graphicId: 'placed-lower-third' });
		// The library is re-read, so the author sees the entry they just created.
		expect(mockList).toHaveBeenCalledTimes(2);
	});

	it('offers no save while no Broadcast Graphic is selected', async () => {
		const wrapper = await mountLibrary({ selectedGraphic: null });

		expect(wrapper.get('[data-testid="template-library-save"]').attributes('disabled')).toBeDefined();
	});

	it('places a template and reports the copy it created', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-place"]').trigger('click');
		await flushPromises();

		// A placement read-modify-writes the Screen's whole stack, so it must state the
		// version it read or the server has nothing to refuse a stale write against.
		expect(mockPlace).toHaveBeenCalledWith({
			eventId: 7,
			screenId: 3,
			templateId: 'template-1',
			stateVersion: 12,
		});
		// The Screen was written server-side, so the authoritative Screen is reloaded
		// rather than guessed at.
		expect(mockGetScreenById).toHaveBeenCalledWith(7, 3);
		expect(wrapper.emitted('placed')).toEqual([['placed-copy']]);
	});

	it('renames a template in the library', async () => {
		const wrapper = await mountLibrary();

		const input = wrapper.get('[data-testid="template-name"]');
		await input.setValue('Main show lower third');
		await flushPromises();

		expect(mockUpdate).toHaveBeenCalledWith('template-1', {
			name: 'Main show lower third',
			revision: 1,
		});
	});

	it('asks before removing a template, and removes it once confirmed', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-delete"]').trigger('click');
		await flushPromises();

		// Deleting a design is irreversible, so the first click asks. The prompt says
		// what an author most needs to know: placed copies survive.
		const prompt = wrapper.get('[data-testid="template-delete-confirm"]');
		expect(prompt.text()).toContain('cannot be undone');
		expect(prompt.text()).toContain('not affected');
		expect(mockRemove).not.toHaveBeenCalled();

		await wrapper.get('[data-testid="template-delete-confirmed"]').trigger('click');
		await flushPromises();

		expect(mockRemove).toHaveBeenCalledWith('template-1');
	});

	it('abandons a deletion that is cancelled', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-delete"]').trigger('click');
		await wrapper.get('[data-testid="template-delete-cancelled"]').trigger('click');
		await flushPromises();

		expect(wrapper.find('[data-testid="template-delete-confirm"]').exists()).toBe(false);
		expect(mockRemove).not.toHaveBeenCalled();
	});

	it('describes a template, and clears an emptied description', async () => {
		const wrapper = await mountLibrary();

		const field = wrapper.get('[data-testid="template-description"]');
		await field.setValue('Main show, both casters');
		await flushPromises();

		expect(mockUpdate).toHaveBeenCalledWith('template-1', {
			description: 'Main show, both casters',
			revision: 1,
		});

		mockList.mockResolvedValue([summary({ description: 'Main show, both casters' })]);
		const described = await mountLibrary();
		const clearing = described.get('[data-testid="template-description"]');
		await clearing.setValue('   ');
		await flushPromises();

		// An emptied field clears the description rather than storing whitespace.
		expect(mockUpdate).toHaveBeenLastCalledWith('template-1', { description: null, revision: 1 });
	});

	it('re-reads the library when a revision is refused as stale', async () => {
		mockUpdate.mockRejectedValue(transportFailure({
			status: 409,
			body: { message: 'Broadcast Graphic Template has been revised by another session (now revision 4)' },
			request: `[PATCH] "/api/graphics-templates/broadcast-graphics/template-1"`,
		}));
		const wrapper = await mountLibrary();

		const input = wrapper.get('[data-testid="template-name"]');
		await input.setValue('Renamed against a stale revision');
		await flushPromises();

		expect(wrapper.get('[data-testid="template-library-error"]').text())
			.toContain('revised by another session');
		// Re-read, so the author is looking at the revision that actually exists before
		// they try again.
		// One edit, one write, and one re-read: the library is re-listed so the author is
		// looking at the revision that actually exists before trying again.
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledTimes(2);
	});

	/**
	 * The 5xx half of what a library says about a failure.
	 *
	 * This server rewrites an unmapped 5xx body message to 'Internal Server Error' on the
	 * way out, so quoting one back would put a placeholder in front of an author dressed
	 * as the authority's own words. The transport line at least reads as machinery (#262).
	 */
	it('does not read a sanitized 5xx body back to the author as though it were a refusal', async () => {
		mockUpdate.mockRejectedValue(transportFailure({
			status: 500,
			body: { message: 'Internal Server Error' },
			request: `[PATCH] "/api/graphics-templates/broadcast-graphics/template-1"`,
		}));
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-name"]').setValue('Renamed into a server fault');
		await flushPromises();

		const reported = wrapper.get('[data-testid="template-library-error"]').text();
		expect(reported).toContain('500 Internal Server Error');
		expect(reported).toContain('[PATCH]');
	});

	it('browses read-only without offering any authoring action', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(wrapper.get('[data-template-id="template-1"]').text()).toContain('Lower third');
		expect(wrapper.find('[data-testid="template-library-save"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-place"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-delete"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-name"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-description"]').exists()).toBe(false);
	});

	it('reports a refused placement instead of leaving the author guessing', async () => {
		mockPlace.mockRejectedValue(transportFailure({
			status: 409,
			body: { message: 'Another session holds the Graphics Authoring Lease' },
		}));
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-place"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="template-library-error"]').text())
			.toContain('Another session holds the Graphics Authoring Lease');
		expect(wrapper.emitted('placed')).toBeUndefined();
	});

	it('shows an empty library as empty rather than as an error', async () => {
		mockList.mockResolvedValue([]);
		const wrapper = await mountLibrary();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No Broadcast Graphic Templates');
	});

	it('offers each design as a Template Package an author can take away', async () => {
		const wrapper = await mountLibrary();

		expect(wrapper.get('[data-testid="template-export"]').attributes('to'))
			.toBe('/api/graphics-templates/broadcast-graphics/template-1/template-package');
	});

	/**
	 * A Template Package import is a Graphics Ingestion Operation like any other, so
	 * it is refused the same way when the graphics author session behind it has
	 * lapsed — and it is the import that pauses for a confirmation, which makes this
	 * the surface most likely to still be open when a session runs out. It must name
	 * the lapse rather than repeat the server's sentence about a session it cannot
	 * explain, and offer the one action that helps.
	 */
	it('names a lapsed graphics author session when an import is refused', async () => {
		mockReceivePackage.mockRejectedValue(
			Object.assign(new Error('An authenticated graphics author session is required'), {
				statusCode: 401,
			}),
		);
		const wrapper = await mountLibrary();

		await chooseImportFile(wrapper);

		const reported = wrapper.get('[data-testid="template-library-error"]');
		expect(reported.text()).toContain('Your graphics author session has lapsed');
		expect(wrapper.find('[data-testid="reusable-library-reload"]').exists()).toBe(true);
	});

	/**
	 * The other half of the same rule. A refusal that is not a lapse must keep its own
	 * message: announcing a lapse for every failure would be the same defect with a
	 * friendlier sentence.
	 */
	it('leaves an ordinary refusal saying what it said', async () => {
		mockReceivePackage.mockRejectedValue(transportFailure({
			status: 422,
			body: { message: 'The Template Package is not a readable archive' },
		}));
		const wrapper = await mountLibrary();

		await chooseImportFile(wrapper);

		const reported = wrapper.get('[data-testid="template-library-error"]');
		expect(reported.text()).toContain('not a readable archive');
		expect(reported.text()).not.toContain('lapsed');
		expect(wrapper.find('[data-testid="reusable-library-reload"]').exists()).toBe(false);
	});

	it('installs a clean Template Package without asking anything', async () => {
		mockReceivePackage.mockResolvedValue(receivedPackage('awaiting-installation'));
		mockInstallPackage.mockResolvedValue({ ...receivedPackage('completed'), stage: 'completed' });
		const wrapper = await mountLibrary();

		await chooseImportFile(wrapper);

		expect(mockReceivePackage).toHaveBeenCalled();
		expect(mockInstallPackage).toHaveBeenCalledWith('operation-1');
		expect(mockConfirmPackage).not.toHaveBeenCalled();
		// The imported design is a library entry, so the library is re-read to show it.
		expect(mockList).toHaveBeenCalledTimes(2);
		expect(wrapper.find('[data-testid="template-library-import-report"]').exists()).toBe(false);
	});

	/**
	 * Warnings pause an import exactly once, and the pause is the point: the author
	 * is accepting a specific proposal — this content already exists here under
	 * another name — rather than approving "import" in the abstract.
	 */
	it('pauses on a proposal carrying warnings until the author accepts it', async () => {
		mockReceivePackage.mockResolvedValue(receivedPackage('awaiting-confirmation', {
			outcome: 'requires-confirmation',
			issues: [{
				code: 'graphic-asset-created-from-shared-content',
				severity: 'warning',
				message: '"Backdrop" carries content this installation already stores as "Bug"',
				remediation: 'Install it as a separate Graphic Asset, or cancel and reuse the existing one.',
				retryable: false,
			}],
		}));
		mockConfirmPackage.mockResolvedValue(receivedPackage('awaiting-installation'));
		mockInstallPackage.mockResolvedValue({ ...receivedPackage('completed'), stage: 'completed' });
		const wrapper = await mountLibrary();

		await chooseImportFile(wrapper);

		expect(mockInstallPackage).not.toHaveBeenCalled();
		const report = wrapper.get('[data-testid="template-library-import-report"]');
		expect(report.text()).toContain('already stores as "Bug"');

		await wrapper.get('[data-testid="template-library-import-confirm"]').trigger('click');
		await flushPromises();

		// The confirmation names the exact report it accepted, never the operation alone.
		expect(mockConfirmPackage).toHaveBeenCalledWith('operation-1', 'fingerprint-1');
		expect(mockInstallPackage).toHaveBeenCalledWith('operation-1');
	});

	/**
	 * A rejected package is terminal and there is nothing to accept, so the report is
	 * shown with every reason at once and no way to install it anyway.
	 */
	it('reports a rejected Template Package without offering to install it', async () => {
		mockReceivePackage.mockResolvedValue(receivedPackage('failed', {
			outcome: 'rejected',
			issues: [{
				code: 'unsupported-application-capability',
				severity: 'error',
				message: 'This installation does not provide graphic-item-definition "media" at configuration version 2',
				remediation: 'Replace it with a supported one before exporting.',
				retryable: false,
			}],
		}));
		const wrapper = await mountLibrary();

		await chooseImportFile(wrapper);

		const report = wrapper.get('[data-testid="template-library-import-report"]');
		expect(report.text()).toContain('configuration version 2');
		expect(wrapper.find('[data-testid="template-library-import-confirm"]').exists()).toBe(false);
		expect(mockInstallPackage).not.toHaveBeenCalled();
		expect(mockConfirmPackage).not.toHaveBeenCalled();
	});

	it('offers no import while this session may only observe', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(wrapper.find('[data-testid="template-library-import"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-export"]').exists()).toBe(false);
	});

	/**
	 * An imported design is the Graphics Asset Library's own record of what a
	 * Template Package published, and this library reads it rather than writing it.
	 * Offering a name field or a delete would be a control that cannot save, so the
	 * component offers only what actually works on one: place, and export.
	 */
	it('offers an imported design only what can be done to it', async () => {
		mockList.mockResolvedValue([summary({
			id: 'installed-1',
			authored: false,
			provenance: { sourceTemplateIdentity: 'template-elsewhere', sourceTemplateRevision: 3 },
		})]);
		const wrapper = await mountLibrary();

		const entry = wrapper.get('[data-template-id="installed-1"]');
		expect(entry.text()).toContain('imported');
		expect(entry.find('[data-testid="template-name"]').exists()).toBe(false);
		expect(entry.find('[data-testid="template-description"]').exists()).toBe(false);
		expect(entry.find('[data-testid="template-delete"]').exists()).toBe(false);
		// Still a design, so it still places and still travels.
		expect(entry.find('[data-testid="template-place"]').exists()).toBe(true);
		expect(entry.find('[data-testid="template-export"]').exists()).toBe(true);
	});
});
