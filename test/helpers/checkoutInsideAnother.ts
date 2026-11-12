import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repositoryRoot = join(import.meta.dirname, '../..');

function write(path: string, content: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

/**
 * This checkout's own tsconfig files, laid out as an agent's worktree is: inside
 * a main checkout whose `tsconfig.json` extends a `.nuxt` that is cleared, as it
 * is while `nuxt prepare` runs there. `files` are copied as they stand.
 */
export function checkoutInsideOneBeingPrepared(files: string[]): { checkout: string; remove: () => void } {
	// The real path: macOS's temp directory is a symlink, and a tsconfig's `include` is matched against real paths.
	const main = mkdtempSync(join(realpathSync(tmpdir()), 'checkout-inside-another-'));
	const checkout = join(main, '.claude/worktrees/agent');
	write(join(main, 'tsconfig.json'), readFileSync(join(repositoryRoot, 'tsconfig.json'), 'utf8'));
	for (const file of files)
		write(join(checkout, file), readFileSync(join(repositoryRoot, file), 'utf8'));
	return {
		checkout,
		remove: () => rmSync(main, { recursive: true, force: true }),
	};
}
