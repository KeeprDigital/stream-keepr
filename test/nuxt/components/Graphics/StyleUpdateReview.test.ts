import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { GraphicStyleUpdateChange, GraphicStyleUpdateReview } from '~~/shared/types/graphicStyleSet';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

/**
 * The reviewed Graphic Style Set update, as the author of one template meets it.
 *
 * This surface is the whole reason a republished Style Set is never a silent
 * mutation, so the rules under test are the ones that make that true: the change is
 * announced and readable before it exists anywhere, nothing is written until the
 * author asks, each row's answer travels exactly as they gave it, the Style Set
 * revision they read is a precondition of applying, and an observer can read all of
 * it and decide none of it.
 */

enableAutoUnmount(afterEach);

const mockReviewTemplateUpdate = vi.fn();
const mockApplyTemplateUpdate = vi.fn();

mockNuxtImport('useGraphicStyleSetRepository', () => () => ({
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	publish: vi.fn(),
	deleteEntry: vi.fn(),
	remove: vi.fn(),
	reviewTemplateUpdate: mockReviewTemplateUpdate,
	applyTemplateUpdate: mockApplyTemplateUpdate,
	packageUrl: (styleSetId: string) => `/api/graphics-style-sets/${styleSetId}/package`,
	inspectPackage: vi.fn(),
	installPackage: vi.fn(),
}));

const UAlertStub = defineComponent({
	props: { title: { type: String, required: false }, description: { type: String, required: false } },
	template: '<div><strong>{{ title }}</strong><span>{{ description }}</span></div>',
});
const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		disabled: { type: Boolean, default: false },
		variant: { type: String, default: undefined },
	},
	emits: ['click'],
	template: `<button type="button" :disabled="disabled" :data-variant="variant" @click="$emit('click')"><slot /></button>`,
});

function template(overrides: Partial<BroadcastGraphicTemplateSummary> = {}): BroadcastGraphicTemplateSummary {
	return {
		id: 'template-1',
		name: 'Lower third',
		description: null,
		revision: 4,
		authored: true,
		itemCount: 2,
		inputCount: 0,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	};
}

/** The item's Graphic Fill, and the Broadcast Graphic's own enter animation. */
function changes(): GraphicStyleUpdateChange[] {
	return [
		{
			ownerItemId: 'headline',
			ownerLabel: 'Headline',
			slot: 'surfaceStyle.fill',
			entryId: 'accent-fill',
			entryName: 'Accent fill',
			current: { type: 'solid', color: '#ff0044' },
			next: { type: 'solid', color: '#00ff88' },
		},
		{
			ownerItemId: null,
			ownerLabel: 'Lower third',
			slot: 'animation.enter',
			entryId: 'rise',
			entryName: 'Rise',
			current: { duration: 320, easing: 'ease-out' },
			next: { duration: 500, easing: 'ease-out' },
		},
	];
}

function review(overrides: Partial<GraphicStyleUpdateReview> = {}): GraphicStyleUpdateReview {
	return {
		styleSet: { id: 'style-1', name: 'Show style', linkedRevision: 3, publishedRevision: 7 },
		available: true,
		changes: changes(),
		...overrides,
	};
}

async function mountReview(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/StyleUpdateReview.vue';
	const { default: StyleUpdateReview } = await import(componentPath);

	const wrapper = mount(StyleUpdateReview, {
		props: { template: template(), writable: true, ...props },
		global: { stubs: { UAlert: UAlertStub, UBadge: UBadgeStub, UButton: UButtonStub } },
	});
	await flushPromises();
	return wrapper;
}

/** Open the list of property groups the update would change. */
async function expand(wrapper: Awaited<ReturnType<typeof mountReview>>) {
	await wrapper.get('[data-testid="style-update-review"]').trigger('click');
	await flushPromises();
}

