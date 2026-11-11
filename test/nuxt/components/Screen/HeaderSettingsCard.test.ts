import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { screenModeConfigFields } from '~~/shared/screenModeConfigs/fields';
import { headerConfigShape } from '~~/shared/screenModeConfigs/subShapes';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import HeaderSettingsCard from '~/components/Screen/HeaderSettingsCard.vue';

// The one Header card a Screen Mode's settings render: the header toggle, and the custom text
// only while the header shows, cleared as the `null` that deletes it (ADR-0041).

const fields = screenModeConfigFields(headerConfigShape({ shows: 'Show a title.', auto: 'Empty shows the title.' }));

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: true },
	},
	template: '<section :aria-label="title"><slot /></section>',
});

function mountCard(config: { showHeader: boolean; headerText?: string }) {
	return mount(HeaderSettingsCard, {
		props: {
			config,
			fields,
			showDescription: 'Show the round name above the pairings.',
			autoDescription: 'Leave empty for the round\'s name.',
		},
		slots: {
			default: '<p data-testid="look">Look</p>',
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				ScreenSettingsSection: ScreenSettingsCardStub,
			},
		},
	});
}

describe('screenHeaderSettingsCard', () => {
	it.each([
		{
			name: 'shows the text field while the header shows',
			showHeader: true,
			fieldKeys: ['showHeader', 'headerText'],
		},
		{
			name: 'hides the text field while the header is off',
			showHeader: false,
			fieldKeys: ['showHeader'],
		},
	])('$name', ({ showHeader, fieldKeys }) => {
		const wrapper = mountCard({ showHeader });

		expect(wrapper.findAll('[data-config-field]').map(field => field.attributes('data-config-field'))).toEqual(fieldKeys);
	});

	it('labels its fields from the contract and titles the card Header', () => {
		const wrapper = mountCard({ showHeader: true });

		expect(wrapper.get('section').attributes('aria-label')).toBe('Header');
		expect(wrapper.text()).toContain(fields.showHeader.label);
		expect(wrapper.text()).toContain(fields.headerText.label);
		expect(wrapper.get('input').attributes('placeholder')).toBe('Auto');
	});

	it.each([
		{
			name: 'turns the header off',
			act: (w: ReturnType<typeof mountCard>) => w.get('[role="switch"]').trigger('click'),
			patch: { showHeader: false },
		},
		{
			name: 'sets the custom text',
			act: (w: ReturnType<typeof mountCard>) => w.get('input').setValue('Top 8'),
			patch: { headerText: 'Top 8' },
		},
		{
			name: 'clears the custom text as null',
			act: (w: ReturnType<typeof mountCard>) => w.get('input').setValue(''),
			patch: { headerText: null },
		},
	])('$name', async ({ act, patch }) => {
		const wrapper = mountCard({ showHeader: true, headerText: 'Round 4' });
		await act(wrapper);

		expect(wrapper.emitted('update')).toEqual([
			[patch],
		]);
	});

	it('renders the Look slot after its fields', () => {
		const wrapper = mountCard({ showHeader: true });
		const html = wrapper.html();

		expect(html.indexOf('data-testid="look"')).toBeGreaterThan(html.indexOf('data-config-field="headerText"'));
	});
});
