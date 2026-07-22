export function cardTimeoutService() {
	const setCardTimeout = async (eventId: number, timeoutDurationMs: number, screenId: number, originConnectionId?: string) => {
		// Publish a timeout message that will expire after the specified duration
		// This message will be automatically removed by Ably when it expires
		await publishMessage(eventId, 'card:timeout', {
			timeoutDuration: timeoutDurationMs,
			expiresAt: Date.now() + timeoutDurationMs,
			screenId,
		}, originConnectionId);
	};

	const clearCardTimeout = async (eventId: number, screenId: number, originConnectionId?: string) => {
		// Publish a message to cancel any pending timeout
		await publishMessage(eventId, 'card:timeout:cancel', { screenId }, originConnectionId);
	};

	return {
		setCardTimeout,
		clearCardTimeout,
	};
}
