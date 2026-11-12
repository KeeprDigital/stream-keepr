/**
 * A stand-in for the Ably REST client the server publishes through, recording
 * what each channel was sent so a suite can drive the real `server/utils/ably`.
 *
 * Usage:
 *   const ably = createAblyRestFake();
 *   vi.doMock('ably', () => ably.module);
 *   vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));
 */

/** One message as a subscriber to `channel` would receive it. */
export interface PublishedRealtimeMessage {
	channel: string;
	type: string;
	/** The message without its envelope's `eventId` and `timestamp`. */
	payload: Record<string, unknown>;
}

interface BatchSpec {
	channels: string[];
	messages: Array<{ name: string; data: unknown; encoding?: string }>;
}

function refusal(channel: string) {
	return Object.assign(new Error(`Refused ${channel}`), { statusCode: 500, code: 50000 });
}

function received(channel: string, type: string, data: unknown, encoding?: string): PublishedRealtimeMessage {
	// A batch publish carries its data as the SDK's own publish encodes an object.
	const decoded = encoding === 'json'
		? JSON.parse(data as string)
		: data;
	const { eventId: _eventId, timestamp: _timestamp, ...payload } = decoded as Record<string, unknown>;
	return {
		channel,
		type,
		payload: JSON.parse(JSON.stringify(payload)),
	};
}

export function createAblyRestFake() {
	const published: PublishedRealtimeMessage[] = [];
	/** The channels each batch request named, in request order. */
	const batches: string[][] = [];
	const refusing = new Map<string, number>();
	let refusedBatches = 0;
	let heldBatch: Promise<unknown> | null = null;
	let batchAsked: (() => void) | null = null;

	function refuses(channel: string): boolean {
		const left = refusing.get(channel) ?? 0;
		if (left <= 0)
			return false;
		refusing.set(channel, left - 1);
		return true;
	}

	class Rest {
		channels = {
			get: (channel: string) => ({
				publish: async (type: string, data: unknown) => {
					if (refuses(channel))
						throw refusal(channel);
					published.push(received(channel, type, data));
				},
			}),
		};

		async batchPublish(specs: BatchSpec[]) {
			batches.push(specs.flatMap(spec => spec.channels));
			const held = heldBatch;
			heldBatch = null;
			batchAsked?.();
			batchAsked = null;
			await held;
			if (refusedBatches > 0) {
				refusedBatches -= 1;
				throw refusal('batch');
			}
			return specs.map((spec) => {
				const results = spec.channels.map((channel) => {
					if (refuses(channel)) {
						return {
							channel,
							error: refusal(channel),
						};
					}
					for (const message of spec.messages)
						published.push(received(channel, message.name, message.data, message.encoding));
					return {
						channel,
						messageId: 'id',
						serials: spec.messages.map(() => 'serial'),
					};
				});
				const failureCount = results.filter(result => 'error' in result).length;
				return { successCount: results.length - failureCount, failureCount, results };
			});
		}
	}

	return {
		module: {
			default: { Rest },
		},
		published,
		batches,
		/** What `channel` received, in order. */
		on: (channel: string) => published.filter(message => message.channel === channel),
		/** Refuse the next `times` publishes to `channel`, however they arrive. */
		refuse(channel: string, times = Number.POSITIVE_INFINITY) {
			refusing.set(channel, times);
		},
		/** Refuse the next `times` batch requests whole. */
		refuseBatches(times: number) {
			refusedBatches = times;
		},
		/** Keep the next batch request pending until `until` settles; later requests are answered at once. */
		holdNextBatch(until: Promise<unknown>) {
			heldBatch = until;
		},
		/** Resolves once the next batch request has been made, answered or not. */
		nextBatchAsked() {
			return new Promise<void>((resolve) => {
				batchAsked = resolve;
			});
		},
		reset() {
			published.length = 0;
			batches.length = 0;
			refusing.clear();
			refusedBatches = 0;
			heldBatch = null;
			batchAsked = null;
		},
	};
}
