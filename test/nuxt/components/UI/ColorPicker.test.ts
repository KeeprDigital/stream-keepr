import type { VueWrapper } from '@vue/test-utils';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ColorPicker from '~/components/UI/ColorPicker.vue';

// The one colour control: `#rrggbb` when opaque, `rgba()` below 100 % alpha,
// `undefined` for Clear, never `''`. Alpha is opt-in, and refused with hexOnly.

enableAutoUnmount(afterEach);

function mountPicker(props: Record<string, unknown>) {
	return mount(ColorPicker, {
		props,
		attrs: { 'aria-label': 'Text colour' },
		global: { stubs: nuxtUiStubs },
	});
}

const trigger = (wrapper: VueWrapper) => wrapper.get('[aria-label="Text colour"]');
const part = (wrapper: VueWrapper, name: string) => wrapper.find(`[data-color-part="${name}"]`);

async function open(wrapper: VueWrapper) {
	await trigger(wrapper).trigger('click');
}

const emitted = (wrapper: VueWrapper) => wrapper.emitted('update:modelValue')?.map(([value]) => value);

type Edit = (wrapper: VueWrapper) => Promise<unknown>;
const pick = (hex: string): Edit => wrapper => part(wrapper, 'hue').setValue(hex);
const slide = (percent: number): Edit => wrapper => part(wrapper, 'alpha').setValue(percent);
const enterAlpha = (percent: number): Edit => wrapper => part(wrapper, 'alpha-percent').setValue(percent);
const type = (text: string): Edit => wrapper => part(wrapper, 'text').setValue(text);
const press = (name: 'transparent' | 'clear'): Edit => wrapper => part(wrapper, name).trigger('click');

