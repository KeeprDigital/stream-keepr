import { describe, expect, it } from 'vitest';
import {
	eventRealtimeChannel,
	realtimeChannelEventId,
	screenChannelWildcard,
	screenRealtimeChannel,
} from '~~/shared/utils/realtimeChannels';

describe('realtimeChannelEventId', () => {
	it('parses the Event id out of an event room channel', () => {
		expect(realtimeChannelEventId(eventRealtimeChannel(12))).toBe(12);
	});

	it('parses the Event id out of a Screen channel', () => {
		expect(realtimeChannelEventId(screenRealtimeChannel(34, 7))).toBe(34);
	});

	it('returns null for unknown channel shapes', () => {
		expect(realtimeChannelEventId('metrics:12')).toBeNull();
		expect(realtimeChannelEventId('event')).toBeNull();
		expect(realtimeChannelEventId('')).toBeNull();
	});

	it('returns null for malformed ids', () => {
		expect(realtimeChannelEventId('event:abc')).toBeNull();
		expect(realtimeChannelEventId('screen:x:1')).toBeNull();
	});
});

describe('screenChannelWildcard', () => {
	it('matches the concrete Screen channel format', () => {
		// The wildcard grant and the concrete channel must never drift apart.
		expect(screenChannelWildcard(5)).toBe('screen:5:*');
		expect(screenRealtimeChannel(5, 9).startsWith(screenChannelWildcard(5).slice(0, -1))).toBe(true);
	});
});
