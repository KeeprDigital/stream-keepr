import type { InboundMessage } from 'ably';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';
import { $fetchRaw, INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './helpers';

describe('talents API', () => {
	let eventId: number;
	let talentId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Talents Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a talent and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'John Caster',
				socialProfiles: {
					twitch: '  @JohnLive ',
					youtube: 'https://www.youtube.com/@JohnCasts',
					x: '',
				},
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'John Caster',
			eventId,
			socialProfiles: {
				twitch: 'JohnLive',
				youtube: 'JohnCasts',
			},
		});
		expect(res._data.id).toBeTypeOf('number');
		talentId = res._data.id;
	});

	it('lists talents for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/talents`);

		expect(data.talents).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.talents.find((t: { id: number }) => t.id === talentId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('John Caster');
		expect(found!.socialProfiles).toEqual({ twitch: 'JohnLive', youtube: 'JohnCasts' });
	});

	it('carries the complete Social Profile map in the Event response', async () => {
		const event = await $fetch(`/api/events/${eventId}`);
		const talent = event.talents.find(item => item.id === talentId);

		expect(talent).toMatchObject({
			id: talentId,
			socialProfiles: { twitch: 'JohnLive', youtube: 'JohnCasts' },
		});
	});

	it.skipIf(!integrationRealtimeConfigured)('publishes normalized complete Social Profile maps from the Talent routes', async () => {
		const realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
		const channel = realtime.channels.get(eventRealtimeChannel(eventId));
		const messages: InboundMessage[] = [];
		let resolveMessages!: () => void;
		const messagesReceived = new Promise<void>((resolve) => {
			resolveMessages = resolve;
		});
		const listener = (message: InboundMessage) => {
			messages.push(message);
			if (messages.length === 2)
				resolveMessages();
		};
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await channel.subscribe(['talent:created', 'talent:updated'], listener);
			const created = await $fetch(`/api/events/${eventId}/talents`, {
				method: 'POST',
				body: {
					name: 'Realtime Route Caster',
					socialProfiles: {
						twitch: 'https://twitch.tv/@RouteCaster',
						youtube: 'https://youtube.com/@RouteCasts',
					},
				},
			});

			await $fetch(`/api/events/${eventId}/talents/${created.id}`, {
				method: 'PATCH',
				body: {
					socialProfiles: {
						x: 'https://x.com/@RouteCaster',
						bluesky: 'https://bsky.app/profile/@RouteCaster.bsky.social',
					},
				},
			});

			await Promise.race([
				messagesReceived,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for Talent realtime messages')), 10_000);
				}),
			]);

			expect(messages.map(message => ({ name: message.name, data: message.data }))).toMatchObject([
				{
					name: 'talent:created',
					data: {
						eventId,
						talent: {
							id: created.id,
							name: 'Realtime Route Caster',
							socialProfiles: { twitch: 'RouteCaster', youtube: 'RouteCasts' },
						},
					},
				},
				{
					name: 'talent:updated',
					data: {
						eventId,
						talent: {
							id: created.id,
							name: 'Realtime Route Caster',
							socialProfiles: { x: 'RouteCaster', bluesky: 'RouteCaster.bsky.social' },
						},
					},
				},
			]);
		}
		finally {
			if (timeout)
				clearTimeout(timeout);
			channel.unsubscribe(listener);
			realtime.close();
		}
	});

	it('keeps the same Talent assigned after name and Social Profile edits', async () => {
		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: talentId },
		});

		await $fetch(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: {
				name: 'John Caster Updated',
				socialProfiles: { twitch: '@JohnStillLive' },
			},
		});

		const event = await $fetch(`/api/events/${eventId}`);
		expect(event.commentator1TalentId).toBe(talentId);
		expect(event.talents.find(item => item.id === talentId)).toMatchObject({
			id: talentId,
			name: 'John Caster Updated',
			socialProfiles: { twitch: 'JohnStillLive' },
		});
	});

	it('updates a talent name without clearing omitted Social Profiles', async () => {
		const updated = await $fetch(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: { name: 'Jane Commentator' },
		});

		expect(updated.id).toBe(talentId);
		expect(updated.name).toBe('Jane Commentator');
		expect(updated.socialProfiles).toEqual({ twitch: 'JohnStillLive' });
	});

	it('replaces the complete Social Profile set while preserving Talent identity', async () => {
		const updated = await $fetch(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: {
				socialProfiles: {
					instagram: 'https://instagram.com/JaneOnCoverage/',
					bluesky: '@jane.bsky.social',
				},
			},
		});

		expect(updated.id).toBe(talentId);
		expect(updated.name).toBe('Jane Commentator');
		expect(updated.socialProfiles).toEqual({
			instagram: 'JaneOnCoverage',
			bluesky: 'jane.bsky.social',
		});
	});

	it('allows duplicate Social Profile handles on other Talents', async () => {
		const duplicate = await $fetch(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Shared Channel Co-host',
				socialProfiles: { instagram: 'JaneOnCoverage' },
			},
		});

		expect(duplicate.socialProfiles).toEqual({ instagram: 'JaneOnCoverage' });
	});

	it('returns validation errors for malformed and wrong-network profile input', async () => {
		const malformed = await $fetchRaw(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: { socialProfiles: { twitch: 'two words' } },
			ignoreResponseError: true,
		});
		const wrongNetwork = await $fetchRaw(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: { socialProfiles: { twitch: 'https://x.com/Jane' } },
			ignoreResponseError: true,
		});

		expect(malformed.status).toBe(400);
		expect(wrongNetwork.status).toBe(400);
	});

	it('clears all Social Profiles when supplied an empty map', async () => {
		const updated = await $fetch(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: { socialProfiles: {} },
		});

		expect(updated.id).toBe(talentId);
		expect(updated.socialProfiles).toEqual({});
	});

	it('deletes a talent', async () => {
		// Create a throwaway talent
		const talent = await $fetch(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Delete Me Talent' },
		});

		const result = await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone — list should not include it
		const data = await $fetch(`/api/events/${eventId}/talents`);
		const found = data.talents.find((t: { id: number }) => t.id === talent.id);
		expect(found).toBeUndefined();
	});
});
