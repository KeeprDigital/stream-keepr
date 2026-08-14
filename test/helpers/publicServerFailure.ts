import type { MappableNitroError } from '~~/server/utils/nitroErrorMapping';

/**
 * What a caller actually receives from a route that refused: its error, after the
 * sanitizer.
 *
 * A route test that asserts on the error it caught is asserting on something no client
 * ever sees. Every 5xx passes through `mapPublicNitroError` in the error plugin, and
 * that is where an unclassified one has its message replaced with 'Internal Server
 * Error' — so a route whose fix is "carry a cause the mapper can read" passes its own
 * assertions just as happily with the cause dropped. #294 established the shape for one
 * module (`broadcastGraphicsLiveSessionWiring.sqlite.test.ts`) and #321 needed it at
 * seven route sites at once, which is what this is doing here rather than there.
 *
 * **The mapper is imported at call time, and that is load-bearing.** These route tests
 * call `vi.resetModules()` and then `import()` the route, so the route's copy of
 * `server/utils/errors` is a *different* module instance from the one a static import in
 * this file would have bound. Every `instanceof` in the mapper then reads false, the
 * refusal looks unclassified, and a correctly classified route fails its pin — the
 * bundled-twice trap, arriving in the flattering direction for once. Importing here puts
 * the mapper in whichever registry the caller is currently using.
 *
 * The mapper mutates in place, the way the plugin calls it; the same object is returned
 * for readability at the call site.
 */
export async function publicServerFailure(thrown: unknown): Promise<MappableNitroError> {
	const { mapPublicNitroError } = await import('~~/server/utils/nitroErrorMapping');
	const failure = thrown as MappableNitroError;
	mapPublicNitroError(failure);
	return failure;
}

/**
 * The refusal a rejected handler produced, or a failure saying it did not reject.
 *
 * `rejects.toMatchObject` cannot be used for these assertions, because the thing being
 * asserted about is the error *after* the mapper has run over it. Awaiting the rejection
 * first is what gives a test something to hand to `publicServerFailure`, and a handler
 * that resolves has to fail loudly rather than leave `undefined` to be asserted against.
 */
export async function refusalFrom(operation: Promise<unknown>): Promise<MappableNitroError> {
	const thrown = await operation.then(() => null, (error: unknown) => error);
	if (thrown === null)
		throw new Error('expected the handler to reject, and it resolved');
	return await publicServerFailure(thrown);
}
