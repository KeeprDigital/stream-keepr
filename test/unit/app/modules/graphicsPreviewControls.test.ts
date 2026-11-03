import { describe, expect, it } from 'vitest';
import { previewZoomScroll, previewZoomShortcut, wheelPreviewZoom } from '~~/app/modules/graphics/previewControls';

/**
 * Zooming and panning an editor preview: how far a wheel step zooms, which keys
 * fit or show the canvas at 100%, and where the view scrolls so the canvas point
 * under the pointer stays under it.
 */

const CANVAS = { width: 1920, height: 1080 };
const CLIENT = { width: 960, height: 540 };

describe('preview zoom', () => {
	it.each([
		{
			case: 'a wheel up zooms in',
			scale: 1,
			deltaY: -100,
			deltaMode: 0,
			expected: 1.2214,
		},
		{
			case: 'a wheel down zooms out',
			scale: 1,
			deltaY: 100,
			deltaMode: 0,
			expected: 0.8187,
		},
		{
			case: 'a line-mode step counts as 16 pixels a line',
			scale: 1,
			deltaY: -6.25,
			deltaMode: 1,
			expected: 1.2214,
		},
		{
			case: 'a pinch zooms by a little',
			scale: 2,
			deltaY: -5,
			deltaMode: 0,
			expected: 2.0201,
		},
		{
			case: 'it stops at 800%',
			scale: 7.9,
			deltaY: -1000,
			deltaMode: 0,
			expected: 8,
		},
		{
			case: 'it stops at 10%',
			scale: 0.11,
			deltaY: 1000,
			deltaMode: 0,
			expected: 0.1,
		},
	])('$case', ({ scale, deltaY, deltaMode, expected }) => {
		expect(wheelPreviewZoom(scale, { deltaY, deltaMode })).toBeCloseTo(expected, 4);
	});

	it.each([
		{
			case: '⌘0 fits',
			key: '0',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			expected: 'fit',
		},
		{
			case: 'Ctrl-0 fits',
			key: '0',
			metaKey: false,
			ctrlKey: true,
			shiftKey: false,
			altKey: false,
			expected: 'fit',
		},
		{
			case: '⌘1 is 100%',
			key: '1',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			expected: 1,
		},
		{
			case: 'Ctrl-1 is 100%',
			key: '1',
			metaKey: false,
			ctrlKey: true,
			shiftKey: false,
			altKey: false,
			expected: 1,
		},
		{
			case: '⌘0 on AZERTY, where 0 needs Shift, fits from the physical key',
			key: 'à',
			code: 'Digit0',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			expected: 'fit',
		},
		{
			case: 'Ctrl-1 on AZERTY is 100% from the physical key',
			key: '&',
			code: 'Digit1',
			metaKey: false,
			ctrlKey: true,
			shiftKey: false,
			altKey: false,
			expected: 1,
		},
		{
			case: 'a bare 0 is typing',
			key: '0',
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			expected: null,
		},
		{
			case: '⇧⌘0 is someone else\'s',
			key: '0',
			metaKey: true,
			ctrlKey: false,
			shiftKey: true,
			altKey: false,
			expected: null,
		},
		{
			case: '⌥⌘1 is someone else\'s',
			key: '1',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: true,
			expected: null,
		},
		{
			case: '⌘2 is not a preview zoom',
			key: '2',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			expected: null,
		},
	])('$case', ({ case: _case, expected, ...event }) => {
		expect(previewZoomShortcut(event)).toBe(expected);
	});

	it.each([
		{
			case: 'zooming in at the centre keeps the centre',
			from: 0.5,
			to: 1,
			scroll: { left: 0, top: 0 },
			pointer: { x: 480, y: 270 },
			expected: { left: 480, top: 270 },
		},
		{
			case: 'zooming in at the top-left corner stays there',
			from: 0.5,
			to: 2,
			scroll: { left: 0, top: 0 },
			pointer: { x: 0, y: 0 },
			expected: { left: 0, top: 0 },
		},
		{
			case: 'zooming in at the bottom-right corner scrolls to the end',
			from: 0.5,
			to: 1,
			scroll: { left: 0, top: 0 },
			pointer: { x: 960, y: 540 },
			expected: { left: 960, top: 540 },
		},
		{
			case: 'zooming in from a scrolled view keeps the point under the pointer',
			from: 1,
			to: 2,
			scroll: { left: 480, top: 270 },
			pointer: { x: 100, y: 50 },
			expected: { left: 1060, top: 590 },
		},
		{
			case: 'zooming in from a centred, smaller canvas',
			from: 0.25,
			to: 1,
			scroll: { left: 0, top: 0 },
			pointer: { x: 480, y: 270 },
			expected: { left: 480, top: 270 },
		},
		{
			case: 'zooming out below the view centres it with nothing to scroll',
			from: 1,
			to: 0.25,
			scroll: { left: 480, top: 270 },
			pointer: { x: 480, y: 270 },
			expected: { left: 0, top: 0 },
		},
		{
			case: 'it never scrolls before the canvas\'s start',
			from: 0.25,
			to: 1,
			scroll: { left: 0, top: 0 },
			pointer: { x: 240, y: 135 },
			expected: { left: 0, top: 0 },
		},
	])('$case', ({ from, to, scroll, pointer, expected }) => {
		expect(previewZoomScroll({
			canvas: CANVAS,
			client: CLIENT,
			scroll,
			pointer,
			from,
			to,
		})).toEqual(expected);
	});
});
