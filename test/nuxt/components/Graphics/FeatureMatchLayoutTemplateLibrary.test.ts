import type { FeatureMatchLayoutTemplateSummary } from '~~/shared/types/featureMatchLayoutTemplate';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

enableAutoUnmount(afterEach);

const mockList = vi.fn();
const mockSave = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockPlace = vi.fn();
const mockReceivePackage = vi.fn();
const mockConfirmPackage = vi.fn();
const mockInstallPackage = vi.fn();

mockNuxtImport('useFeatureMatchLayoutTemplateRepository', () => () => ({
	list: mockList,
	get: vi.fn(),
	save: mockSave,
	update: mockUpdate,
	remove: mockRemove,
	place: mockPlace,
	packageUrl: (templateId: string) =>
		`/api/graphics-templates/feature-match-layouts/${templateId}/template-package`,
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

function summary(overrides: Partial<FeatureMatchLayoutTemplateSummary> = {}): FeatureMatchLayoutTemplateSummary {
	return {
		id: 'template-1',
		name: 'Neon Feature Match',
		description: null,
		revision: 1,
		authored: true,
		itemCount: 6,
		sourceCount: 3,
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
 * Choosing a `.sklayout` the way an author does. The hidden file input is the
 * component's real entry point, so driving it is what proves the button behind it
 * is wired to anything.
 */
async function chooseImportFile(wrapper: { get: (selector: string) => any }) {
	const input = wrapper.get('[data-testid="layout-template-import-input"]');
	const file = new File([new Uint8Array([1, 2, 3])], 'neon-feature-match.sklayout');
	Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
	await input.trigger('change');
	await flushPromises();
}

async function mountLibrary(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/FeatureMatchLayoutTemplateLibrary.vue';
	const { default: TemplateLibrary } = await import(componentPath);

	const wrapper = mount(TemplateLibrary, {
		props: {
			eventId: 7,
			screenId: 3,
			writable: true,
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UAlert: UAlertStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UInput: UInputStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('graphicsFeatureMatchLayoutTemplateLibrary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockList.mockResolvedValue([summary()]);
		mockSave.mockResolvedValue({ ...summary() });
		mockUpdate.mockResolvedValue({ ...summary(), name: 'Renamed' });
		mockPlace.mockResolvedValue({ screen: { id: 3 }, layout: {} });
		mockRemove.mockResolvedValue(undefined);
		mockScreens.value = [{ id: 3, stateVersion: 12 }];
	});

	it('browses the installation library', async () => {
		const wrapper = await mountLibrary();

		expect(mockList).toHaveBeenCalled();
		const entry = wrapper.get('[data-template-id="template-1"]');
		expect(entry.get<HTMLInputElement>('[data-testid="layout-template-name"]').element.value)
			.toBe('Neon Feature Match');
		// Source Items are counted apart from Graphic Items, because they are
		// host-owned and budgeted apart.
		expect(entry.text()).toContain('6 items');
		expect(entry.text()).toContain('3 sources');
	});

	it('saves this Screen\'s layout as a template', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="layout-template-save"]').trigger('click');
		await flushPromises();

		// The Screen is named rather than the layout carried: the server reads the
		// layout the Screen actually holds.
		expect(mockSave).toHaveBeenCalledWith({ eventId: 7, screenId: 3 });
		expect(mockList).toHaveBeenCalledTimes(2);
	});

	/**
	 * Placing replaces the Screen's whole layout and cannot be undone, so it asks
	 * first — and the prompt says what is replaced and what survives, which is the
	 * thing an author most needs before answering.
	 */
	it('asks before replacing the Screen\'s layout, and says what survives', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="layout-template-place"]').trigger('click');
		await flushPromises();

		expect(mockPlace).not.toHaveBeenCalled();
		const confirm = wrapper.get('[data-testid="layout-template-place-confirm"]');
		expect(confirm.text()).toContain('Frame, Source Items');
		expect(confirm.text()).toContain('Feature Match Slot');
	});

	it('places a template once the replacement is confirmed', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="layout-template-place"]').trigger('click');
		await wrapper.get('[data-testid="layout-template-place-confirmed"]').trigger('click');
		await flushPromises();

		// A placement read-modify-writes the Screen, so it must state the version it
		// read or the server has nothing to refuse a stale write against.
		expect(mockPlace).toHaveBeenCalledWith({
			eventId: 7,
			screenId: 3,
			templateId: 'template-1',
			stateVersion: 12,
		});
		// The Screen was written on the server and this client's realtime echo is
		// suppressed, so the authoritative Screen is reloaded.
		expect(mockGetScreenById).toHaveBeenCalledWith(7, 3);
		expect(wrapper.emitted('placed')).toHaveLength(1);
	});

	/**
	 * An imported layout is the Graphics Asset Library's own record. This library
	 * reads it and never writes it, so offering a field that cannot be saved would be
	 * a control that lies.
	 */
	it('offers no rename or delete on a layout a Template Package installed', async () => {
		mockList.mockResolvedValue([summary({ authored: false })]);

		const wrapper = await mountLibrary();

		const entry = wrapper.get('[data-template-id="template-1"]');
		expect(entry.text()).toContain('imported');
		expect(entry.find('[data-testid="layout-template-name"]').exists()).toBe(false);
		expect(entry.find('[data-testid="layout-template-delete"]').exists()).toBe(false);
		// It is still placeable and exportable, which is what a design is for.
		expect(entry.find('[data-testid="layout-template-place"]').exists()).toBe(true);
		expect(entry.find('[data-testid="layout-template-export"]').exists()).toBe(true);
	});

	/**
	 * A session observing a Screen another session's Graphics Authoring Lease covers
	 * still browses the library, because looking corrupts nothing — but every write
	 * is gone, not merely disabled.
	 */
	it('browses but never writes when this session may not author', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(mockList).toHaveBeenCalled();
		expect(wrapper.find('[data-testid="layout-template-save"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="layout-template-import"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="layout-template-place"]').exists()).toBe(false);
	});

	/**
	 * A package carrying warnings pauses exactly once for a confirmation bound to
	 * that exact report. Installing it automatically would accept, on the author's
	 * behalf, the decisions the report exists to put in front of them.
	 */
	it('pauses on a package that needs confirming, and installs only when confirmed', async () => {
		mockReceivePackage.mockResolvedValue(receivedPackage('awaiting-confirmation', {
			outcome: 'requires-confirmation',
			issues: [{ code: 'graphic-asset-name-differs', message: 'A name differs', remediation: 'Review it' }],
		}));
		mockConfirmPackage.mockResolvedValue(receivedPackage('awaiting-installation'));
		mockInstallPackage.mockResolvedValue({ id: 'operation-1', stage: 'completed' });

		const wrapper = await mountLibrary();
		await chooseImportFile(wrapper);

		expect(mockInstallPackage).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="layout-template-import-report"]').text()).toContain('A name differs');

		await wrapper.get('[data-testid="layout-template-import-confirm"]').trigger('click');
		await flushPromises();

		expect(mockConfirmPackage).toHaveBeenCalledWith('operation-1', 'fingerprint-1');
		expect(mockInstallPackage).toHaveBeenCalledWith('operation-1');
	});

	/** A rejection is terminal: it explains itself and offers nothing to install. */
	it('reports a rejected package without offering to install it', async () => {
		mockReceivePackage.mockResolvedValue(receivedPackage('failed', {
			outcome: 'rejected',
			issues: [{
				code: 'unsupported-application-capability',
				message: 'This installation does not provide host-vocabulary "feature-match/source-role/desk"',
				remediation: 'Export from a matching installation',
			}],
		}));

		const wrapper = await mountLibrary();
		await chooseImportFile(wrapper);

		const report = wrapper.get('[data-testid="layout-template-import-report"]');
		expect(report.text()).toContain('cannot be installed');
		expect(report.text()).toContain('feature-match/source-role/desk');
		expect(wrapper.find('[data-testid="layout-template-import-confirm"]').exists()).toBe(false);
	});
});
