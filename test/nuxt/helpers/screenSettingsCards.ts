/**
 * A mode's Screen settings page as its cards: each card's title, `mode:card`
 * id, whether it collapses, and its closed summary, with each group's Look as
 * the group it names. The card's own open and remember rules are tested at
 * `ScreenSettingsSection`; this shows a mode wires each card.
 */
import type { VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

/** A Screen settings card exposing what the mode passes it; its body always renders. */
export const ScreenSettingsCardSpy = defineComponent({
	props: {
		title: { type: String, default: '' },
		id: { type: String, default: undefined },
		summary: { type: String, default: undefined },
		collapsible: { type: Boolean, default: true },
		defaultOpen: { type: Boolean, default: true },
	},
	template: `<section
		:data-settings-card="title"
		:data-card-id="id"
		:data-collapsible="String(collapsible)"
		:data-summary="summary"
	><slot /></section>`,
});

/** A group's Look, as the group it names. */
export const ScreenThemeTokenGroupSpy = defineComponent({
	props: {
		group: { type: String, required: true },
	},
	template: '<div :data-look="group" />',
});

export const screenSettingsCardSpies = {
	ScreenSettingsSection: ScreenSettingsCardSpy,
	ScreenThemeTokenGroup: ScreenThemeTokenGroupSpy,
};

export interface SettingsCardView {
	title: string;
	id: string | undefined;
	collapsible: boolean;
	looks: string[];
}

/** Each card on the page, in order. */
export function settingsCards(wrapper: VueWrapper): SettingsCardView[] {
	return wrapper.findAll('[data-settings-card]').map(card => ({
		title: card.attributes('data-settings-card')!,
		id: card.attributes('data-card-id'),
		collapsible: card.attributes('data-collapsible') === 'true',
		looks: card.findAll('[data-look]').map(look => look.attributes('data-look')!),
	}));
}

/** The closed summary of the card titled `title`. */
export function settingsCardSummary(wrapper: VueWrapper, title: string): string | undefined {
	return wrapper.get(`[data-settings-card="${title}"]`).attributes('data-summary');
}
