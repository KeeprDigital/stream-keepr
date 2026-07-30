import type {
	GraphicAsset,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_STILL_IMAGE_INGESTION_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

const authorHeaders: Record<string, string> = {
	'x-graphics-author-id': 'integration-remote-copy-author',
};
const otherAuthorHeaders: Record<string, string> = {
	'x-graphics-author-id': 'integration-remote-copy-intruder',
};

async function initiateRemoteCopy(idempotencyKey: string, name: string) {
	return await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		headers: authorHeaders,
		body: {
			idempotencyKey,
			name,
			source: 'remote-copy',
			sourceFileName: 'remote-scoreboard.png',
		},
	});
}

async function copyRemoteSource(operationId: string, sourceUrl: string) {
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${operationId}/remote-copy`,
		{
			method: 'POST',
			headers: { ...authorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ sourceUrl }),
		},
	);
	return {
		status: response.status,
		operation: response.ok
			? await response.json() as GraphicsIngestionOperation
			: undefined,
	};
}

describe('the approved remote HTTPS copy API', () => {
	beforeAll(async () => {
		const cookie = await createGraphicsAuthorSessionCookie();
		authorHeaders.cookie = cookie;
		otherAuthorHeaders.cookie = cookie;
	});

	it('initiates a durable remote copy bounded by the still-image limit and reconnects to it', async () => {
		const initiated = await initiateRemoteCopy(
			'integration-remote-copy-initiation',
			'Integration remote copy',
		);
		expect(initiated).toMatchObject({
			source: 'remote-copy',
			stage: 'created',
			transferredByteLength: 0,
			declaredByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
		});

		const reconnected = await initiateRemoteCopy(
			'integration-remote-copy-initiation',
			'Integration remote copy',
		);
		expect(reconnected).toEqual(initiated);

		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'Integration remote copy' },
		})).resolves.toEqual([]);
	});

	it('rejects an initiation that declares a byte length for a remote copy', async () => {
		const response = await fetch('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { ...authorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({
				idempotencyKey: 'integration-remote-copy-declared-length',
				name: 'Invalid remote copy',
				source: 'remote-copy',
				declaredByteLength: 128,
			}),
		});
		expect(response.status).toBe(400);
	});

	it.each([
		{
			label: 'a plaintext HTTP destination',
			sourceUrl: 'http://cdn.example.test/scoreboard.png',
			code: 'remote-source-not-https',
		},
		{
			label: 'the loopback interface',
			sourceUrl: 'https://127.0.0.1/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'the loopback hostname',
			sourceUrl: 'https://localhost:3000/api/graphics-assets',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'a private network address',
			sourceUrl: 'https://192.168.1.1/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'the cloud metadata address',
			sourceUrl: 'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'embedded credentials',
			sourceUrl: 'https://user:secret@cdn.example.test/scoreboard.png',
			code: 'remote-source-credentials-present',
		},
	] as const)('reports $label as a permanent failure and leaves the library unchanged', async ({
		label,
		sourceUrl,
		code,
	}) => {
		// The idempotency key is durable author-supplied state, so it must never
		// be derived from the source URL.
		const initiated = await initiateRemoteCopy(
			`integration-remote-copy-rejection-${label.replaceAll(' ', '-')}`,
			`Rejected remote copy ${code}`,
		);

		const { status, operation } = await copyRemoteSource(initiated.id, sourceUrl);
		expect(status).toBe(200);
		expect(operation).toMatchObject({
			stage: 'failed',
			transferredByteLength: 0,
			failure: { code: 'remote-source-rejected', retryable: false },
			report: { outcome: 'rejected', issues: [{ code }] },
		});
		expect(JSON.stringify(operation)).not.toContain('secret');

		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'Rejected remote copy' },
		})).resolves.toEqual([]);
	});

	it('serves no staged source while an operation is not awaiting confirmation', async () => {
		const initiated = await initiateRemoteCopy(
			'integration-remote-copy-staged-source',
			'Unstaged remote copy',
		);

		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/staged-source`,
			{ headers: authorHeaders },
		);
		expect(response.status).toBe(404);

		const anonymous = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/staged-source`,
		);
		expect(anonymous.status).toBe(401);
	});

	it('refuses browser confirmation before the report is ready', async () => {
		const initiated = await initiateRemoteCopy(
			'integration-remote-copy-early-confirmation',
			'Unconfirmable remote copy',
		);

		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/browser-evidence`,
			{
				method: 'POST',
				headers: { ...authorHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({
					outcome: 'decoded',
					sourceDigest: '0'.repeat(64),
					width: 1,
					height: 1,
				}),
			},
		);
		expect(response.status).toBe(409);
	});

	it('keeps a remote copy operation private to its initiating author', async () => {
		const initiated = await initiateRemoteCopy(
			'integration-remote-copy-isolation',
			'Private remote copy',
		);

		const foreignCopy = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/remote-copy`,
			{
				method: 'POST',
				headers: { ...otherAuthorHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({ sourceUrl: 'https://cdn.example.test/scoreboard.png' }),
			},
		);
		expect(foreignCopy.status).toBe(404);

		const foreignStagedSource = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/staged-source`,
			{ headers: otherAuthorHeaders },
		);
		expect(foreignStagedSource.status).toBe(404);
	});
});
