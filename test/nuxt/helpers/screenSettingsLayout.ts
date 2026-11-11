/**
 * A Screen settings page's layout as the shared rules shape it (#955): each
 * card's `mode:card` id, title, whether it collapses and its closed summary,
 * and the Screen Settings Groups whose Look it mounts (ADR-0072). Spread
 * `screenSettingsLayoutStubs` into `global.stubs` and read `settingsLayout`.
 */
import type { VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

/** A settings card whose body always renders, carrying its id, title, collapsibility and summary. */
export const ScreenSettingsCardLayoutStub = defineComponent({
	props: {
		title: { type: String, default: '' },
		subtitle: { type: String, required: false },
		id: { type: String, required: false },
		collapsible: { type: Boolean, default: true },
		defaultOpen: { type: Boolean, default: true },
		summary: { type: String, required: false },
	},
	template: `<section data-testid="settings-card" :data-settings-card="id" :data-collapsible="String(collapsible)" :data-summary="summary">
		<h2>{{ title }}</h2>
		<p v-if="subtitle">{{ subtitle }}</p>
		<slot />
	</section>`,
});

/** A Screen Settings Group's Look, standing in for its rows. */
export const ScreenThemeTokenGroupStub = defineComponent({
	props: {
		group: { type: String, required: true },
	},
	template: '<div :data-settings-group="group" />',
});

export const screenSettingsLayoutStubs = {
	ScreenSettingsSection: ScreenSettingsCardLayoutStub,
	ScreenThemeTokenGroup: ScreenThemeTokenGroupStub,
};

export interface SettingsCardLayout {
	id: string | undefined;
	title: string;
	collapsible: boolean;
	/** The Screen Settings Groups whose Look renders in the card, in page order. */
	groups: string[];
}

/** Each settings card on the page, in order. */
export function settingsLayout(wrapper: VueWrapper<any>): SettingsCardLayout[] {
	return wrapper.findAll('[data-testid="settings-card"]').map(card => ({
		id: card.attributes('data-settings-card'),
		title: card.get('h2').text(),
		collapsible: card.attributes('data-collapsible') === 'true',
		groups: card.findAll('[data-settings-group]').map(group => group.attributes('data-settings-group')!),
	}));
}

/** The summary each collapsible card shows while closed, by id. */
export function settingsSummaries(wrapper: VueWrapper<any>): Record<string, string | undefined> {
	return Object.fromEntries(wrapper.findAll('[data-testid="settings-card"][data-collapsible="true"]')
		.map(card => [
			card.attributes('data-settings-card'),
			card.attributes('data-summary'),
		]));
}
