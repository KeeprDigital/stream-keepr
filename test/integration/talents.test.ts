import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

// What the Talent routes publish is in `talents.realtime.test.ts`, the only part that needs the Ably key.

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

	it('allows duplicate Social Profile handles on other Talents', async () => {
		const duplicate = await $fetch(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Shared Channel Co-host',
				socialProfiles: { twitch: 'JohnStillLive' },
			},
		});

		expect(duplicate.socialProfiles).toEqual({ twitch: 'JohnStillLive' });
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
