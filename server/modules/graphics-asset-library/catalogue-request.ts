import { GraphicsAssetLibraryError } from './errors';
import { logGraphicsStoreFailure } from './store-failure-log';

/**
 * Runs one catalogue request, answering any failure that is not already the
 * library's own as retryably unavailable with `message`.
 */
export async function catalogueRequest<T>(
	request: () => Promise<T>,
	message: string,
): Promise<T> {
	try {
		return await request();
	}
	catch (error) {
		if (error instanceof GraphicsAssetLibraryError)
			throw error;
		// The failure log reads only the nearest code, which is ours; what the
		// catalogue threw is logged here or nowhere (#633).
		logGraphicsStoreFailure('graphics_catalogue_unavailable', { refusal: message }, error);
		throw new GraphicsAssetLibraryError(
			message,
			'graphics-asset-library-unavailable',
			{ cause: error },
		);
	}
}
