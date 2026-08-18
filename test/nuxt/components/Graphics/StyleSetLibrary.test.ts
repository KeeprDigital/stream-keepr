import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetResponse, GraphicStyleSetSummary } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleSetPackagePreflightReport } from '~~/shared/types/graphicStyleSetPackage';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { GRAPHIC_STYLE_SET_PACKAGE_LIMITS } from '~~/shared/types/graphicStyleSetPackage';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * The Graphic Style Set library as an author operates it.
 *
 * The rules under test are the ones that make a shared style safe to change: linking
 * adopts nothing, publishing reports which templates it reaches without writing one,
 * an unpublished Style Set cannot be linked to, and unlinking keeps every value the
 * Style Set produced.
 */

enableAutoUnmount(afterEach);

const mockList = vi.fn();
const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockPublish = vi.fn();
const mockDeleteEntry = vi.fn();
const mockRemove = vi.fn();
const mockInspectPackage = vi.fn();
const mockInstallPackage = vi.fn();

mockNuxtImport('useGraphicStyleSetRepository', () => () => ({
	list: mockList,
	get: mockGet,
	create: mockCreate,
	update: mockUpdate,
	publish: mockPublish,
	deleteEntry: mockDeleteEntry,
	remove: mockRemove,
	reviewTemplateUpdate: vi.fn(),
	applyTemplateUpdate: vi.fn(),
	packageUrl: (styleSetId: string) => `/api/graphics-style-sets/${styleSetId}/package`,
	inspectPackage: mockInspectPackage,
	installPackage: mockInstallPackage,
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
	props: { modelValue: { type: [String, Number], default: '' } },
	emits: ['update:modelValue', 'change'],
	template: '<input :value="modelValue" @change="$emit(\'change\', $event)" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
const USelectStub = defineComponent({
	name: 'USelect',
	props: { modelValue: { type: [String, Number, Boolean], default: undefined } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
});
const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, default: false } },
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
});
const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<label><span>{{ label }}</span><slot /></label>',
});

const lowerThird: BroadcastGraphicConfig = {
	id: 'placed-lower-third',
	name: 'Lower third',
	items: [
		{
			type: 'text',
			id: 'headline',
			label: 'Headline',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 60,
			text: 'Now playing',
			typography: {
				font: { kind: 'application', fontId: 'inter' },
				fontSize: 64,
				fontWeight: 800,
				fontStyle: 'normal',
				textTransform: 'uppercase',
				letterSpacing: 2,
				lineHeight: 1,
				textAlign: 'left',
				color: '#ff0044',
			},
			overflowPolicy: 'shrink',
			minFontSize: 24,
			styleRefs: { typography: { entryId: 'heading' } },
		},
	],
	styleSet: { styleSetId: 'style-1', revision: 3 },
};

function summary(overrides: Partial<GraphicStyleSetSummary> = {}): GraphicStyleSetSummary {
	return {
		id: 'style-1',
		name: 'Show style',
		description: null,
		revision: 3,
		draftRevision: 9,
		entryCount: 5,
		hasUnpublishedChanges: false,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	};
}

function response(overrides: Partial<GraphicStyleSetResponse> = {}): GraphicStyleSetResponse {
	const brand = {
		id: 'brand',
		kind: 'palette' as const,
		name: 'Brand',
		schemaVersion: 1,
		value: { color: '#ff0044' },
	};
	return { ...summary(), draft: [brand], published: [brand], ...overrides };
}

function preflightReport(
	overrides: Partial<GraphicStyleSetPackagePreflightReport> = {},
): GraphicStyleSetPackagePreflightReport {
	return {
		packageKind: 'skstyle',
		checkedAt: '2026-07-31T00:00:00.000Z',
		fingerprint: 'a'.repeat(64),
		schema: { received: 1, supported: 1, migrated: false },
		provenance: { sourceStyleSetId: 'style-1', sourceRevision: 3, contentDigest: 'b'.repeat(64) },
		styleSetName: 'Show style',
		styleSetEntryCount: 1,
		resolution: 'preserve-identity',
		disposition: 'install-new',
		affectedTemplates: [],
		publishIssues: [],
		issues: [],
		limits: GRAPHIC_STYLE_SET_PACKAGE_LIMITS,
		observed: { archiveByteLength: 512, archiveEntryCount: 2, expandedByteLength: 400 },
		outcome: 'ready',
		...overrides,
	};
}

