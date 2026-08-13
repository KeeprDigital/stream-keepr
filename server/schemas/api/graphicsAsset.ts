import { z } from 'zod';
import { GRAPHIC_ASSET_LIFECYCLE_STATES } from '~~/shared/types/graphicsAsset';

/**
 * The Library Workspace's discovery query.
 *
 * The two parameters are deliberately answered differently, because they are
 * different kinds of input. `search` is free text an author is still typing —
 * an over-long term is somebody holding a key down, not a malformed request, so
 * it is truncated exactly as the route always truncated it. `lifecycleStates`
 * names shelves from a closed set, and a name outside that set is a request
 * nobody can answer: the route cannot guess which shelf was meant, so it says
 * 400 rather than casting the value through to the library, which raised a
 * classified error that the unwrapped handler then reported as a bare 500
 * (#309).
 */
export const graphicAssetListQuerySchema = z.object({
	search: z.string().optional().transform(value => (value ?? '').slice(0, 200)),
	lifecycleStates: z.string()
		.transform(value => value.split(','))
		.pipe(z.array(z.enum(GRAPHIC_ASSET_LIFECYCLE_STATES)).min(1))
		.optional(),
});
