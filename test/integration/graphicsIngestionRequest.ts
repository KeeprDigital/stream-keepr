import type { GraphicsDuplicateContentPolicy } from '~~/shared/types/graphicsAsset';

/**
 * The body of a Graphics Ingestion Operation initiation, with the
 * duplicate-content policy stated rather than inherited.
 *
 * Every integration suite runs against one library, and the API's own default is
 * `reuse` (`initiateGraphicsIngestion` and `initiateRemoteGraphicAssetCopy` in
 * `server/modules/graphics-asset-library/index.ts`). A suite that omits the policy
 * and happens to ingest the same bytes as another suite therefore does not publish
 * its own Graphic Asset — it is handed the other suite's, and every later assertion
 * in both suites is about one asset two files believe they own. #159 diagnosed
 * exactly that, and the failure reads as a code regression rather than as a test
 * that took something.
 *
 * Defaulting here to `create-separate` inverts what an author has to remember. A
 * suite that says nothing gets isolation; a suite that wants reuse asks for it and
 * says so in the same line. `graphicsAssetIngestion.test.ts` is the suite that
 * genuinely exercises reuse, and it now passes `'reuse'` where it means it.
 *
 * The default alone is not the guarantee — a suite could always build the body by
 * hand and skip this function. `test/unit/integration/graphicsIngestionRequest.test.ts`
 * is what makes it one: it reads every integration source and fails when an
 * initiation whose policy the server honours does not come through here.
 *
 * This endpoint takes three sources — `local-upload`, `remote-copy` and
 * `template-package` (`index.post.ts:81`). The first two read the policy from the
 * request; `template-package` pins `create-separate` inside the library
 * (`index.ts:4018`) whatever the request said, so a policy stated on one of those
 * would be a field the server discards. Replacements do not appear here at all —
 * they go through `graphics-assets/[assetId]/replacement-operations.post.ts`.
 *
 * A body that names no source *is* a `local-upload`: `index.post.ts:72`
 * preprocesses the missing case into the explicit one before the union sees it.
 * The two spellings are one request, and both need this.
 */
export function graphicsIngestionRequest<T extends object>(
	body: T,
): { duplicateContentPolicy: GraphicsDuplicateContentPolicy } & T {
	return { duplicateContentPolicy: 'create-separate', ...body };
}