/** A `.skstyle` archive as the file picker hands one over. */
function packageFile() {
	return new File([new Uint8Array([1, 2, 3])], 'show-style.skstyle');
}

async function choosePackage(wrapper: Awaited<ReturnType<typeof mountLibrary>>) {
	const input = wrapper.get<HTMLInputElement>('[data-testid="style-set-import-input"]');
	Object.defineProperty(input.element, 'files', { value: [packageFile()], configurable: true });
	await input.trigger('change');
	await flushPromises();
}

async function mountLibrary(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/StyleSetLibrary.vue';
	const { default: StyleSetLibrary } = await import(componentPath);

	const wrapper = mount(StyleSetLibrary, {
		props: { selectedGraphic: lowerThird, writable: true, ...props },
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UAlert: UAlertStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				USelect: USelectStub,
				USwitch: USwitchStub,
				UFormField: UFormFieldStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('graphicsStyleSetLibrary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockList.mockResolvedValue([summary()]);
		mockGet.mockResolvedValue(response());
		mockCreate.mockResolvedValue(response({ id: 'style-2', name: 'New style', revision: 0, published: null }));
		mockUpdate.mockResolvedValue(response({ draftRevision: 10 }));
		mockPublish.mockResolvedValue({
			styleSet: response({ revision: 4, draftRevision: 10 }),
			affectedTemplates: [
				{ id: 'template-1', name: 'Lower third', revision: 6, styleChanged: true },
				{ id: 'template-2', name: 'Slate', revision: 2, styleChanged: false },
			],
		});
		mockDeleteEntry.mockResolvedValue(response());
		mockRemove.mockResolvedValue(undefined);
		mockInspectPackage.mockResolvedValue(preflightReport());
		mockInstallPackage.mockResolvedValue({
			report: preflightReport(),
			styleSet: response(),
			affectedTemplates: [],
		});
	});

	it('browses the installation-wide library', async () => {
		const wrapper = await mountLibrary();

		expect(mockList).toHaveBeenCalled();
		const entry = wrapper.get('[data-style-set-id="style-1"]');
		expect(entry.text()).toContain('Show style');
		expect(entry.text()).toContain('5 entries');
		expect(entry.text()).toContain('revision 3');
	});

	it('reports a Style Set with unpublished draft changes', async () => {
		mockList.mockResolvedValue([summary({ hasUnpublishedChanges: true })]);

		const wrapper = await mountLibrary();

		expect(wrapper.find('[data-testid="style-set-unpublished"]').exists()).toBe(true);
	});

	it('links the selected Broadcast Graphic without adopting anything', async () => {
		mockList.mockResolvedValue([summary({ id: 'style-9', name: 'Other style' })]);

		const wrapper = await mountLibrary({
			selectedGraphic: { ...lowerThird, styleSet: undefined },
		});
		await wrapper.get('[data-testid="style-set-link"]').trigger('click');

		const emitted = wrapper.emitted('update:graphic');
		expect(emitted).toHaveLength(1);
		const linked = emitted![0]![0] as BroadcastGraphicConfig;
		expect(linked.styleSet).toEqual({ styleSetId: 'style-9', revision: 3 });
		// Linking records where inherited properties will come from and moves nothing:
		// every property is exactly as local as it was.
		expect(linked.items).toEqual(lowerThird.items);
	});

	it('drops the previous Style Set\'s references when switching the link', async () => {
		mockList.mockResolvedValue([summary({ id: 'style-9', name: 'Other style' })]);

		// Already linked to `style-1`, with an item referencing one of its entries.
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-link"]').trigger('click');

		const switched = wrapper.emitted('update:graphic')![0]![0] as BroadcastGraphicConfig;
		expect(switched.styleSet).toEqual({ styleSetId: 'style-9', revision: 3 });
		// A composition links to at most one Style Set, so a reference to the old one
		// would name an entry the new one has never heard of.
		expect(switched.items[0]).not.toHaveProperty('styleRefs');
		// And nothing it renders moved.
		const headline = switched.items[0];
		expect(headline?.type === 'text' && headline.typography.color).toBe('#ff0044');
	});

	it('will not link to a Style Set that has never been published', async () => {
		mockList.mockResolvedValue([summary({ id: 'style-9', revision: 0 })]);

		const wrapper = await mountLibrary({ selectedGraphic: { ...lowerThird, styleSet: undefined } });

		expect(wrapper.get<HTMLButtonElement>('[data-testid="style-set-link"]').element.disabled).toBe(true);
	});

	it('unlinks by keeping every value and dropping only the provenance', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="style-set-unlink"]').trigger('click');

		const unlinked = wrapper.emitted('update:graphic')![0]![0] as BroadcastGraphicConfig;
		expect(unlinked.styleSet).toBeUndefined();
		expect(unlinked.items[0]).not.toHaveProperty('styleRefs');
		// Nothing any output renders has changed.
		const headline = unlinked.items[0];
		expect(headline?.type === 'text' && headline.typography.color).toBe('#ff0044');
	});

	it('publishes the draft and names the templates it reaches without writing one', async () => {
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-open"]').trigger('click');
		await flushPromises();

		await wrapper.get('[data-testid="style-set-publish"]').trigger('click');
		await flushPromises();

		expect(mockPublish).toHaveBeenCalledWith('style-1', 9);
		const affected = wrapper.get('[data-testid="style-set-affected"]');
		expect(affected.text()).toContain('1 of 2 linked templates have an update to review');
		expect(affected.text()).toContain('Lower third — update available');
		expect(affected.text()).toContain('Slate — unchanged');
	});

	it('reports every reason a draft cannot be published, together', async () => {
		mockPublish.mockRejectedValue({
			data: {
				message: 'This Graphic Style Set draft cannot be published',
				data: {
					issues: [
						{ code: 'entry-reference-missing', entryId: 'heading', entryName: 'Heading', message: 'Heading references an entry that does not exist' },
						{ code: 'entry-font-unavailable', entryId: 'caption', entryName: 'Caption', message: 'Caption names a font this installation does not have' },
					],
				},
			},
		});

		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-open"]').trigger('click');
		await flushPromises();
		await wrapper.get('[data-testid="style-set-publish"]').trigger('click');
		await flushPromises();

		const reported = wrapper.get('[data-testid="style-set-publish-issues"]');
		expect(reported.text()).toContain('Heading references an entry that does not exist');
		expect(reported.text()).toContain('Caption names a font this installation does not have');
	});

	it('offers replace and detach before an entry is deleted', async () => {
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-open"]').trigger('click');
		await flushPromises();

		await wrapper.get('[data-testid="style-entry-delete"]').trigger('click');
		await flushPromises();

		const confirmation = wrapper.get('[data-testid="style-entry-delete-confirm"]');
		expect(confirmation.text()).toContain('Nothing on air changes either way');
		await confirmation.get('[data-testid="style-entry-delete-detach"]').trigger('click');
		await flushPromises();

		expect(mockDeleteEntry).toHaveBeenCalledWith('style-1', 'brand', {
			mode: 'detach',
			draftRevision: 9,
		});
	});

	it('gives an observer no way to author', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(wrapper.find('[data-testid="style-set-create"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-link"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-unlink"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-import"]').exists()).toBe(false);
	});

	it('offers a package of every published Style Set and of no unpublished one', async () => {
		mockList.mockResolvedValue([
			summary({ id: 'published-style' }),
			summary({ id: 'unpublished-style', revision: 0 }),
		]);

		const wrapper = await mountLibrary();

		const published = wrapper.get('[data-style-set-id="published-style"]');
		expect(published.find('[data-testid="style-set-export"]').exists()).toBe(true);
		// A Style Set that has never been published has no snapshot to freeze.
		const unpublished = wrapper.get('[data-style-set-id="unpublished-style"]');
		expect(unpublished.find('[data-testid="style-set-export"]').exists()).toBe(false);
	});

	/**
	 * The third library in the reusable-library scope, reporting through the same
	 * shared reading. Its package routes are its own rather than the Graphics Asset
	 * Library's ingestion routes, and they require the same graphics author session,
	 * so a lapse has to read the same here as it does everywhere else.
	 */
	it('names an ended session when a package is refused', async () => {
		// A real lapse arrives as a 401 whose *body* carries the server's sentence, which is
		// what makes the ordering here load-bearing: the session is recognised before the
		// sentence is read, so the author gets the lapse and its reload rather than prose
		// about a session they cannot see (#262).
		mockInspectPackage.mockRejectedValue(transportFailure({
			status: 401,
			body: { message: 'An authenticated graphics author session is required' },
			request: `[POST] "/api/graphics-style-sets/package/inspect"`,
		}));
		const wrapper = await mountLibrary();

		await choosePackage(wrapper);

		expect(wrapper.get('[data-testid="style-set-error"]').text())
			.toContain('This browser is no longer signed in');
		expect(wrapper.find('[data-testid="reusable-library-sign-in"]').exists()).toBe(true);
	});

	/**
	 * A seam that announced a lapse for every refusal would be the same defect with
	 * friendlier wording, so the negative is asserted on each surface too.
	 */
	it('leaves an ordinary refusal saying what it said', async () => {
		mockInspectPackage.mockRejectedValue(transportFailure({
			status: 422,
			body: { message: 'The Graphic Style Set Package is not a readable archive' },
		}));
		const wrapper = await mountLibrary();

		await choosePackage(wrapper);

		const reported = wrapper.get('[data-testid="style-set-error"]');
		expect(reported.text()).toContain('not a readable archive');
		expect(reported.text()).not.toContain('no longer signed in');
		expect(wrapper.find('[data-testid="reusable-library-sign-in"]').exists()).toBe(false);
	});

	it('installs a package that has nothing for its author to weigh, without asking', async () => {
		const wrapper = await mountLibrary();

		await choosePackage(wrapper);

		expect(mockInspectPackage).toHaveBeenCalledWith(expect.any(File), 'preserve-identity');
		expect(mockInstallPackage).toHaveBeenCalledWith(
			expect.any(File),
			{ resolution: 'preserve-identity' },
		);
		expect(wrapper.find('[data-testid="style-set-import-report"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-import-notice"]').exists()).toBe(false);
		expect(wrapper.emitted('published')).toHaveLength(1);
	});

	it('tells the author what a package that asked nothing still had to say', async () => {
		// An exact identity, revision, and content match under a different name. There is
		// no decision to make and nothing was written, so the import is never paused — but
		// the two libraries disagreeing about the name is the one thing it was going to
		// tell the author, and a report they never see tells them nothing.
		const alreadyInstalled = preflightReport({
			disposition: 'already-installed',
			outcome: 'ready',
			installedRevision: 3,
			installedDraftRevision: 9,
			issues: [{
				code: 'graphic-style-set-name-differs',
				severity: 'warning',
				message: 'The package calls this Graphic Style Set “Season look”; this library records it as “Show style”',
				remediation: 'This library keeps the name it already records; the packaged name is not applied. Rename it here if the two libraries should agree.',
			}],
		});
		mockInspectPackage.mockResolvedValue(alreadyInstalled);
		mockInstallPackage.mockResolvedValue({
			report: alreadyInstalled,
			styleSet: response(),
			affectedTemplates: [],
		});

		const wrapper = await mountLibrary();
		await choosePackage(wrapper);

		expect(mockInstallPackage).toHaveBeenCalledWith(
			expect.any(File),
			{ resolution: 'preserve-identity' },
		);
		const notice = wrapper.get('[data-testid="style-set-import-notice"]');
		expect(notice.text()).toContain('already installed');
		expect(notice.text()).toContain('this library records it as “Show style”');
		expect(notice.text()).toContain('the packaged name is not applied');
		// Nothing is waiting on the author, so there is nothing here to confirm.
		expect(wrapper.find('[data-testid="style-set-import-confirm"]').exists()).toBe(false);

		await notice.get('[data-testid="style-set-import-notice-dismiss"]').trigger('click');
		expect(wrapper.find('[data-testid="style-set-import-notice"]').exists()).toBe(false);
	});

	it('pauses on a proposal that would publish over an installed Style Set, and installs only once confirmed', async () => {
		mockInspectPackage.mockResolvedValue(preflightReport({
			disposition: 'update-installed',
			outcome: 'requires-confirmation',
			installedRevision: 3,
			affectedTemplates: [{ id: 'template-1', name: 'Lower third', revision: 6, styleChanged: true }],
			issues: [{
				code: 'graphic-style-set-revision-updated',
				severity: 'warning',
				message: 'This will publish revision 4 over the installed revision 3',
				remediation: 'Every linked template is offered the change as an available style update.',
			}],
		}));

		const wrapper = await mountLibrary();
		await choosePackage(wrapper);

		const report = wrapper.get('[data-testid="style-set-import-report"]');
		expect(report.text()).toContain('This will publish revision 4 over the installed revision 3');
		expect(mockInstallPackage).not.toHaveBeenCalled();

		await report.get('[data-testid="style-set-import-confirm"]').trigger('click');
		await flushPromises();

		// The confirmation is bound to the exact proposal the author read.
		expect(mockInstallPackage).toHaveBeenCalledWith(expect.any(File), {
			resolution: 'preserve-identity',
			fingerprint: 'a'.repeat(64),
		});
		expect(wrapper.emitted('published')).toHaveLength(1);
	});

	it('offers an independent copy for a conflict, and re-reads the proposal rather than reusing it', async () => {
		mockInspectPackage.mockResolvedValueOnce(preflightReport({
			disposition: 'rejected',
			outcome: 'rejected',
			issues: [{
				code: 'graphic-style-set-revision-conflict',
				severity: 'error',
				message: 'Revision 3 of this Graphic Style Set is already installed with different entries',
				remediation: 'Install it as an independent copy.',
			}],
		}));
		mockInspectPackage.mockResolvedValueOnce(preflightReport({
			resolution: 'independent-copy',
			disposition: 'install-independent-copy',
			outcome: 'requires-confirmation',
			fingerprint: 'c'.repeat(64),
			issues: [{
				code: 'graphic-style-set-installed-as-copy',
				severity: 'warning',
				message: '“Show style” will be installed as an independent Graphic Style Set with a new identity',
				remediation: 'Nothing links to the copy until a template selects entries from it.',
			}],
		}));

		const wrapper = await mountLibrary();
		await choosePackage(wrapper);

		expect(wrapper.get('[data-testid="style-set-import-report"]').text())
			.toContain('already installed with different entries');

		await wrapper.get('[data-testid="style-set-import-as-copy"]').trigger('click');
		await flushPromises();

		// A fresh report, because the two resolutions are different proposals.
		expect(mockInspectPackage).toHaveBeenLastCalledWith(expect.any(File), 'independent-copy');
		await wrapper.get('[data-testid="style-set-import-confirm"]').trigger('click');
		await flushPromises();

		expect(mockInstallPackage).toHaveBeenCalledWith(expect.any(File), {
			resolution: 'independent-copy',
			fingerprint: 'c'.repeat(64),
		});
	});

	it('does not offer a copy for a package this installation could never install', async () => {
		mockInspectPackage.mockResolvedValue(preflightReport({
			disposition: 'rejected',
			outcome: 'rejected',
			issues: [{
				code: 'unsupported-application-capability',
				severity: 'error',
				message: 'This installation does not provide application font "aurora"',
				remediation: 'Update this installation.',
			}],
		}));

		const wrapper = await mountLibrary();
		await choosePackage(wrapper);

		expect(wrapper.get('[data-testid="style-set-import-report"]').text()).toContain('aurora');
		// A copy of an uninstallable package is just as uninstallable.
		expect(wrapper.find('[data-testid="style-set-import-as-copy"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-import-confirm"]').exists()).toBe(false);
	});
});
