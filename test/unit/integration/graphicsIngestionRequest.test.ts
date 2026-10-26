import { describe, expect, it } from 'vitest';
import { graphicsIngestionRequest } from '~~/test/integration/graphicsIngestionRequest';

// Integration suites share one library and one pixel PNG, and the API defaults the
// duplicate-content policy to `reuse`; the helper makes silence mean isolation.
// ESLint (`no-restricted-syntax` in `test/integration`) keeps suites on it.
describe('the body of a Graphics Ingestion Operation initiation', () => {
	it('isolates by default, so a suite that says nothing cannot be handed another suite\'s asset', () => {
		expect(graphicsIngestionRequest({ idempotencyKey: 'a-suite-that-said-nothing' }))
			.toEqual({ idempotencyKey: 'a-suite-that-said-nothing', duplicateContentPolicy: 'create-separate' });
	});

	it('lets the suite that means reuse ask for it, and keeps everything else', () => {
		expect(graphicsIngestionRequest({
			idempotencyKey: 'k',
			name: 'n',
			declaredByteLength: 92,
			duplicateContentPolicy: 'reuse' as const,
		}))
			.toEqual({
				idempotencyKey: 'k',
				name: 'n',
				declaredByteLength: 92,
				duplicateContentPolicy: 'reuse',
			});
	});
});
