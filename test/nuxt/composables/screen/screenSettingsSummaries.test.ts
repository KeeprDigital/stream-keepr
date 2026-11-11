import { describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { columnsSummary, headerSummary, lookSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';

// The one line a closed Screen settings card shows in place of its body.

describe('a closed Screen settings card\'s summary', () => {
	it.each([
		[
			'a hidden header',
			{ showHeader: false, headerText: 'Final' },
			'Hidden',
		],
		[
			'an automatic title',
			{ showHeader: true, headerText: null },
			'Auto title',
		],
		[
			'a custom title',
			{ showHeader: true, headerText: 'Final Standings' },
			'“Final Standings”',
		],
	])('names %s', (_case, config, summary) => {
		expect(headerSummary(config)).toBe(summary);
	});

	it.each([
		[
			'no override',
			['reveal'],
			{},
			null,
		],
		[
			'an override of another group\'s token',
			['reveal'],
			{ 'standings.rise': '#000000' },
			null,
		],
		[
			'one override in the group',
			['table'],
			{ 'standings.fall': '#ff0000' },
			'1 Screen Theme Override',
		],
		[
			'overrides across the groups it renders',
			['table', 'reveal'],
			{
				'standings.rise': '#000000',
				'standings.reveal-motion': { duration: 100 },
			},
			'2 Screen Theme Overrides',
		],
	])('counts a Look\'s overrides: %s', (_case, groups, overrides, summary) => {
		expect(lookSummary('standings', overrides, groups)).toBe(summary);
	});

	it.each([
		[
			'manual paging',
			{ autoPageEnabled: false, autoPageIntervalMs: 10000 },
			'8 per page · Manual paging',
		],
		[
			'auto-page',
			{ autoPageEnabled: true, autoPageIntervalMs: 4500 },
			'8 per page · Auto-page every 4.5 s',
		],
	])('names a Page Rotation\'s page size and %s', (_case, rotationConfig, summary) => {
		expect(paginationSummary({
			pageSize: computed(() => 8),
			rotationConfig: computed(() => rotationConfig),
		})).toBe(summary);
	});

	it.each([
		[
			'some',
			[
				{ visible: true },
				{ visible: false },
				{ visible: true },
			],
			'2 of 3 columns shown',
		],
		[
			'none',
			[
				{ visible: false },
			],
			'0 of 1 columns shown',
		],
	])('counts the columns shown: %s', (_case, columns, summary) => {
		expect(columnsSummary(columns)).toBe(summary);
	});

	it.each([
		[
			'its parts',
			['4 columns shown', '1 Screen Theme Override'],
			undefined,
			'4 columns shown · 1 Screen Theme Override',
		],
		[
			'the parts it has',
			['Auto title', null],
			undefined,
			'Auto title',
		],
		[
			'its fallback for no part',
			[null, false],
			'Follows the Theme',
			'Follows the Theme',
		],
	] as const)('joins %s on one line', (_case, parts, fallback, summary) => {
		expect(settingsSummary([...parts], fallback)).toBe(summary);
	});
});
