import process from 'node:process';
import { safeErrorLogPath } from '~~/server/utils/errorLogPath';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';

interface NitroError extends Error {
	statusCode: number;
	statusMessage?: string;
	cause?: unknown;
	unhandled?: boolean;
}

function errorLogFields(error: NitroError, path: string | undefined) {
	const cause = error.cause;
	const causeRecord = cause && typeof cause === 'object'
		? cause as { name?: unknown; code?: unknown; category?: unknown; notFound?: unknown }
		: null;
	return {
		message: 'api_request_failed',
		path: path ?? null,
		statusCode: error.statusCode,
		errorName: typeof causeRecord?.name === 'string' ? causeRecord.name : error.name,
		errorCode: typeof causeRecord?.code === 'string' ? causeRecord.code : null,
		unhandled: error.unhandled ?? false,
	};
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
