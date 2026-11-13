import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import FontSelectionField from '~/components/Graphics/Compositor/FontSelectionField.vue';

function mountField() {
	return mount(FontSelectionField, {
		props: {
			source: 'application',
			font: { kind: 'application', fontId: 'inter' },
			fieldLabel: 'Font',
			size: 'sm',
			testIdPrefix: 'item',
		},
		global: { stubs: nuxtUiStubs },
	});
}

// The application font picker groups fonts by category and paints each in its own face.
describe('fontSelectionField application picker', () => {
	it('groups the application fonts by category', () => {
		const groups = mountField().findAll('[data-testid="item-font"] optgroup');
		expect(groups.map(group => group.attributes('label')))
			.toEqual([
				'Sans',
				'Condensed',
				'Serif',
				'Monospace',
				'System',
			]);
	});

	it('paints each option in its own face', () => {
		const option = mountField().find('[data-testid="item-font"] [data-font-id="roboto"]');
		expect((option.element as HTMLElement).style.fontFamily).toBe('var(--font-roboto)');
	});

	it('emits the chosen application font', async () => {
		const field = mountField();
		const select = field.find('[data-testid="item-font"]');
		await select.setValue('roboto');
		expect(field.emitted('application')).toEqual([
			['roboto'],
		]);
	});
});
