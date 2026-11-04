import type { CardTypeBucket } from '~~/shared/utils/metagame';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';
import { nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardTypeFilterField from '~/components/Screen/CardTypeFilterField.vue';

// The card type chips: a pressed chip is a type the ranking includes. Toggling one adds it to,
// or removes it from, the excluded types; a locked type stays included and cannot be toggled.

function mountField(excluded: CardTypeBucket[], locked?: CardTypeBucket[]) {
	return mount(CardTypeFilterField, {
		props: {
			excluded,
			locked,
			description: 'Toggle which card types appear.',
			testIdPrefix: 'top-cards-type',
		},
		global: {
			stubs: { ...nuxtUiStubs, UFormField: UFormFieldBesideStub },
		},
	});
}

function chip(wrapper: ReturnType<typeof mountField>, bucket: CardTypeBucket) {
	return wrapper.get(`[data-testid="top-cards-type-${bucket}"]`);
}

describe('screenCardTypeFilterField', () => {
	it('offers a chip for every card type, the land bucket as Nonbasic Land', () => {
		const wrapper = mountField([]);

		expect(CARD_TYPE_BUCKET_ORDER.map(bucket => chip(wrapper, bucket).text())).toEqual([
			'Creature',
			'Planeswalker',
			'Battle',
			'Instant',
			'Sorcery',
			'Artifact',
			'Enchantment',
			'Nonbasic Land',
			'Other',
		]);
	});

	it.each([
		{
			name: 'an included type, pressed',
			excluded: [],
			locked: undefined,
			bucket: 'Creature',
			pressed: 'true',
		},
		{
			name: 'an excluded type, not pressed',
			excluded: ['Creature'],
			locked: undefined,
			bucket: 'Creature',
			pressed: 'false',
		},
		{
			name: 'a locked type held excluded, pressed',
			excluded: ['Land'],
			locked: ['Land'],
			bucket: 'Land',
			pressed: 'true',
		},
	] as const)('shows $name', ({ excluded, locked, bucket, pressed }) => {
		expect(chip(mountField([...excluded], locked && [...locked]), bucket).attributes('aria-pressed')).toBe(pressed);
	});

	it.each([
		{
			name: 'excludes an included type',
			excluded: ['Instant'],
			bucket: 'Sorcery',
			next: ['Instant', 'Sorcery'],
		},
		{
			name: 'includes an excluded type',
			excluded: ['Instant', 'Creature'],
			bucket: 'Creature',
			next: ['Instant'],
		},
	] as const)('$name', async ({ excluded, bucket, next }) => {
		const wrapper = mountField([...excluded]);
		await chip(wrapper, bucket).trigger('click');

		expect(wrapper.emitted('update')).toEqual([
			[next],
		]);
	});

	it('cannot toggle a locked type', async () => {
		const wrapper = mountField(['Land'], ['Land']);
		const land = chip(wrapper, 'Land');

		expect(land.attributes('disabled')).toBeDefined();
		await land.trigger('click');
		expect(wrapper.emitted('update')).toBeUndefined();
	});
});
