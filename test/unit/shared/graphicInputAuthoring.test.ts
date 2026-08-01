import type { BroadcastGraphicConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicInput,
	deleteGraphicInput,
	graphicInputKeyFromLabel,
	patchGraphicInput,
	patchGraphicPlaceholderStyle,
	setGraphicInputChoiceOptions,
} from '~~/shared/modules/graphics';

function textItem(overrides: Partial<TextGraphicItemConfig> = {}): TextGraphicItemConfig {
	return {
		type: 'text',
		id: 'name-line',
		label: 'Name line',
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 600,
		height: 120,
		text: '{name} — {title}',
		typography: {
			font: { kind: 'application', fontId: 'inter' },
			fontSize: 48,
			fontWeight: 700,
			fontStyle: 'normal',
			textTransform: 'none',
			letterSpacing: 0,
			lineHeight: 1.2,
			textAlign: 'left',
			color: '#ffffff',
		},
		overflowPolicy: 'ellipsis',
		minFontSize: 24,
		...overrides,
	};
}

function stack(overrides: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig[] {
	return [{ id: 'lower-third', name: 'Lower Third', items: [textItem()], ...overrides }];
}

describe('graphicInputAuthoring', () => {
	it('derives a stable key from a label and keeps it unique', () => {
		expect(graphicInputKeyFromLabel('Presenter Name', [])).toBe('presenter-name');
		expect(graphicInputKeyFromLabel('Presenter Name', ['presenter-name'])).toBe('presenter-name-2');
		// A label with nothing usable in it still yields a key a placeholder can name.
		expect(graphicInputKeyFromLabel('—', [])).toBe('input');
	});

	it('declares a new Graphic Input optional and staged', () => {
		const [graphic] = addGraphicInput(stack(), 'lower-third', 'text');

		expect(graphic!.inputs).toEqual([{
			type: 'text',
			key: 'input-1',
			label: 'Input 1',
			required: false,
			updatePolicy: 'staged',
			default: '',
			maxLength: 1000,
		}]);
	});

	it('merges into one declaration without disturbing the others', () => {
		let graphics = addGraphicInput(stack(), 'lower-third', 'text');
		graphics = addGraphicInput(graphics, 'lower-third', 'toggle');

		const patched = patchGraphicInput(graphics, 'lower-third', 'input-1', {
			label: 'Presenter name',
			required: true,
			updatePolicy: 'live',
		});

		expect(patched[0]!.inputs![0]).toMatchObject({ key: 'input-1', label: 'Presenter name', required: true, updatePolicy: 'live' });
		expect(patched[0]!.inputs![1]).toMatchObject({ key: 'input-2', type: 'toggle' });
	});

	/**
	 * A Graphic Input's label is what an operator reads beside its field in Live
	 * Control, and the write path requires at least one character of it. An author
	 * clearing the field is mid-rename rather than asking for a nameless input, so the
	 * previous name stands.
	 */
	it('refuses a blank label, which is a Graphic Input the write path rejects', () => {
		const graphics = addGraphicInput(stack(), 'lower-third', 'text');

		expect(patchGraphicInput(graphics, 'lower-third', 'input-1', { label: '' })).toEqual(graphics);
		expect(patchGraphicInput(graphics, 'lower-third', 'input-1', { label: '   ' })).toEqual(graphics);
		// The other properties of the same patch are not lost to the refusal: a caller
		// that sends a blank label sends nothing else worth keeping either.
		expect(patchGraphicInput(graphics, 'lower-third', 'input-1', { label: 'Presenter' })[0]!.inputs![0])
			.toMatchObject({ label: 'Presenter' });
	});

	it('replaces a choice Graphic Input’s options and ignores other kinds', () => {
		let graphics = addGraphicInput(stack(), 'lower-third', 'choice');
		graphics = setGraphicInputChoiceOptions(graphics, 'lower-third', 'input-1', [
			{ value: 'l', label: 'Left' },
		]);

		expect(graphics[0]!.inputs![0]).toMatchObject({ type: 'choice', options: [{ value: 'l', label: 'Left' }] });
	});

	it('drops the binding and Graphic Placeholder Style of a Graphic Input it stops declaring', () => {
		const graphics = stack({
			inputs: [{ type: 'text', key: 'title', label: 'Title', required: false, updatePolicy: 'staged', default: '', maxLength: 20 }],
			bindings: [{ inputKey: 'title', sourceKey: 'player', fieldId: 'player.name' }],
			items: [textItem({ placeholderStyles: { title: { fontWeight: 300 }, name: { fontWeight: 900 } } })],
		});

		const [graphic] = deleteGraphicInput(graphics, 'lower-third', 'title');
		const item = graphic!.items[0] as TextGraphicItemConfig;

		expect(graphic!.inputs).toEqual([]);
		expect(graphic!.bindings).toEqual([]);
		expect(item.placeholderStyles).toEqual({ name: { fontWeight: 900 } });
		// The author's own `{title}` text is left alone; it renders nothing until they
		// declare that key again or edit it away.
		expect(item.text).toBe('{name} — {title}');
	});

	it('merges into one placeholder’s typography override and removes it wholesale', () => {
		const graphic = stack()[0]!;

		const styled = patchGraphicPlaceholderStyle(graphic, 'name-line', 'title', { fontWeight: 300 });
		const restyled = patchGraphicPlaceholderStyle(styled, 'name-line', 'title', { color: '#ff0000' });
		const cleared = patchGraphicPlaceholderStyle(restyled, 'name-line', 'title', null);

		expect((restyled.items[0] as TextGraphicItemConfig).placeholderStyles)
			.toEqual({ title: { fontWeight: 300, color: '#ff0000' } });
		expect((cleared.items[0] as TextGraphicItemConfig).placeholderStyles).toBeUndefined();
	});
});
