import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

/**
 * drizzle-kit numbers a new migration by its journal entry count and diffs
 * against the snapshot that sorts last, so `pnpm db:generate` works unaided
 * only while migration N is journal entry N, with its snapshot (#953).
 */
const directory = resolve(process.cwd(), 'server/db/migrations/sqlite');

interface JournalEntry {
	idx: number;
	tag: string;
}

interface Snapshot {
	id: string;
	prevId: string;
}

const journal = JSON.parse(readFileSync(resolve(directory, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] };
const migrationFiles = readdirSync(directory).filter(name => name.endsWith('.sql')).toSorted();

function snapshot(entry: JournalEntry) {
	return JSON.parse(readFileSync(resolve(directory, `meta/${entry.tag.slice(0, 4)}_snapshot.json`), 'utf8')) as Snapshot;
}

describe('the migration journal', () => {
	it('lists every migration file, in filename order', () => {
		expect(journal.entries.map(entry => `${entry.tag}.sql`)).toEqual(migrationFiles);
	});

	it.each(journal.entries.map(entry => [entry.tag, entry] as const))(
		'numbers %s by its journal position, with a snapshot of its own',
		(_tag, entry) => {
			expect(entry.tag.slice(0, 5)).toBe(`${String(entry.idx).padStart(4, '0')}_`);
			expect(existsSync(resolve(directory, `meta/${entry.tag.slice(0, 4)}_snapshot.json`))).toBe(true);
		},
	);

	it('chains each snapshot to the one before it', () => {
		const snapshots = journal.entries.map(snapshot);

		expect(snapshots.slice(1).map(entry => entry.prevId)).toEqual(snapshots.slice(0, -1).map(entry => entry.id));
	});
});
