/**
 * A real R2 bucket binding from Miniflare, through Wrangler's platform proxy, so
 * the R2 object-store adapter runs against R2 semantics rather than a hand-made fake.
 * It starts a Workers runtime: create one per suite, not per test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

export interface MiniflareR2Harness {
	bucket: R2Bucket;
	dispose: () => Promise<void>;
}

export async function createMiniflareR2Harness(): Promise<MiniflareR2Harness> {
	const directory = mkdtempSync(join(tmpdir(), 'stream-keepr-miniflare-r2-'));
	const configPath = join(directory, 'wrangler.json');
	writeFileSync(configPath, JSON.stringify({
		name: 'stream-keepr-r2-contract',
		compatibility_date: '2026-01-01',
		r2_buckets: [
			{ binding: 'BUCKET', bucket_name: 'contract' },
		],
	}));
	const proxy = await getPlatformProxy<{ BUCKET: R2Bucket }>({ configPath, persist: false });
	return {
		bucket: proxy.env.BUCKET,
		dispose: async () => {
			await proxy.dispose();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
