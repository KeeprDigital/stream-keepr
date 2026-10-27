import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { screenBackgroundLayers } from '~/modules/screen-mode';

// A Screen paints its own Background Layer stack, else its Theme's `background`,
// else the shipped default: none.

function colorLayer(id: string): BackgroundLayer {
	return {
		id,
		type: 'color',
		color: '#101010',
		enabled: true,
		opacity: 1,
	};
}

const themeStack = [
	colorLayer('theme'),
];

describe('the Background Layer stack a Screen paints', () => {
	it.each([
		[
			'its own stack, in place of its Theme\'s',
			[
				colorLayer('own'),
			],
			{ background: themeStack },
			['own'],
		],
		[
			'its Theme\'s, when it has no stack',
			undefined,
			{ background: themeStack },
			['theme'],
		],
		[
			'its Theme\'s, when its own stack is empty',
			[],
			{ background: themeStack },
			['theme'],
		],
		[
			'none, under the Default Theme',
			undefined,
			{},
			[],
		],
		[
			'none, under a Theme whose stored background no longer reads',
			undefined,
			{ background: 'not a stack' },
			[],
		],
	])('is %s', (_case, own, theme, painted) => {
		expect(screenBackgroundLayers(own, theme, {}).map(layer => layer.id)).toEqual(painted);
	});

	it('takes a Screen Theme Override of the background before its Theme\'s', () => {
		const painted = screenBackgroundLayers(undefined, { background: themeStack }, {
			background: [
				colorLayer('override'),
			],
		});

		expect(painted.map(layer => layer.id)).toEqual(['override']);
	});
});
