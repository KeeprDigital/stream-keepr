import { beforeEach, describe, expect, it } from 'vitest';
import { requestLedger } from '~~/test/integration/requestLedger';
import { expectPublishedOperation, expectResponseStatus } from '~~/test/integration/responseStatus';

beforeEach(() => requestLedger.clear());

/**
 * A status assertion that says what the server said (#633).
 *
 * A multipart part upload once answered 503 where a suite expected 200, and the
 * assertion read only `response.status`, so the body naming which store refused
 * was discarded with the run. Nobody could say why it failed.
 */
describe('expectResponseStatus', () => {
	it('lets a response with the expected status through unread', async () => {
		const response = new Response('{"stage":"transferring"}', { status: 200 });

		await expectResponseStatus(response, 200);

		expect(response.bodyUsed).toBe(false);
		await expect(response.json()).resolves.toEqual({ stage: 'transferring' });
	});

	it('fails with the status and the body the server answered', async () => {
		const response = new Response(
			'{"statusCode":503,"message":"Multipart part 1 is temporarily unavailable"}',
			{ status: 503, headers: { 'retry-after': '5' } },
		);

		await expect(expectResponseStatus(response, 200)).rejects.toThrow(
			/Multipart part 1 is temporarily unavailable[\s\S]*expected 503 to be 200/,
		);
	});

	/**
	 * A setup helper fails in a `beforeAll`, where no test has failed and so the
	 * suite's own report of the test's requests never prints (#687): the failure
	 * itself has to carry them.
	 */
	it('fails with the requests the test made', async () => {
		await requestLedger.record('PUT /api/graphics-assets/ingestion-operations/op-1/content', async () => {});

		await expect(expectResponseStatus(new Response('{}', { status: 503 }), 200)).rejects.toThrow(
			/requests:\n {2}PUT \/api\/graphics-assets\/ingestion-operations\/op-1\/content: \d+ms/,
		);
	});
});

/**
 * The content PUT that publishes a setup asset (#687). `ingestImage` read
 * `operation.result!.assetId` off whatever it was answered, so a refused upload
 * under load failed the suite's `beforeAll` as `Cannot read properties of
 * undefined (reading 'assetId')` and said nothing about why.
 */
describe('expectPublishedOperation', () => {
	const published = { id: 'op-1', stage: 'completed', result: { assetId: 'asset-1', revisionId: 'revision-1' } };

	it('hands back the operation a published upload answered', async () => {
		const operation = await expectPublishedOperation(Response.json(published));

		expect(operation.result.assetId).toBe('asset-1');
	});

	it('fails a refused upload with its status and body', async () => {
		const refused = Response.json({ statusCode: 503, message: 'Graphics staging is temporarily unavailable' }, { status: 503 });

		await expect(expectPublishedOperation(refused)).rejects.toThrow(
			/Graphics staging is temporarily unavailable[\s\S]*expected 503 to be 200/,
		);
	});

	it('fails an upload answered 200 that published nothing, naming its stage', async () => {
		const unpublished = Response.json({ id: 'op-1', stage: 'rejected', report: { code: 'still-image-undecodable' } });

		await expect(expectPublishedOperation(unpublished)).rejects.toThrow(
			/published no revision \(stage rejected\)[\s\S]*still-image-undecodable/,
		);
	});
});
