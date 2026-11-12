/**
 * `ScreenSettingsSection` as a stub, for a test of what a surface puts in its
 * sections. Its open and remember rules are tested at its home
 * (`SettingsSection.test.ts`); this one always renders its body and its
 * `actions` slot open, and carries what the surface passes it: its title
 * (`data-section`, and as a heading), `id`, `summary`, whether it collapses,
 * and whether it starts open, the density's own default while unset.
 */
import { defineComponent } from 'vue';

export const ScreenSettingsSectionStub = defineComponent({
	name: 'ScreenSettingsSection',
	props: {
		title: { type: String, default: '' },
		density: { type: String, default: 'card' },
		subtitle: { type: String, required: false },
		icon: { type: String, required: false },
		collapsible: { type: Boolean, default: true },
		defaultOpen: { type: Boolean, default: undefined },
		id: { type: String, required: false },
		summary: { type: String, required: false },
	},
	template: `<section
		data-testid="settings-section"
		:data-section="title || undefined"
		:data-section-id="id"
		:data-summary="summary"
		:data-collapsible="String(collapsible)"
		:data-default-open="String(defaultOpen ?? density === 'card')"
	>
		<h2 v-if="title">{{ title }}</h2>
		<p v-if="subtitle">{{ subtitle }}</p>
		<slot name="actions" :open="true" />
		<slot />
	</section>`,
});
