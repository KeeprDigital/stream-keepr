import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MTG_CARD_BORDER_RADIUS } from '~~/shared/utils/card/size';

/**
 * A Magic card's corner rounding has two spellings: `--mtg-card-radius` (behind the
 * `mtg-card` utility) for templates, and `MTG_CARD_BORDER_RADIUS` for inline
 * styles. Neither may drift from the other, and no component may spell the radius
 * itself — a hand-written radius is how card faces came to disagree.
 */

const MAIN_CSS = resolve(process.cwd(), 'app/assets/css/main.css');
const APP_ROOT = resolve(process.cwd(), 'app');

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory())
			return sourceFiles(path);
		return /\.(?:vue|ts|css)$/.test(path)
			? [path]
			: [];
	});
}

describe('magic card corner radius', () => {
	it('declares the same radius in CSS and TypeScript', () => {
		const declared = readFileSync(MAIN_CSS, 'utf8').match(/--mtg-card-radius:([^;]+);/)?.[1]?.trim();
		expect(declared).toBe(MTG_CARD_BORDER_RADIUS);
	});

	it('is spelled by no component of its own', () => {
		const offenders = sourceFiles(APP_ROOT)
			.filter(path => path !== MAIN_CSS)
			.filter(path => readFileSync(path, 'utf8').includes('4.75%'))
			.map(path => relative(process.cwd(), path));
		expect(offenders).toEqual([]);
	});
});
