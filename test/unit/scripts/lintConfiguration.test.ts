import fs from 'node:fs';
import { join, sep } from 'node:path';
import { ESLint } from 'eslint';
import { expect, it, vi } from 'vitest';

const generated = join(import.meta.dirname, '../../../.nuxt') + sep;

// Only `nuxt prepare` writes `.nuxt` (README § Testing): lint runs beside a typecheck that
// reads it, and the generated config's own `withNuxt()` rewrites a file there as it resolves.
it('resolving the lint configuration writes nothing into .nuxt', async () => {
	const written: string[] = [];
	const writeFile = fs.promises.writeFile.bind(fs.promises);
	vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (file, ...rest) => {
		// Held back, so a run that goes red here has not itself written beside the typecheck.
		if (String(file).startsWith(generated))
			written.push(String(file).slice(generated.length));
		else
			await writeFile(file, ...rest);
	});

	await new ESLint().calculateConfigForFile('nuxt.config.ts');

	expect(written).toEqual([]);
});
