import type { GraphicInputDeclaration, GraphicInputValue } from '../../types/graphics';
import { GRAPHIC_INPUT_KEY_PATTERN } from '../../types/graphics';
import { findGraphicInputDeclaration, graphicInputTextValue } from './inputs';

/**
 * Graphic Text Templates.
 *
 * A template is literal text combined with `{inputKey}` placeholders, and a
 * placeholder is a reference to a stable Graphic Input key — nothing else. There
 * is no property access, formatting, fallback, conditional, or expression to
 * parse, which is what keeps this a substitution rather than an evaluator.
 *
 * A brace run that does not name a valid key is text the author typed, and stays
 * literal. That is the only sensible reading of it: refusing to render an
 * authored `100% {of 3}` would lose real content, and rendering it as a missing
 * value would lose it silently.
 */

/** One run of a parsed template: literal text, or one placeholder's rendering. */
export interface GraphicTextTemplateSegment {
	text: string;
	/** Present when this run came from a `{inputKey}` placeholder. */
	inputKey?: string;
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

function isInputKey(candidate: string): boolean {
	return GRAPHIC_INPUT_KEY_PATTERN.test(candidate);
}

/**
 * The template's runs, with every placeholder still empty.
 *
 * Parsing is separate from rendering so the editor can find which Graphic Inputs
 * a template references without holding any values.
 */
export function parseGraphicTextTemplate(template: string): GraphicTextTemplateSegment[] {
	const segments: GraphicTextTemplateSegment[] = [];
	let literalStart = 0;

	for (const match of template.matchAll(PLACEHOLDER)) {
		const key = match[1] ?? '';
		if (!isInputKey(key))
			continue;

		const literal = template.slice(literalStart, match.index);
		if (literal.length > 0)
			segments.push({ text: literal });
		segments.push({ text: '', inputKey: key });
		literalStart = match.index + match[0].length;
	}

	const tail = template.slice(literalStart);
	if (tail.length > 0 || segments.length === 0)
		segments.push({ text: tail });

	return segments;
}

/** Which Graphic Inputs this template references, once each, in template order. */
export function graphicTextTemplateInputKeys(template: string): string[] {
	const keys = parseGraphicTextTemplate(template)
		.map(segment => segment.inputKey)
		.filter((key): key is string => key !== undefined);
	return [...new Set(keys)];
}

/**
 * The template's runs with each placeholder rendered from the value of the
 * Graphic Input it names.
 *
 * A placeholder naming an input this Broadcast Graphic does not declare renders
 * nothing, and so does one whose value is unavailable. Both are absences rather
 * than errors: a Text Graphic Item is one item of a composition and must keep
 * rendering the literal text around a value it cannot show.
 */
export function renderGraphicTextTemplate(
	template: string,
	declarations: readonly GraphicInputDeclaration[] | undefined,
	values: Readonly<Record<string, GraphicInputValue>>,
): GraphicTextTemplateSegment[] {
	return parseGraphicTextTemplate(template).map((segment) => {
		if (segment.inputKey === undefined)
			return segment;

		const declaration = findGraphicInputDeclaration(declarations, segment.inputKey);
		return {
			text: declaration ? graphicInputTextValue(declaration, values[segment.inputKey]) : '',
			inputKey: segment.inputKey,
		};
	});
}

/** Whether this template renders any Graphic Input at all. */
export function hasGraphicTextTemplatePlaceholders(template: string): boolean {
	return parseGraphicTextTemplate(template).some(segment => segment.inputKey !== undefined);
}
