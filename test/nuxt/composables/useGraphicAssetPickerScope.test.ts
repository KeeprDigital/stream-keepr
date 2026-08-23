import { beforeEach, describe, expect, it } from 'vitest';
import { clearNuxtState } from '#app';

describe('useGraphicAssetPickerScope', () => {
	beforeEach(() => {
		clearNuxtState();
	});

	it('holds no preference until an author chooses one', () => {
		const { chosen } = useGraphicAssetPickerScope();

		expect(chosen.value).toBeNull();
	});

	it('remembers an explicit choice', () => {
		const { chosen, choose } = useGraphicAssetPickerScope();

		choose('library');

		expect(chosen.value).toBe('library');
	});

	it('shares one preference across every picker', () => {
		const first = useGraphicAssetPickerScope();
		const second = useGraphicAssetPickerScope();

		first.choose('library');

		expect(second.chosen.value).toBe('library');

		second.choose('event');

		expect(first.chosen.value).toBe('event');
	});
});
