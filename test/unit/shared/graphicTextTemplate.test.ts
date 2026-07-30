import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	graphicInputTextValue,
	graphicTextTemplateInputKeys,
	parseGraphicTextTemplate,
	renderGraphicTextTemplate,
} from '~~/shared/modules/graphics';

function text(key: string, overrides: Partial<GraphicInputDeclaration> = {}): GraphicInputDeclaration {
	return {
		type: 'text',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: '',
		maxLength: 1000,
		...overrides,
	} as GraphicInputDeclaration;
}

describe('graphicTextTemplate', () => {
	it('reads a template with no placeholder as one run of literal text', () => {
		expect(parseGraphicTextTemplate('Live from Melbourne')).toEqual([
			{ text: 'Live from Melbourne' },
		]);
	});

	it('splits literal text from each {inputKey} placeholder', () => {
		expect(parseGraphicTextTemplate('{firstName} {lastName} — {team}')).toEqual([
			{ text: '', inputKey: 'firstName' },
			{ text: ' ' },
			{ text: '', inputKey: 'lastName' },
			{ text: ' — ' },
			{ text: '', inputKey: 'team' },
		]);
	});

	it('keeps a brace that names nothing as literal text', () => {
		// A placeholder references a stable input key and nothing else — no property
		// access, formatting, fallbacks, conditionals, or expressions — so anything
		// that is not one of those keys is text an author typed.
		expect(parseGraphicTextTemplate('100% {of 3} {}')).toEqual([
			{ text: '100% {of 3} {}' },
		]);
	});

	it('lists the referenced input keys once each, in template order', () => {
		expect(graphicTextTemplateInputKeys('{name} vs {name} in {round}')).toEqual(['name', 'round']);
	});

	it('renders each placeholder from the accepted value of the input it names', () => {
		const rendered = renderGraphicTextTemplate(
			'{name} — {team}',
			[text('name'), text('team')],
			{ name: 'Ava Reed', team: 'Blue' },
		);

		expect(rendered.map(segment => segment.text).join('')).toBe('Ava Reed — Blue');
		expect(rendered[0]).toEqual({ text: 'Ava Reed', inputKey: 'name' });
	});

	it('renders a placeholder naming an undeclared input as nothing', () => {
		const rendered = renderGraphicTextTemplate('[{ghost}]', [], {});

		expect(rendered.map(segment => segment.text).join('')).toBe('[]');
	});

	it('renders nothing for a value that violates its declared constraints', () => {
		// Unavailable rather than coerced: a value too long for its declared bound is
		// not truncated into something shorter, it simply does not render.
		const rendered = renderGraphicTextTemplate(
			'{name}',
			[text('name', { maxLength: 4 } as Partial<GraphicInputDeclaration>)],
			{ name: 'Ava Reed' },
		);

		expect(rendered.map(segment => segment.text).join('')).toBe('');
	});

	it('renders a choice value as the label an operator picked', () => {
		const declaration: GraphicInputDeclaration = {
			type: 'choice',
			key: 'side',
			label: 'Side',
			required: false,
			updatePolicy: 'staged',
			default: null,
			options: [{ value: 'l', label: 'Left' }, { value: 'r', label: 'Right' }],
		};

		expect(graphicInputTextValue(declaration, 'r')).toBe('Right');
	});

	it('renders a number without formatting it, and a toggle or media not at all', () => {
		// Broadcast-formatted values are a field-catalogue concern; a placeholder
		// substitutes a value rather than presenting it.
		expect(graphicInputTextValue({
			type: 'number',
			key: 'life',
			label: 'Life',
			required: false,
			updatePolicy: 'staged',
			default: null,
			integer: true,
		}, 20)).toBe('20');

		expect(graphicInputTextValue({
			type: 'toggle',
			key: 'flag',
			label: 'Flag',
			required: false,
			updatePolicy: 'staged',
			default: false,
		}, true)).toBe('');
	});
});
