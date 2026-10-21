import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { BLOCKED_CLOUDFLARE_API_TOKEN } from '../../helpers/blockCloudflareCredentials.ts';

describe('the unit suite\'s Cloudflare credentials', () => {
	it('are a sentinel that authenticates nothing, so no child can use a developer\'s login', () => {
		expect(process.env.CLOUDFLARE_API_TOKEN).toBe(BLOCKED_CLOUDFLARE_API_TOKEN);
		expect(Object.keys(process.env).filter(name =>
			(name.startsWith('CLOUDFLARE_') || name.startsWith('WRANGLER_')) && name !== 'CLOUDFLARE_API_TOKEN')).toEqual([]);
	});
});
