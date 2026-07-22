import type { FeatureMatchOverlayBoxStyle } from '~~/shared/types/screenConfig';

export type FeatureMatchOverlayTokenValues = Record<string, string | number | null | undefined>;

export interface FeatureMatchOverlayTemplateSegment {
	text: string;
	deckColors: boolean;
	spacer?: boolean;
	spacerWidth?: string;
	token?: string;
	style?: FeatureMatchOverlayBoxStyle;
}

export type FeatureMatchOverlayTemplateLines = FeatureMatchOverlayTemplateSegment[][];
export type FeatureMatchOverlayTemplateTokenStyleMap = Record<string, FeatureMatchOverlayBoxStyle | undefined>;
export interface FeatureMatchOverlayTemplateRenderOptions {
	spacerWidth?: number;
}

const TOKEN_RE = /\{([a-z][a-zA-Z0-9]*)\}/g;
const SPACER_TOKEN = 'spacer';
const MULTI_SPACE_RE = /[ \t]{2,}/g;
const LEADING_SEPARATOR_RE = /^\s*[•|,-]\s+/;
const TRAILING_SEPARATOR_RE = /\s+[•|,-]\s*$/;
export const DEFAULT_FEATURE_MATCH_OVERLAY_SPACER_WIDTH = 32;

export function cleanupFeatureMatchOverlayTemplate(value: string): string {
	return value
		.replace(/\s+[•|,-]\s*$/gm, '')
		.replace(/^\s*[•|,-]\s+/gm, '')
		.replace(/\s{2,}/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

export function renderFeatureMatchOverlayTemplate(template: string, values: FeatureMatchOverlayTokenValues): string {
	const rendered = template.replace(TOKEN_RE, (_, key: string) => {
		if (key === SPACER_TOKEN)
			return ' ';

		const value = values[key];
		return value == null ? '' : String(value);
	});
	return cleanupFeatureMatchOverlayTemplate(rendered);
}

function spacerWidthCss(width: number | undefined) {
	const safeWidth = typeof width === 'number' && Number.isFinite(width)
		? Math.max(0, width)
		: DEFAULT_FEATURE_MATCH_OVERLAY_SPACER_WIDTH;
	return `${safeWidth}px`;
}

function appendSpacerSegment(lines: FeatureMatchOverlayTemplateLines, spacerWidth: string) {
	lines[lines.length - 1]!.push({
		text: '',
		deckColors: false,
		spacer: true,
		spacerWidth,
		token: undefined,
		style: undefined,
	});
}

function appendLiteralTextPart(
	lines: FeatureMatchOverlayTemplateLines,
	text: string,
	token?: string,
	style?: FeatureMatchOverlayBoxStyle,
) {
	if (!text)
		return;

	lines[lines.length - 1]!.push({
		text,
		deckColors: token === 'deckColors',
		token,
		style,
	});
}

function appendLiteralTextWithSpacers(
	lines: FeatureMatchOverlayTemplateLines,
	text: string,
	token?: string,
	style?: FeatureMatchOverlayBoxStyle,
) {
	if (token) {
		appendLiteralTextPart(lines, text, token, style);
		return;
	}

	let cursor = 0;
	for (const match of text.matchAll(MULTI_SPACE_RE)) {
		appendLiteralTextPart(lines, text.slice(cursor, match.index));
		appendSpacerSegment(lines, `${match[0].length}ch`);
		cursor = match.index + match[0].length;
	}

	appendLiteralTextPart(lines, text.slice(cursor));
}

function appendTextSegment(lines: FeatureMatchOverlayTemplateLines, text: string, token?: string, style?: FeatureMatchOverlayBoxStyle) {
	const parts = text.split('\n');
	for (const [index, part] of parts.entries()) {
		if (index > 0)
			lines.push([]);
		if (!part)
			continue;
		appendLiteralTextWithSpacers(lines, part, token, style);
	}
}

function trimLineSeparators(line: FeatureMatchOverlayTemplateSegment[]): FeatureMatchOverlayTemplateSegment[] {
	const trimmed = line
		.map(segment => ({ ...segment }))
		.filter(segment => segment.spacer || segment.text.length > 0);

	while (trimmed.length > 0 && !trimmed[0]!.token) {
		trimmed[0]!.text = trimmed[0]!.text.replace(LEADING_SEPARATOR_RE, '').trimStart();
		if (trimmed[0]!.text)
			break;
		trimmed.shift();
	}

	while (trimmed.length > 0 && !trimmed[trimmed.length - 1]!.token) {
		const last = trimmed[trimmed.length - 1]!;
		last.text = last.text.replace(TRAILING_SEPARATOR_RE, '').trimEnd();
		if (last.text)
			break;
		trimmed.pop();
	}

	return trimmed;
}

/**
 * Render tokenized Feature Match Overlay template text while preserving token metadata
 * for styled tokens and special deck-color rendering.
 */
export function renderFeatureMatchOverlayTemplateLines(
	template: string,
	values: FeatureMatchOverlayTokenValues,
	tokenStyles?: FeatureMatchOverlayTemplateTokenStyleMap,
	options: FeatureMatchOverlayTemplateRenderOptions = {},
): FeatureMatchOverlayTemplateLines {
	const lines: FeatureMatchOverlayTemplateLines = [[]];
	let cursor = 0;

	for (const match of template.matchAll(TOKEN_RE)) {
		appendTextSegment(lines, template.slice(cursor, match.index));
		const key = match[1]!;
		if (key === SPACER_TOKEN) {
			appendSpacerSegment(lines, spacerWidthCss(options.spacerWidth));
		}
		else {
			const value = values[key];
			if (value != null && String(value).length > 0)
				appendTextSegment(lines, String(value), key, tokenStyles?.[key]);
		}
		cursor = match.index + match[0].length;
	}

	appendTextSegment(lines, template.slice(cursor));

	return lines
		.map(trimLineSeparators)
		.filter(line => line.length > 0);
}