describe('graphicsStyleUpdateReview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReviewTemplateUpdate.mockResolvedValue(review());
		mockApplyTemplateUpdate.mockResolvedValue(undefined);
	});

	it('announces an available update without showing the change until it is asked for', async () => {
		const wrapper = await mountReview();

		expect(wrapper.get('[data-testid="style-update-state"]').text()).toContain('Show style');
		expect(wrapper.get('[data-testid="style-update-state"]').text()).toContain('update available');
		expect(wrapper.find('[data-testid="style-update-changes"]').exists()).toBe(false);

		await expand(wrapper);

		expect(wrapper.find('[data-testid="style-update-changes"]').exists()).toBe(true);
	});

	it('says which revision a template is reconciled to when nothing has moved', async () => {
		mockReviewTemplateUpdate.mockResolvedValue(review({ available: false, changes: [] }));

		const wrapper = await mountReview();

		expect(wrapper.get('[data-testid="style-update-state"]').text()).toContain('revision 3');
		// Nothing to review, so nothing offers to.
		expect(wrapper.find('[data-testid="style-update-review"]').exists()).toBe(false);
	});

	it('names every property group the update would change, and where each comes from', async () => {
		const wrapper = await mountReview();
		await expand(wrapper);

		const listed = wrapper.get('[data-testid="style-update-changes"]').text();
		expect(listed).toContain('Headline · Graphic Fill');
		expect(listed).toContain('Accent fill');
		expect(listed).toContain('Lower third · Enter animation');
		expect(listed).toContain('Rise');
		// The two answers, on each row.
		expect(wrapper.findAll('[data-testid="style-update-inherit"]')).toHaveLength(2);
		expect(wrapper.findAll('[data-testid="style-update-keep"]')).toHaveLength(2);
	});

	it('writes nothing to the template until the author applies', async () => {
		const wrapper = await mountReview();
		await expand(wrapper);
		await wrapper.findAll('[data-testid="style-update-keep"]')[0]!.trigger('click');
		await flushPromises();

		// Reading the change, and deciding about it, are not applying it.
		expect(mockApplyTemplateUpdate).not.toHaveBeenCalled();
	});

	it('applies against the exact revisions the review was read at', async () => {
		const wrapper = await mountReview();
		await expand(wrapper);

		await wrapper.get('[data-testid="style-update-apply"]').trigger('click');
		await flushPromises();

		// A Style Set republished between reading and applying is refused rather than
		// applied under decisions the author never made about it.
		expect(mockApplyTemplateUpdate).toHaveBeenCalledWith('template-1', {
			revision: 4,
			styleSetRevision: 7,
			decisions: {},
		});
		expect(wrapper.emitted('applied')).toHaveLength(1);
		// And the review closes, because it is no longer the template's state.
		expect(wrapper.find('[data-testid="style-update-changes"]').exists()).toBe(false);
	});

	it('carries only the rows the author kept, leaving every other row inheriting', async () => {
		const wrapper = await mountReview();
		await expand(wrapper);

		await wrapper.findAll('[data-testid="style-update-keep"]')[0]!.trigger('click');
		await flushPromises();

		// The chosen answer is the one shown as chosen.
		expect(wrapper.findAll('[data-testid="style-update-keep"]')[0]!.attributes('data-variant')).toBe('subtle');
		expect(wrapper.findAll('[data-testid="style-update-inherit"]')[0]!.attributes('data-variant')).toBe('ghost');

		await wrapper.get('[data-testid="style-update-apply"]').trigger('click');
		await flushPromises();

		expect(mockApplyTemplateUpdate).toHaveBeenCalledWith('template-1', {
			revision: 4,
			styleSetRevision: 7,
			// Keyed by owner and slot. The whole-graphic animation the author left alone is
			// absent, which is what inheriting is.
			decisions: { 'headline::surfaceStyle.fill': 'keep-as-override' },
		});
	});

	it('lets the author change their mind before applying', async () => {
		const wrapper = await mountReview();
		await expand(wrapper);

		await wrapper.findAll('[data-testid="style-update-keep"]')[0]!.trigger('click');
		await wrapper.findAll('[data-testid="style-update-inherit"]')[0]!.trigger('click');
		await wrapper.get('[data-testid="style-update-apply"]').trigger('click');
		await flushPromises();

		expect(mockApplyTemplateUpdate).toHaveBeenCalledWith('template-1', {
			revision: 4,
			styleSetRevision: 7,
			decisions: { 'headline::surfaceStyle.fill': 'inherit' },
		});
	});

	it('re-reads the review when applying it fails, rather than leaving a stale one on screen', async () => {
		mockApplyTemplateUpdate.mockRejectedValue({
			data: { message: 'This Graphic Style Set has been republished since this review was read' },
		});

		const wrapper = await mountReview();
		await expand(wrapper);
		await wrapper.get('[data-testid="style-update-apply"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="style-update-error"]').text())
			.toContain('republished since this review was read');
		// Read once on mount and again after the refusal, so a second attempt is decided
		// against what the template and Style Set are now at.
		expect(mockReviewTemplateUpdate).toHaveBeenCalledTimes(2);
		expect(wrapper.emitted('applied')).toBeUndefined();
	});

	it('re-reads the review when the template is revised under it, and forgets what was decided about the old one', async () => {
		const wrapper = await mountReview();
		await expand(wrapper);
		await wrapper.findAll('[data-testid="style-update-keep"]')[0]!.trigger('click');
		expect(mockReviewTemplateUpdate).toHaveBeenCalledTimes(1);

		await wrapper.setProps({ template: template({ revision: 5 }) });
		await flushPromises();

		expect(mockReviewTemplateUpdate).toHaveBeenCalledTimes(2);

		await wrapper.get('[data-testid="style-update-apply"]').trigger('click');
		await flushPromises();

		// The decision was about a template that has since moved, and the changes it was
		// made against are not the ones on screen now.
		expect(mockApplyTemplateUpdate).toHaveBeenCalledWith('template-1', {
			revision: 5,
			styleSetRevision: 7,
			decisions: {},
		});
	});

	it('lets an observer read the whole review and decide none of it', async () => {
		const wrapper = await mountReview({ writable: false });
		await expand(wrapper);

		// The change is readable — an observer can see what an author would be applying.
		expect(wrapper.get('[data-testid="style-update-changes"]').text()).toContain('Headline · Graphic Fill');
		expect(wrapper.get<HTMLButtonElement>('[data-testid="style-update-apply"]').element.disabled).toBe(true);
		for (const button of wrapper.findAll<HTMLButtonElement>('[data-testid="style-update-keep"]'))
			expect(button.element.disabled).toBe(true);
		for (const button of wrapper.findAll<HTMLButtonElement>('[data-testid="style-update-inherit"]'))
			expect(button.element.disabled).toBe(true);
	});

	it('shows nothing at all for a template linked to no Graphic Style Set', async () => {
		mockReviewTemplateUpdate.mockResolvedValue(review({ styleSet: null, available: false, changes: [] }));

		const wrapper = await mountReview();

		expect(wrapper.find('[data-testid="style-update-template-1"]').exists()).toBe(false);
	});
});
