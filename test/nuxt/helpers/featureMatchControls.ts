import type { VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

/**
 * Stand-ins for the Feature Match controls' parts of match state, so a suite
 * reads which parts a control surface offers: each renders only its name.
 */
export function matchStatePart(name: string) {
	return defineComponent({ template: `<div data-match-state-part="${name}" />` });
}

/** The parts of match state a mounted control surface offers, by name, sorted. */
export function offeredMatchStateParts(wrapper: Pick<VueWrapper, 'findAll'>): string[] {
	return [
		...new Set(wrapper.findAll('[data-match-state-part]').map(node => node.attributes('data-match-state-part')!)),
	].sort();
}
