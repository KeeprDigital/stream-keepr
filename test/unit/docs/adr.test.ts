import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #181: that the ADR sequence has one record per number, and that each record
 * agrees with its own filename about which number it is.
 *
 * A pin rather than a note, because this is the defect a future edit reintroduces
 * silently. Numbers are allocated from a directory listing that is correct when it
 * is read and stale by the time it merges, and **a filename collision is not a merge
 * conflict** — git is perfectly happy holding two `0002-` files, and was, for a
 * fortnight. One round-three merge commit briefly held two `0003-` files at once and
 * nothing anywhere reported it. Reviewers do not catch this: three branches produced
 * the same number in one round and it was caught only because the merges happened to
 * be sequenced by hand.
 *
 * The header check is the other half. The rename #181 needed touched a filename, a
 * header and five citations, and a rename that moves the file while leaving the
 * header behind makes "ADR-0007" resolve to a document calling itself something else
 * — which is the same unresolvable phrase the duplicate produced, one level down.
 */

const adrDirectory = fileURLToPath(new URL('../../../docs/adr', import.meta.url));

/** `0007-broadcast-graphics-item-cap.md` → `0007`. */
const FILENAME_NUMBER = /^(\d{4})-[a-z0-9-]+\.md$/;

/** `# ADR-0007: …` on the first line, which is the shape every record uses. */
const HEADER_NUMBER = /^# ADR-(\d{4}):/;

/**
 * The directory's index, which is not a record and holds no number.
 *
 * Named as a single exception rather than matched by a pattern: the whole point
 * of the assertions below is that a file in here which is not `NNNN-slug.md` is
 * a defect, so a loose exclusion would be the check quietly declining to run.
 * Anything else that arrives without a number should fail until somebody decides
 * what it is.
 */
const INDEX = 'README.md';

const filenames = readdirSync(adrDirectory)
	.filter(name => name.endsWith('.md') && name !== INDEX)
	.sort();

describe('the ADR sequence', () => {
	it('has records to check at all', () => {
		// A directory read that stopped matching would make every assertion below
		// vacuous, and vacuous is what this whole file exists to avoid.
		expect(filenames.length).toBeGreaterThan(0);
	});

	it('names every record with a four-digit number and a slug', () => {
		expect(filenames.filter(name => !FILENAME_NUMBER.test(name))).toEqual([]);
	});

	it('gives each number to exactly one record', () => {
		// The #181 failure: `0002-broadcast-graphics-item-cap.md` and
		// `0002-concurrent-graphic-animation-phases-compose-by-nesting.md`, merged the
		// same day from two worktrees neither of which could see the other's file.
		const byNumber = new Map<string, string[]>();
		for (const name of filenames) {
			const number = FILENAME_NUMBER.exec(name)?.[1] ?? name;
			byNumber.set(number, [...byNumber.get(number) ?? [], name]);
		}

		const collisions = [...byNumber].filter(([, records]) => records.length > 1);

		expect(collisions).toEqual([]);
	});

	it('has each record call itself by the number in its filename', () => {
		const disagreements = filenames
			.map((name) => {
				const header = readFileSync(`${adrDirectory}/${name}`, 'utf8').split('\n')[0] ?? '';
				return { name, filename: FILENAME_NUMBER.exec(name)?.[1], header: HEADER_NUMBER.exec(header)?.[1] };
			})
			.filter(record => record.filename !== record.header);

		expect(disagreements).toEqual([]);
	});
});
