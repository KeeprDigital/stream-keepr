import type { ScreenResponse } from '~~/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { anotherBrowser } from './identities';
import { diagnoseRealtimePublishFailure, SCREEN_COMMAND_ROUTE_REFUSALS } from './realtimeDiagnosis';
import { integrationRealtimeConfigured } from './realtimeKey';

/**
 * The one lease claim that is a realtime publish. Everything else about a graphics
 * Authoring Lease runs keyless, in `graphicsAuthoringLease.test.ts`.
 */
describe('graphics Authoring Leases and Screen commands', () => {
	let eventId: number;
	let screenId: number;
	/** Two browsers of the same operator: a lease is held per session (#398, ADR-0010). */
	let browserA: string;
	let browserB: string;

	async function request(
		path: string,
		options: { body: unknown; cookie?: string },
	): Promise<{ status: number; data: any }> {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (options.cookie)
			headers.cookie = options.cookie;

		const response = await fetch(path, {
			method: 'POST',
			headers,
			body: JSON.stringify(options.body),
		});
		const text = await response.text();
		return {
			status: response.status,
			data: text
				? JSON.parse(text)
				: null,
		};
	}

	beforeAll(async () => {
		browserA = await operatorSessionCookie();
		browserB = await anotherBrowser();

		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphics Authoring Lease Realtime Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;

		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Lease Graphics Screen',
				slug: 'lease-graphics-screen',
				currentMode: 'broadcast-graphics',
			},
		});
		screenId = screen.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// A Screen command *is* a realtime publish — the route has nothing else to do — so
	// it can only answer 200 where a real Ably key is.
	it.skipIf(!integrationRealtimeConfigured)('never restricts a Screen command while the Edit workspace is leased', async () => {
		// The route's only work is the publish, so a rejected Ably key would read as a
		// lease regression without the diagnosis as the failure message.

		// The lease holder is session A; every live action below is another operator.
		const held = await request(`/api/events/${eventId}/screens/${screenId}/graphics-authoring-lease`, {
			body: {},
			cookie: browserA,
		});
		expect(held.data.outcome).toBe('grant');

		const command = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			body: { command: 'refresh' },
			cookie: browserB,
		});
		expect(command.status, diagnoseRealtimePublishFailure(command.status, command.data, SCREEN_COMMAND_ROUTE_REFUSALS)).toBe(200);

		const anonymousCommand = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			body: { command: 'refresh' },
		});
		expect(anonymousCommand.status, diagnoseRealtimePublishFailure(anonymousCommand.status, anonymousCommand.data, SCREEN_COMMAND_ROUTE_REFUSALS)).toBe(200);
	});
});
