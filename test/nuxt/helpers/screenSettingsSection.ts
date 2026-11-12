/**
 * `ScreenSettingsSection` as a stub that always renders its body and `actions`
 * slot open, and carries what the surface passes it as `data-*` and a heading.
 * Its open and remember rules are tested at its home (`SettingsSection.test.ts`).
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
