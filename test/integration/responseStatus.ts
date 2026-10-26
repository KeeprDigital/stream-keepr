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
	return [
		'requests:',
		...requestLedger.report().map(line => `  ${line}`),
	].join('\n');
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

/** An operation that reached a result — published, reused, or a revision — so `result` is there to read. */
export type OperationWithResult = GraphicsIngestionOperation & { result: NonNullable<GraphicsIngestionOperation['result']> };

/**
 * Require that an operation reached a result, or fail with its stage, what it
 * answered and the requests made so far (#687). For an answer read some other
 * way — a `$fetch`, which throws on a refusal but not on a 200 that published
 * nothing.
 */
export function expectResultOf(operation: GraphicsIngestionOperation, answered = JSON.stringify(operation)): OperationWithResult {
	if (!operation.result)
		expect.fail(`operation reached no result (stage ${operation.stage}): ${answered}\n${requestsSoFar()}`);
	return operation as OperationWithResult;
}

/**
 * Read the operation a content upload answered, requiring that it reached a
 * result.
 *
 * The setup helpers that ingest a fixture read `operation.result!.assetId`
 * straight off the answer, so a refused upload under load failed the suite's
 * `beforeAll` as a `TypeError` on `undefined` with nothing said about why
 * (#687). This checks the status and the result and fails with the body and
 * the requests instead. It does not retry: a refusal is the finding.
 */
export async function expectOperationResult(response: Response): Promise<OperationWithResult> {
	await expectResponseStatus(response, 200);
	const body = await response.text();
	return expectResultOf(JSON.parse(body) as GraphicsIngestionOperation, body);
}
