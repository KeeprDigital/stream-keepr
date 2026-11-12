import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '../../..');

function readDocument(name: string): string {
	return readFileSync(join(repositoryRoot, name), 'utf8');
}

/** The documents agents and maintainers navigate between. CHANGELOG.md is generated. */
const NAVIGATED_DOCUMENTS = [
	'README.md',
	'CONTEXT.md',
	'DECISIONS.md',
	'AGENTS.md',
];

/** Markdown without its fenced code blocks, which hold no heading or link. */
function withoutFences(markdown: string): string {
	return markdown.replace(/^```[\s\S]+?^```/gmu, '');
}

/** Markdown with inline code defused too, so a bracket in a code span reads as no link. */
function prose(markdown: string): string {
	return withoutFences(markdown).replace(/`[^`\n]*`/gu, match => match.replace(/[[\]()#]/gu, ''));
}

/** GitHub's heading anchors: lower-cased, punctuation dropped, spaces hyphenated, repeats numbered. */
function headingAnchors(markdown: string): Set<string> {
	const seen = new Map<string, number>();
	const anchors = new Set<string>();
	for (const [, text] of withoutFences(markdown).matchAll(/^#{1,6} (.+)$/gmu)) {
		const slug = text!.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '').replace(/ /gu, '-');
		const count = seen.get(slug) ?? 0;
		seen.set(slug, count + 1);
		anchors.add(count === 0
			? slug
			: `${slug}-${count}`);
	}
	return anchors;
}

/** Where a document names repository files: a word of code starting at one of these. */
const NAMED_PATH = /^(?:test|scripts|server|app|shared)\//u;

/**
 * The repository paths a document names in code, inline or fenced, without a
 * trailing `:line` or `#anchor`. A glob or a placeholder (`*`, `<gate>`,
 * `{a,b}`, `…`) names no one path.
 */
function namedRepositoryPaths(markdown: string): string[] {
	const code = [
		...markdown.matchAll(/^```[\s\S]+?^```/gmu),
		...withoutFences(markdown).matchAll(/`[^`\n]+`/gu),
	].map(([block]) => block.replaceAll('`', ' '));
	const words = code.flatMap(block => block.split(/\s+/u)).map(word => word.replace(/^['"(]+/u, ''));
	const paths = words
		.filter(word => NAMED_PATH.test(word) && !/[*<>{}$…]|\.{3}/u.test(word))
		.map(word => word.replace(/[:#].*$/u, '').replace(/['",;)]+$/u, ''));
	return [
		...new Set(paths),
	];
}

describe('local document references', () => {
	it('derives anchors the way GitHub renders them', () => {
		const anchors = headingAnchors([
			'## ADR-0005: `static-font-v1`\'s server-side checks are a floor; the browser is the gate',
			'### Graphics Asset Library',
			'```bash',
			'# not a heading',
			'```',
			'### Graphics Asset Library',
		].join('\n'));

		expect([...anchors]).toEqual([
			'adr-0005-static-font-v1s-server-side-checks-are-a-floor-the-browser-is-the-gate',
			'graphics-asset-library',
			'graphics-asset-library-1',
		]);
	});

	it.each(NAVIGATED_DOCUMENTS)('%s links only to files and headings that exist', (name) => {
		const broken: string[] = [];
		for (const [, target] of prose(readDocument(name)).matchAll(/\]\(([^)\s]+)\)/gu)) {
			if (/^[a-z]+:/u.test(target!))
				continue;
			const [path, anchor] = target!.split('#') as [string, string | undefined];
			let document: string;
			try {
				document = readDocument(path === ''
					? name
					: path);
			}
			catch {
				broken.push(target!);
				continue;
			}
			if (anchor !== undefined && !headingAnchors(document).has(anchor))
				broken.push(target!);
		}

		expect(broken).toEqual([]);
	});

	it('reads the repository paths a document names in code, and nothing that names no one path', () => {
		const paths = namedRepositoryPaths([
			'`scripts/accept.mjs` is run as `node scripts/verify.mjs --quick`; see `server/api/events/[eventId]/index.get.ts:12`.',
			'No one path: `test/unit/**/*.test.ts`, `scripts/run-<gate>.mjs`, `pnpm test`, and scripts/prose.mjs outside code.',
			'```bash',
			'node "scripts/fenced.mjs"',
			'```',
		].join('\n'));

		expect(paths).toEqual([
			'scripts/fenced.mjs',
			'scripts/accept.mjs',
			'scripts/verify.mjs',
			'server/api/events/[eventId]/index.get.ts',
		]);
	});

	// A document that names a file a later change moved or deleted sends its reader nowhere.
	it.each(NAVIGATED_DOCUMENTS)('%s names only repository paths that exist', (name) => {
		const missing = namedRepositoryPaths(readDocument(name)).filter(path => !existsSync(join(repositoryRoot, path)));

		expect(missing).toEqual([]);
	});
});
