import { describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { headerSummary, paginationSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';

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
