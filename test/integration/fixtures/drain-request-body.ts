import { getBoundedRequestBodyStream } from '../../../server/utils/payloadLimits';

export default defineEventHandler(async (event) => {
	const stream = getBoundedRequestBodyStream(event);
	if (!stream)
		throw createError({ statusCode: 400, statusMessage: 'Request body required' });

	const reader = stream.getReader();
	let receivedBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;
			receivedBytes += value.byteLength;
		}
	}
	finally {
		reader.releaseLock();
	}

	return { receivedBytes };
});