describe('uiColorPicker', () => {
	it.each<[string, Record<string, unknown>, Edit, Array<string | undefined>]>([
		[
			'an opaque pick emits hex',
			{ modelValue: '#ffffff', alpha: true },
			pick('#112233'),
			['#112233'],
		],
		[
			'a drag keeps a stored rgba() alpha',
			{ modelValue: 'rgba(17, 34, 51, 0.5)', alpha: true },
			pick('#ff0000'),
			['rgba(255, 0, 0, 0.5)'],
		],
		[
			'a drag keeps an eight-digit hex alpha',
			{ modelValue: '#11223380' },
			pick('#ff0000'),
			['rgba(255, 0, 0, 0.5)'],
		],
		[
			'the alpha slider below 100 % emits rgba()',
			{ modelValue: '#112233', alpha: true },
			slide(50),
			['rgba(17, 34, 51, 0.5)'],
		],
		[
			'the alpha slider at 100 % emits hex',
			{ modelValue: 'rgba(17, 34, 51, 0.5)', alpha: true },
			slide(100),
			['#112233'],
		],
		[
			'the alpha % field emits rgba()',
			{ modelValue: '#112233', alpha: true },
			enterAlpha(25),
			['rgba(17, 34, 51, 0.25)'],
		],
		[
			'Transparent keeps the hue at alpha 0',
			{ modelValue: '#112233', alpha: true },
			press('transparent'),
			['rgba(17, 34, 51, 0)'],
		],
		[
			'Clear unsets',
			{ modelValue: '#112233', alpha: true, clearable: true },
			press('clear'),
			[undefined],
		],
		[
			'a typed hex keeps the alpha beside it',
			{ modelValue: 'rgba(17, 34, 51, 0.5)', alpha: true },
			type('#ff0000'),
			['rgba(255, 0, 0, 0.5)'],
		],
		[
			'a typed rgba() carries its own alpha',
			{ modelValue: '#112233', alpha: true },
			type('rgba(1, 2, 3, 0.4)'),
			['rgba(1, 2, 3, 0.4)'],
		],
		[
			'a typed raw value passes through',
			{ modelValue: '#112233', allowRawValue: true },
			type('radial-gradient(red, blue)'),
			['radial-gradient(red, blue)'],
		],
		[
			'a typed raw value is refused without allowRawValue',
			{ modelValue: '#112233' },
			type('radial-gradient(red, blue)'),
			[],
		],
		[
			'an emptied required colour emits nothing',
			{ modelValue: '#112233', alpha: true },
			type(''),
			[],
		],
		[
			'an emptied clearable colour unsets',
			{ modelValue: '#112233', clearable: true },
			type(''),
			[undefined],
		],
		[
			'a hex-only colour waits for a complete hex',
			{ modelValue: '#112233', hexOnly: true },
			type('#12'),
			[],
		],
		[
			'a hex-only colour emits a complete hex',
			{ modelValue: '#112233', hexOnly: true },
			type('#ABCDEF'),
			['#abcdef'],
		],
	])('%s', async (_case, props, edit, values) => {
		const wrapper = mountPicker(props);
		await open(wrapper);

		await edit(wrapper);

		expect(emitted(wrapper) ?? []).toEqual(values);
	});

	it('opens a stored rgba() on its hue and alpha', async () => {
		const wrapper = mountPicker({ modelValue: 'rgba(17, 34, 51, 0.5)', alpha: true });
		expect(trigger(wrapper).attributes('data-color-alpha')).toBe('50');

		await open(wrapper);

		expect((part(wrapper, 'hue').element as HTMLInputElement).value).toBe('#112233');
		expect((part(wrapper, 'alpha').element as HTMLInputElement).value).toBe('50');
		expect((part(wrapper, 'alpha-percent').element as HTMLInputElement).value).toBe('50');
		expect((part(wrapper, 'text').element as HTMLInputElement).value).toBe('#112233');
	});

	it.each([
		[
			'alpha',
			{ modelValue: '#112233', alpha: true },
			[
				'hue',
				'alpha',
				'text',
				'alpha-percent',
				'transparent',
			],
		],
		[
			'a required colour',
			{ modelValue: '#112233' },
			['hue', 'text'],
		],
		[
			'a clearable colour',
			{ modelValue: '#112233', clearable: true },
			['hue', 'text', 'clear'],
		],
		[
			'hex-only',
			{ modelValue: '#112233', hexOnly: true },
			['hue', 'text'],
		],
	])('offers %s exactly its controls', async (_case, props, parts) => {
		const wrapper = mountPicker(props);
		await open(wrapper);

		expect(wrapper.findAll('[data-color-part]').map(found => found.attributes('data-color-part'))).toEqual(parts);
	});

	it('marks Transparent pressed at alpha 0', async () => {
		const wrapper = mountPicker({ modelValue: 'rgba(17, 34, 51, 0)', alpha: true });
		await open(wrapper);

		expect(part(wrapper, 'transparent').attributes('aria-pressed')).toBe('true');
	});

	it('shows an unparseable raw value as its own swatch, with alpha disabled', async () => {
		const wrapper = mountPicker({ modelValue: 'linear-gradient(red, blue)', alpha: true, allowRawValue: true });
		expect(trigger(wrapper).attributes('data-color-state')).toBe('raw');
		expect(trigger(wrapper).get('[data-color-swatch]').attributes('style')).toContain('linear-gradient(red, blue)');

		await open(wrapper);

		expect(part(wrapper, 'alpha').attributes('disabled')).toBeDefined();
		expect(part(wrapper, 'alpha-percent').attributes('disabled')).toBeDefined();
		expect((part(wrapper, 'text').element as HTMLInputElement).value).toBe('linear-gradient(red, blue)');
	});

	it('emits once, on close, with commit="close"', async () => {
		const wrapper = mountPicker({ modelValue: '#ffffff', alpha: true, commit: 'close' });
		await open(wrapper);

		await pick('#112233')(wrapper);
		await slide(40)(wrapper);
		expect(emitted(wrapper)).toBeUndefined();
		expect(trigger(wrapper).attributes('data-color-alpha')).toBe('40');

		await open(wrapper);
		expect(emitted(wrapper)).toEqual(['rgba(17, 34, 51, 0.4)']);
	});

	it('emits nothing on close when nothing changed, with commit="close"', async () => {
		const wrapper = mountPicker({ modelValue: '#ffffff', alpha: true, commit: 'close' });
		await open(wrapper);
		await open(wrapper);

		expect(emitted(wrapper)).toBeUndefined();
	});

	it('cannot be opened while disabled', () => {
		const wrapper = mountPicker({ disabled: true, modelValue: '#112233' });

		expect(trigger(wrapper).attributes('disabled')).toBeDefined();
	});
});
