import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATES } from '../../../scripts/verify.mjs';

const repositoryRoot = join(import.meta.dirname, '../../..');

function readDocument(name: string): string {
	return readFileSync(join(repositoryRoot, name), 'utf8');
}

/**
 * README.md is the operational guide (#706). Where it restates something a
 * script decides, these read both, so the guide cannot drift from the graph.
 */
describe('the testing guide (README.md § Testing)', () => {
	it('names every local browser gate `pnpm test` runs, in the order verify runs them', () => {
		// `pnpm accept <name>` gates in run order: verify chains them, each after
		// the one before, so follow the chain from the gate that waits on none.
		const accepts = Object.entries(GATES as Record<string, { command: string[]; after: string[] }>)
			.filter(([, gate]) => gate.command[1] === 'accept');
		const browserGates: string[] = [];
		let previous: string | undefined;
		for (;;) {
			const next = accepts.find(([, gate]) => previous === undefined
				? !gate.after.some(name => name.startsWith('accept:'))
				: gate.after.includes(previous));
			if (next === undefined)
				break;
			previous = next[0];
			browserGates.push(next[1].command[2]!);
		}

		expect(browserGates).toHaveLength(accepts.length);
		const row = readDocument('README.md').split('\n').find(line => line.startsWith('| Before commit '));

		expect(row).toBeDefined();
		const listed = row!.match(/browser gates[^|]*/u)?.[0] ?? '';

		expect([...listed.matchAll(/`([a-z-]+)`/gu)].map(match => match[1])).toEqual(browserGates);
		// The negative control: Key matte was the gate the guide once left out.
		expect(browserGates).toContain('key-matte');
	});
});

/** The documents agents and maintainers navigate between. CHANGELOG.md is generated. */
const NAVIGATED_DOCUMENTS = ['README.md', 'CONTEXT.md', 'DECISIONS.md', 'AGENTS.md'];

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
		anchors.add(count === 0 ? slug : `${slug}-${count}`);
	}
	return anchors;
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
				document = readDocument(path === '' ? name : path);
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
});
