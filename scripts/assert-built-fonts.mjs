/**
 * Assert the built CSS carries every application font face the registry
 * declares, and that none of them loads from the network.
 *
 * Nuxt Fonts' npm provider skips a weight file a `@fontsource/*` package does
 * not have, without a warning (ADR-0086), so the configuration alone proves
 * nothing: a family can build with its 800 gone and paint a synthesised bold.
 * This reads the built stylesheets back and holds each declared family x weight
 * x style against them. A family has one rule per subset, so a weight and style
 * are present when any one face covers them; a `font-weight: 100 900` range
 * covers every declared weight inside it. The metric-adjusted
 * `"<Family> Fallback: …"` faces Nuxt Fonts generates are not the family and
 * are not counted as it.
 *
 * Two ways a scan passes while seeing nothing, both closed: it refuses a
 * directory with no `.css` in it, and `selfTest` runs first, parsing a face the
 * checker must read and a fallback it must ignore. `pnpm worker:dry-run` runs
 * it against `.output/public`, so `pnpm run deploy` reaches it before promotion.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { GRAPHIC_FONTS } from '../shared/modules/graphics/typography.ts';

/** The declared matrix: one entry per packaged application font. */
export const DECLARED_FONT_FACES = GRAPHIC_FONTS
	.filter(font => font.package !== undefined)
	.map(font => ({ family: font.package.family, weights: font.package.weights, italic: font.package.italic }));

const FONT_FACE_RULE = /@font-face\s*\{([^}]*)\}/g;
const REMOTE_URL = /^(?:https?:)?\/\//i;

function declaration(body, property) {
	return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]*)`, 'i').exec(body)?.[1].trim();
}

/** Every real `@font-face` in `css`: family, weight range, style, and `url()` sources. */
export function parseFontFaces(css) {
	const faces = [];
	for (const [, body] of css.matchAll(FONT_FACE_RULE)) {
		const family = declaration(body, 'font-family')?.replace(/^["']|["']$/g, '').replace(/\\(.)/g, '$1');
		if (!family || family.includes(' Fallback: '))
			continue;
		const [low, high = low] = (declaration(body, 'font-weight') ?? '400').split(/\s+/).map(Number);
		faces.push({
			family,
			weight: [low, high],
			style: declaration(body, 'font-style') ?? 'normal',
			urls: [
				...body.matchAll(/url\(([^)]*)\)/g),
			].map(match => match[1].trim().replace(/^["']|["']$/g, '')),
		});
	}
	return faces;
}

/** One line per defect, each starting with its code. */
export function findFontDefects(faces, expected) {
	const defects = [];
	for (const face of faces) {
		for (const url of face.urls.filter(candidate => REMOTE_URL.test(candidate)))
			defects.push(`font-remote-url: ${face.family} ${face.weight.join('-')} ${face.style} loads ${url}`);
	}
	for (const { family, weights, italic } of expected) {
		for (const style of italic
			? ['normal', 'italic']
			: ['normal']) {
			for (const weight of weights) {
				const present = faces.some(face => face.family === family && face.style === style
					&& face.weight[0] <= weight && weight <= face.weight[1]);
				if (!present)
					defects.push(`font-face-missing: ${family} ${weight} ${style} is declared but not in the built CSS`);
			}
		}
	}
	return defects;
}

function* stylesheets(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory())
			yield* stylesheets(entryPath);
		else if (entry.name.endsWith('.css'))
			yield entryPath;
	}
}

/** Defects across every `.css` under `directory`; throws when there is none to read. */
export function assertBuiltFonts(directory, expected) {
	const files = [
		...stylesheets(directory),
	];
	if (files.length === 0)
		throw new Error(`font-nothing-scanned: no .css under ${directory}. A scan of nothing is not a pass.`);
	return findFontDefects(files.flatMap(file => parseFontFaces(readFileSync(file, 'utf8'))), expected);
}

/** Proves the parser reads a real face and ignores a fallback, before trusting a clean scan. */
function selfTest() {
	const faces = parseFontFaces('@font-face{font-family:"A";src:url(./a.woff2)format("woff2");font-weight:400;font-style:normal}'
		+ '@font-face{font-family:A Fallback\\: B;src:local(B);size-adjust:90%}');
	return faces.length === 1 && faces[0].family === 'A' && faces[0].urls[0] === './a.woff2'
		? []
		: ['the parser did not read a planted face — this scan cannot fail.'];
}

/** `{ ok, lines }` like the sibling scans, so `worker:dry-run` can print every verdict. */
export function builtFontsScan(directory, expected = DECLARED_FONT_FACES) {
	const broken = selfTest();
	if (broken.length > 0) {
		return {
			ok: false,
			lines: [
				'assert-built-fonts: SELF-TEST FAILED —',
				...broken.map(line => `  ${line}`),
			],
		};
	}
	let defects;
	try {
		defects = assertBuiltFonts(directory, expected);
	}
	catch (error) {
		return {
			ok: false,
			lines: [`assert-built-fonts: ${error.message}`],
		};
	}
	return defects.length > 0
		? {
				ok: false,
				lines: [
					'assert-built-fonts: the built CSS does not hold the declared application fonts.',
					...defects.map(line => `  ${line}`),
				],
			}
		: {
				ok: true,
				lines: [`assert-built-fonts: every declared application font face is in the built CSS under ${directory}, none remote`],
			};
}

/** `node scripts/assert-built-fonts.mjs <build public dir>` */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [target] = process.argv.slice(2);
	if (!target) {
		process.stderr.write('assert-built-fonts: name the build public directory to scan.\n');
		process.exit(1);
	}
	const scan = builtFontsScan(target);
	for (const line of scan.lines)
		(scan.ok ? process.stdout : process.stderr).write(`${line}\n`);
	process.exit(scan.ok ? 0 : 1);
}
