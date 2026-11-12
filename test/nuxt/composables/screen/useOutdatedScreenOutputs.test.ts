import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOutdatedScreenOutputs } from '~/composables/screen/useOutdatedScreenOutputs';

/** What each Screen's outputs report of themselves through presence. */
const mockScreenPresence = {
	value: new Map<number, { count: number; members: Array<{ data?: { protocol?: number } }> }>(),
};
mockNuxtImport('useScreenStore', () => () => ({ screenPresence: mockScreenPresence.value }));

describe('useOutdatedScreenOutputs', () => {
	beforeEach(() => {
		mockScreenPresence.value = new Map();
	});

	// An output that follows its Screen's channel says so; one that says nothing, or less, predates it.
	it.each([
		{
			reports: 'the Screen channel protocol',
			members: [
				{
					data: { protocol: 2 },
				},
			],
			outdated: 0,
		},
		{
			reports: 'a later protocol',
			members: [
				{
					data: { protocol: 3 },
				},
			],
			outdated: 0,
		},
		{
			reports: 'no protocol',
			members: [
				{ data: {} },
				{},
			],
			outdated: 2,
		},
		{
			reports: 'an earlier protocol',
			members: [
				{
					data: { protocol: 1 },
				},
				{
					data: { protocol: 2 },
				},
			],
			outdated: 1,
		},
		{ reports: 'nothing, having no outputs', members: [], outdated: 0 },
	])('counts $outdated outdated outputs on a Screen whose outputs report $reports', ({ members, outdated }) => {
		mockScreenPresence.value.set(7, { count: members.length, members });

		expect(useOutdatedScreenOutputs(7).value).toBe(outdated);
	});

	it('scopes the count to the asked-for Screen', () => {
		mockScreenPresence.value.set(7, {
			count: 1,
			members: [{}],
		});

		expect(useOutdatedScreenOutputs(8).value).toBe(0);
	});
});
