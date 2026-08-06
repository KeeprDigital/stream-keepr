import process from 'node:process';
import { errorLogFields } from '~~/server/utils/errorLogFields';
import { safeErrorLogPath } from '~~/server/utils/errorLogPath';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';

interface NitroError extends Error {
	statusCode: number;
	statusMessage?: string;
	cause?: unknown;
	unhandled?: boolean;
}

export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('error', async (_error, { event }) => {
		const error = _error as NitroError;
		mapPublicNitroError(error);

		if (!shouldSuppressIntegrationLog(error))
			console.error(JSON.stringify(errorLogFields(error, safeErrorLogPath(event?.path))));
	});
});

function shouldSuppressIntegrationLog(error: NitroError) {
	if (process.env.STREAM_KEEPR_INTEGRATION !== 'true')
		return false;
	if (error.unhandled)
		return false;

	return error.statusCode >= 400 && error.statusCode < 500;
}
