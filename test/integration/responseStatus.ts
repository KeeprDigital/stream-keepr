import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { expect } from 'vitest';
import { requestLedger } from './requestLedger';

/**
 * The requests the current test made, as a failure message's tail.
 *
 * `./requestLedgerReport.ts` prints them when a test fails, but a setup helper
 * fails in a `beforeAll`, where no test has (#687), so its message carries them.
 */
function requestsSoFar(): string {
	return ['requests:', ...requestLedger.report().map(line => `  ${line}`)].join('\n');
}

/**
 * Assert a raw response's status, and on a mismatch fail with its body (#633)
 * and the requests made so far (#687).
 *
 * `expect(response.status).toBe(200)` throws away the one account the server
 * gave of a refusal: a 503 part upload failed a run with nothing to say which
 * store refused or why. The body is read only on a mismatch, from a clone, so a
 * caller that goes on to read the response on success still can.
 *
 * Its own module, importing only vitest and the import-free request ledger, so
 * it can be tested without a server.
 */
export async function expectResponseStatus(response: Response, expected: number): Promise<void> {
	if (response.status === expected)
		return;
	const body = await response.clone().text().catch((error: unknown) => `<body unreadable: ${String(error)}>`);
	expect(response.status, `response body: ${body}\n${requestsSoFar()}`).toBe(expected);
}

/** An operation that published its revision, so `result` is there to read. */
export type PublishedOperation = GraphicsIngestionOperation & { result: NonNullable<GraphicsIngestionOperation['result']> };

/**
 * Read the operation a content upload answered, requiring that it published.
 *
 * The setup helpers that ingest a fixture read `operation.result!.assetId`
 * straight off the answer, so a refused upload under load failed the suite's
 * `beforeAll` as a `TypeError` on `undefined` with nothing said about why
 * (#687). This checks the status and the result and fails with the body and
 * the requests instead. It does not retry: a refusal is the finding.
 */
export async function expectPublishedOperation(response: Response): Promise<PublishedOperation> {
	await expectResponseStatus(response, 200);
	const body = await response.text();
	const operation = JSON.parse(body) as GraphicsIngestionOperation;
	if (!operation.result)
		expect.fail(`upload published no revision (stage ${operation.stage}): ${body}\n${requestsSoFar()}`);
	return operation as PublishedOperation;
}
