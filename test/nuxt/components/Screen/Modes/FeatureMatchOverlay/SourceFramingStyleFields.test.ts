import type { FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import SourceFramingStyleFields from '~/components/Screen/Modes/FeatureMatchOverlay/SourceFramingStyleFields.vue';

// A Source Item edits its shape: corner radii, through the shared corner editor,
// which border sides show and where its glow falls. Its fill, border and glow
// are the Theme's `source-surface` (#831).

enableAutoUnmount(afterEach);

function mountFields(framingStyle: FeatureMatchSourceFramingStyle) {
	return mount(SourceFramingStyleFields, {
		global: {
			stubs: { ...nuxtUiStubs, UFormField: UFormFieldBesideStub },
		},
		props: { framingStyle },
	});
}

type Wrapper = ReturnType<typeof mountFields>;

const cornerSize = (wrapper: Wrapper, corner: string) => wrapper.get(`input[aria-label="${corner} size"]`);

describe('source framing style fields', () => {
	it('offers no colour, border or glow of the Source Item\'s own', () => {
		const wrapper = mountFields({});

		expect(wrapper.find('[data-color-part]').exists()).toBe(false);
		expect(wrapper.find('[role="switch"]').exists()).toBe(false);
	});

	it('switches a border side and chooses where the glow falls', async () => {
		const wrapper = mountFields({ borderTopVisible: false });

		const top = wrapper.get('button[title="Top border"]');
		expect(top.attributes('aria-pressed')).toBe('false');
		await top.trigger('click');
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ borderTopVisible: true });

		await wrapper.get('select[aria-label="Glow position"]').setValue('outside');
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ glowPosition: 'outside' });
	});

	// A Source Item stores radii, so the corner editor offers what a radius can be:
	// a rounded corner of any size, 0 being square.
	it('reads each corner\'s stored radius, falling back to the shared one', () => {
		const wrapper = mountFields({ borderRadius: 8, borderRadiusTopLeft: 20 });

		expect([
			'Top left',
			'Top right',
			'Bottom left',
			'Bottom right',
		].map(corner => (cornerSize(wrapper, corner).element as HTMLInputElement).value)).toEqual(['20', '8', '8', '8']);
	});

	it('offers no cut corner, edge slant or shape preset, which a radius cannot hold', () => {
		const wrapper = mountFields({});

		expect(wrapper.find('[data-treatment-option="cut"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="shape-left-slant"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(false);
	});

	it.each([
		{
			case: 'one corner',
			linked: false,
			written: { borderRadiusTopRight: 12 },
		},
		{
			case: 'all four corners while they are linked',
			linked: true,
			written: {
				borderRadiusTopLeft: 12,
				borderRadiusTopRight: 12,
				borderRadiusBottomLeft: 12,
				borderRadiusBottomRight: 12,
			},
		},
	])('writes $case as stored radii', async ({ linked, written }) => {
		const wrapper = mountFields({ borderRadius: 8 });
		if (linked)
			await wrapper.get('[data-testid="shape-corners-linked"]').trigger('click');

		await cornerSize(wrapper, 'Top right').setValue('12');
		await flushPromises();

		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual(written);
	});
});
