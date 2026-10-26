import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

describe('feature match slots API', () => {
	let eventId: number;
	let matchId: number;
	let phaseId: number;
	let roundId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Feature Matches Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const phase = await $fetch(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: { name: 'Swiss' },
		});
		phaseId = phase.id;

		const round = await $fetch(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: { phaseId, name: 'Round 1', roundNumber: 1 },
		});
		roundId = round.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a feature match slot and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {
				bestOf: 3,
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			eventId,
			bestOf: 3,
			externalId: null,
			externalSource: 'manual',
		});
		expect(res._data.id).toBeTypeOf('number');
		matchId = res._data.id;
	});

	it('rejects forged FeatureMatch provenance', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {
				bestOf: 3,
				externalId: 'forged-slot',
				externalSource: 'melee',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('lists feature match slots for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/feature-match-slots`);

		expect(data.featureMatchSlots).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		// Event creation auto-creates feature match slots; our manually created one should also be here.
		const found = data.featureMatchSlots.find((m: { id: number }) => m.id === matchId);
		expect(found).toBeDefined();
		expect(found!.bestOf).toBe(3);
	});

	it('updates a feature match slot bestOf', async () => {
		const updated = await $fetch(`/api/events/${eventId}/feature-match-slots/${matchId}/setup`, {
			method: 'PATCH',
			body: { bestOf: 5 },
		});

		expect(updated.id).toBe(matchId);
		expect(updated.bestOf).toBe(5);
	});

	it('updates feature match slot with player data', async () => {
		const updated = await $fetch(`/api/events/${eventId}/feature-match-slots/${matchId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: { name: 'Alice' },
				player2Data: { name: 'Bob' },
			},
		});

		expect(updated.id).toBe(matchId);
		expect(updated.player1Data).toMatchObject({ name: 'Alice' });
		expect(updated.player2Data).toMatchObject({ name: 'Bob' });
	});

	it('updates only the table number without resubmitting player fields', async () => {
		const updated = await $fetch(`/api/events/${eventId}/feature-match-slots/${matchId}/setup`, {
			method: 'PATCH',
			body: { tableNumber: '12' },
		});

		expect(updated.id).toBe(matchId);
		expect(updated.tableNumber).toBe(12);
		expect(updated.player1Data).toMatchObject({ name: 'Alice' });
		expect(updated.player2Data).toMatchObject({ name: 'Bob' });
	});

	it('updates feature match slot with partial player metadata', async () => {
		const updated = await $fetch(`/api/events/${eventId}/feature-match-slots/${matchId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: { position: '4' },
				player2Data: {},
			},
		});

		expect(updated.id).toBe(matchId);
		expect(updated.player1Data).toEqual({ position: 4 });
		expect(updated.player2Data).toBeNull();
	});

	it('promotes a Match and returns affected Slots plus the saved Assignment', async () => {
		const sourceMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 42,
				player1Data: { name: 'Alice' },
				player2Data: { name: 'Bob' },
			},
		});
		const targetSlot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const duplicateSlot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});

		await $fetch(`/api/events/${eventId}/feature-match-slots/${duplicateSlot.id}/promote`, {
			method: 'POST',
			body: { matchId: sourceMatch.id },
		});

		const result = await $fetch(`/api/events/${eventId}/feature-match-slots/${targetSlot.id}/promote`, {
			method: 'POST',
			body: { matchId: sourceMatch.id },
		});

		expect(result.promotedSlot).toMatchObject({
			id: targetSlot.id,
			matchId: sourceMatch.id,
			tableNumber: 42,
			roundName: 'Round 1',
			player1Data: { name: 'Alice' },
			player2Data: { name: 'Bob' },
		});
		expect(result.clearedSlots).toHaveLength(1);
		expect(result.clearedSlots[0]).toMatchObject({
			id: duplicateSlot.id,
			matchId: null,
			player1Data: null,
			player2Data: null,
		});
		expect(result.assignment).toMatchObject({
			eventId,
			roundId,
			slotId: targetSlot.id,
			matchId: sourceMatch.id,
			note: null,
		});
	});

	it('re-promotes the same Match to the same Slot without replacing its Assignment or Note', async () => {
		const sourceMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 43,
				player1Data: { name: 'Same' },
				player2Data: { name: 'Slot' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});

		const first = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: sourceMatch.id },
		});
		const noted = await $fetch(`/api/events/${eventId}/feature-match-assignments/${first.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Keep this note' },
		});

		const promotedAgain = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: sourceMatch.id },
		});

		expect(promotedAgain.assignment).toMatchObject({
			id: noted.id,
			roundId,
			slotId: slot.id,
			matchId: sourceMatch.id,
			note: 'Keep this note',
		});
	});

	it('normalizes Assignment Note whitespace and treats an empty saved value as no Note', async () => {
		const sourceMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 44,
				player1Data: { name: 'Plain' },
				player2Data: { name: 'Text' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const promoted = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: sourceMatch.id },
		});

		const noted = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: '  first line\nsecond line  ' },
		});
		expect(noted.note).toBe('first line\nsecond line');

		const cleared = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: ' \n\t ' },
		});
		expect(cleared.note).toBeNull();
	});

	it('refuses a promotion that would discard a Note before changing any Assignment or Slot', async () => {
		const notedMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 45,
				player1Data: { name: 'Noted' },
				player2Data: { name: 'Match' },
			},
		});
		const replacementMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 46,
				player1Data: { name: 'New' },
				player2Data: { name: 'Match' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const promoted = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: notedMatch.id },
		});
		const noted = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Do not lose this' },
		});

		const refused = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: replacementMatch.id },
		});

		expect(refused.status).toBe(409);
		expect(refused._data.data).toMatchObject({
			code: 'feature-match-note-discard-required',
			assignments: [
				{
					assignment: { id: noted.id, matchId: notedMatch.id, note: 'Do not lose this' },
					match: { id: notedMatch.id, tableNumber: 45 },
				},
			],
		});

		const slots = await $fetch(`/api/events/${eventId}/feature-match-slots`);
		expect(slots.featureMatchSlots.find((candidate: { id: number }) => candidate.id === slot.id)).toMatchObject({
			matchId: notedMatch.id,
			activeSessionId: promoted.promotedSlot.activeSessionId,
		});
		const assignments = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			query: { roundId },
		});
		expect(assignments.featureMatchAssignments).toContainEqual(expect.objectContaining({
			id: noted.id,
			matchId: notedMatch.id,
			note: 'Do not lose this',
		}));
	});

	it('protects the direct Assignment save endpoint with the same exact Note discard confirmation', async () => {
		const notedMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 78,
				player1Data: { name: 'Direct' },
				player2Data: { name: 'Note' },
			},
		});
		const replacementMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 79,
				player1Data: { name: 'Direct' },
				player2Data: { name: 'Replacement' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const promoted = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: notedMatch.id },
		});
		const reviewed = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Protect direct saves too' },
		});

		const refused = await $fetchRaw(`/api/events/${eventId}/feature-match-assignments`, {
			method: 'POST',
			body: { roundId, slotId: slot.id, matchId: replacementMatch.id },
		});
		expect(refused.status).toBe(409);
		expect(refused._data.data).toMatchObject({
			code: 'feature-match-note-discard-required',
			assignments: [
				{
					assignment: { id: reviewed.id, note: 'Protect direct saves too' },
				},
			],
		});

		const replaced = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			method: 'POST',
			body: {
				roundId,
				slotId: slot.id,
				matchId: replacementMatch.id,
				confirmedNoteDiscards: [
					{ assignmentId: reviewed.id, updatedAt: reviewed.updatedAt },
				],
			},
		});
		expect(replaced).toMatchObject({
			roundId,
			slotId: slot.id,
			matchId: replacementMatch.id,
			note: null,
		});
	});

	it('retries a destructive replacement only with the exact Assignment version the user reviewed', async () => {
		const notedMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 47,
				player1Data: { name: 'Reviewed' },
				player2Data: { name: 'Note' },
			},
		});
		const replacementMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 48,
				player1Data: { name: 'Replacement' },
				player2Data: { name: 'Match' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const promoted = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: notedMatch.id },
		});
		const reviewed = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'The reviewed note' },
		});

		const replaced = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: {
				matchId: replacementMatch.id,
				confirmedNoteDiscards: [
					{ assignmentId: reviewed.id, updatedAt: reviewed.updatedAt },
				],
			},
		});

		expect(replaced.promotedSlot).toMatchObject({ id: slot.id, matchId: replacementMatch.id });
		expect(replaced.assignment).toMatchObject({
			matchId: replacementMatch.id,
			slotId: slot.id,
			note: null,
		});
		expect(replaced.assignment.id).not.toBe(reviewed.id);
	});

	it('refuses a stale discard confirmation with the current Note and leaves the reassignment untouched', async () => {
		const notedMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 49,
				player1Data: { name: 'Changed' },
				player2Data: { name: 'Note' },
			},
		});
		const replacementMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 50,
				player1Data: { name: 'Waiting' },
				player2Data: { name: 'Match' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const promoted = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: notedMatch.id },
		});
		const reviewed = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Version one' },
		});
		const current = await $fetch(`/api/events/${eventId}/feature-match-assignments/${promoted.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Version two' },
		});

		const refused = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: {
				matchId: replacementMatch.id,
				confirmedNoteDiscards: [
					{ assignmentId: reviewed.id, updatedAt: reviewed.updatedAt },
				],
			},
		});

		expect(refused.status).toBe(409);
		expect(refused._data.data.assignments).toEqual([
			expect.objectContaining({
				assignment: expect.objectContaining({ id: current.id, note: 'Version two', updatedAt: current.updatedAt }),
			}),
		]);
		const slots = await $fetch(`/api/events/${eventId}/feature-match-slots`);
		expect(slots.featureMatchSlots.find((candidate: { id: number }) => candidate.id === slot.id)).toMatchObject({
			matchId: notedMatch.id,
		});
	});

	it('moves a continuing Assignment with its Note and confirms only the displaced destination Note', async () => {
		const incomingMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 51,
				player1Data: { name: 'Incoming' },
				player2Data: { name: 'Match' },
			},
		});
		const displacedMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 52,
				player1Data: { name: 'Displaced' },
				player2Data: { name: 'Match' },
			},
		});
		const [sourceSlot, destinationSlot] = await Promise.all([
			$fetch(`/api/events/${eventId}/feature-match-slots`, {
				method: 'POST',
				body: { bestOf: 3 },
			}),
			$fetch(`/api/events/${eventId}/feature-match-slots`, {
				method: 'POST',
				body: { bestOf: 3 },
			}),
		]);
		const incomingPromotion = await $fetch(`/api/events/${eventId}/feature-match-slots/${sourceSlot.id}/promote`, {
			method: 'POST',
			body: { matchId: incomingMatch.id },
		});
		const displacedPromotion = await $fetch(`/api/events/${eventId}/feature-match-slots/${destinationSlot.id}/promote`, {
			method: 'POST',
			body: { matchId: displacedMatch.id },
		});
		const incomingAssignment = await $fetch(`/api/events/${eventId}/feature-match-assignments/${incomingPromotion.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Carry this Note' },
		});
		const displacedAssignment = await $fetch(`/api/events/${eventId}/feature-match-assignments/${displacedPromotion.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Confirm losing this Note' },
		});

		const refused = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${destinationSlot.id}/promote`, {
			method: 'POST',
			body: { matchId: incomingMatch.id },
		});
		expect(refused.status).toBe(409);
		expect(refused._data.data.assignments).toHaveLength(1);
		expect(refused._data.data.assignments[0].assignment).toMatchObject({
			id: displacedAssignment.id,
			note: 'Confirm losing this Note',
		});

		const moved = await $fetch(`/api/events/${eventId}/feature-match-slots/${destinationSlot.id}/promote`, {
			method: 'POST',
			body: {
				matchId: incomingMatch.id,
				confirmedNoteDiscards: [
					{ assignmentId: displacedAssignment.id, updatedAt: displacedAssignment.updatedAt },
				],
			},
		});
		expect(moved.assignment).toMatchObject({
			id: incomingAssignment.id,
			slotId: destinationSlot.id,
			matchId: incomingMatch.id,
			note: 'Carry this Note',
		});
		const assignments = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			query: { roundId },
		});
		expect(assignments.featureMatchAssignments.some((assignment: { id: number }) => assignment.id === displacedAssignment.id)).toBe(false);
	});

	it('leaves retained Assignments and Notes in another Round untouched', async () => {
		const previousRound = await $fetch(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: { phaseId, name: 'Previous Round', roundNumber: 99 },
		});
		const previousMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId: previousRound.id,
				tableNumber: 53,
				player1Data: { name: 'Previous' },
				player2Data: { name: 'Round' },
			},
		});
		const currentMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 54,
				player1Data: { name: 'Current' },
				player2Data: { name: 'Round' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const previous = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: previousMatch.id },
		});
		const notedPrevious = await $fetch(`/api/events/${eventId}/feature-match-assignments/${previous.assignment.id}`, {
			method: 'PATCH',
			body: { note: 'Historical context' },
		});

		await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: currentMatch.id },
		});

		const retained = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			query: { roundId: previousRound.id },
		});
		expect(retained.featureMatchAssignments).toContainEqual(expect.objectContaining({
			id: notedPrevious.id,
			matchId: previousMatch.id,
			note: 'Historical context',
		}));
	});

	it('promotes atomically: slot, assignment, and a fresh session land together, and re-promotion stays consistent', async () => {
		const matchA = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 5,
				player1Data: { name: 'Carol' },
				player2Data: { name: 'Dave' },
			},
		});
		const matchB = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 6,
				player1Data: { name: 'Erin' },
				player2Data: { name: 'Frank' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});

		// First promotion: match A into the slot.
		const first = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: matchA.id },
		});

		// The slot references the match, a fresh session (sequence 1) exists for it,
		// and the assignment row exists — all as a single observable outcome.
		expect(first.promotedSlot).toMatchObject({
			id: slot.id,
			matchId: matchA.id,
			player1Data: { name: 'Carol' },
		});
		expect(first.promotedSlot.activeSession).toMatchObject({ slotId: slot.id, status: 'active', sequence: 1 });
		expect(first.assignment).toMatchObject({ roundId, slotId: slot.id, matchId: matchA.id });
		const firstSessionId = first!.promotedSlot!.activeSession!.id;

		// The same invariants hold in durable storage, not just in the response.
		const afterFirst = await $fetch(`/api/events/${eventId}/feature-match-slots`);
		const storedA = afterFirst.featureMatchSlots.find((s: { id: number }) => s.id === slot.id);
		expect(storedA).toMatchObject({ matchId: matchA.id });
		expect(storedA!.activeSession).toMatchObject({ id: firstSessionId, status: 'active', sequence: 1 });

		const assignmentsA = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			query: { roundId },
		});
		const rowsForSlotA = assignmentsA.featureMatchAssignments.filter((a: { slotId: number }) => a.slotId === slot.id);
		expect(rowsForSlotA).toHaveLength(1);
		expect(rowsForSlotA[0]).toMatchObject({ matchId: matchA.id });

		// Second promotion: match B into the SAME slot reassigns consistently.
		const second = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: matchB.id },
		});

		expect(second.promotedSlot).toMatchObject({
			id: slot.id,
			matchId: matchB.id,
			player1Data: { name: 'Erin' },
		});
		// A brand-new session replaced the previous one.
		expect(second.promotedSlot.activeSession).toMatchObject({ slotId: slot.id, status: 'active', sequence: 1 });
		expect(second!.promotedSlot!.activeSession!.id).not.toBe(firstSessionId);
		expect(second.assignment).toMatchObject({ roundId, slotId: slot.id, matchId: matchB.id });

		// Exactly one assignment for the slot, now pointing at match B.
		const assignmentsB = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			query: { roundId },
		});
		const rowsForSlotB = assignmentsB.featureMatchAssignments.filter((a: { slotId: number }) => a.slotId === slot.id);
		expect(rowsForSlotB).toHaveLength(1);
		expect(rowsForSlotB[0]).toMatchObject({ matchId: matchB.id });
	});

	it('lets only one of two simultaneous promotions of one Match take it', async () => {
		const contested = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 77,
				player1Data: { name: 'Gina' },
				player2Data: { name: 'Hank' },
			},
		});
		const [lane1, lane2] = await Promise.all([
			$fetch(`/api/events/${eventId}/feature-match-slots`, {
				method: 'POST',
				body: { bestOf: 3 },
			}),
			$fetch(`/api/events/${eventId}/feature-match-slots`, {
				method: 'POST',
				body: { bestOf: 3 },
			}),
		]);

		const responses = await Promise.all([
			$fetchRaw(`/api/events/${eventId}/feature-match-slots/${lane1.id}/promote`, {
				method: 'POST',
				body: { matchId: contested.id },
			}),
			$fetchRaw(`/api/events/${eventId}/feature-match-slots/${lane2.id}/promote`, {
				method: 'POST',
				body: { matchId: contested.id },
			}),
		]);

		// Exactly one Slot ends up holding the Match: the winner's.
		const stored = await $fetch(`/api/events/${eventId}/feature-match-slots`);
		const holders = stored.featureMatchSlots.filter((slot: { matchId: number | null }) => slot.matchId === contested.id);
		expect(holders).toHaveLength(1);
		const winner = holders[0]!;
		const [winning, other, otherSlotBefore] = winner.id === lane1.id
			? [responses[0]!, responses[1]!, lane2]
			: [responses[1]!, responses[0]!, lane1];
		expect(winning.status).toBe(200);

		// The other Slot ends up empty by one of three histories, and the race picks
		// which (#572, #575). The winner's cleared Slots say whether it moved the
		// Match off the other Slot.
		// 1. The other promotion's D1 batch aborted on the one-Slot-per-Match
		//    index, leaving its Slot and Session untouched, and it answers 409.
		// 2. Its batch committed first, the winner moved the Match off before it
		//    decided its outcome, and it answers 409 having published nothing.
		// 3. Its batch committed first and it decided its outcome before the
		//    winner moved the Match off. That is a serial "promoted, then moved",
		//    so it answers 200. It must never answer 200 for a promotion the
		//    winner did not then undo.
		const movedOffOther = winning._data.clearedSlots.some((slot: { id: number }) => slot.id === otherSlotBefore.id);
		const otherSlotAfter = stored.featureMatchSlots.find((slot: { id: number }) => slot.id === otherSlotBefore.id)!;
		expect(otherSlotAfter).toMatchObject({ id: otherSlotBefore.id, matchId: null });
		if (movedOffOther) {
			expect(otherSlotAfter.activeSessionId).not.toBe(otherSlotBefore.activeSessionId);
			expect(otherSlotAfter.activeSession).toMatchObject({
				status: 'active',
				sequence: 1,
				sourceSnapshot: { matchId: null },
			});
		}
		else {
			expect(otherSlotAfter.activeSessionId).toBe(otherSlotBefore.activeSessionId);
		}
		if (other.status === 200) {
			expect(movedOffOther).toBe(true);
		}
		else {
			expect(other.status).toBe(409);
			// Classified as this promotion losing a race, not as the generic
			// "resource already exists" any unique index violation would otherwise
			// produce.
			expect(other._data.message).toContain('state was modified concurrently');
			// And marked as a lost race on the wire, because the client's conflict
			// retry replays only a marked 409 — an unmarked one is a refusal it must
			// surface instead (#381). This is the end-to-end proof the mark the
			// error hook stamps actually serializes through Nitro.
			expect(other._data.data).toEqual({ code: 'state-conflict' });
		}
		const assignments = await $fetch(`/api/events/${eventId}/feature-match-assignments`, {
			query: { roundId },
		});
		expect(assignments.featureMatchAssignments.filter(
			(assignment: { matchId: number }) => assignment.matchId === contested.id,
		)).toEqual([
			expect.objectContaining({ slotId: winner.id }),
		]);
	});

	it('keeps a Player rename and a concurrent operator command from cancelling each other', async () => {
		const player = await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Ivy Original' },
		});
		const seatedMatch = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 88,
				player1Id: player.id,
				player1Data: { name: 'Ivy Original' },
				player2Data: { name: 'Jed' },
			},
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		const promoted = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}/promote`, {
			method: 'POST',
			body: { matchId: seatedMatch.id },
		});
		const session = promoted.promotedSlot.activeSession!;

		// The rename's reverse sync corrects this Session's frozen snapshot while
		// the operator's command advances the same Session's projection. Neither
		// claims what the other claims, so both must survive — and the rename must
		// not be answered with a conflict for a Player row it already committed.
		const renaming = $fetchRaw(`/api/events/${eventId}/players/${player.id}`, {
			method: 'PATCH',
			body: { name: 'Ivy Renamed' },
		});
		// Commanded continuously for as long as the rename is in flight, rather than
		// as one simultaneous burst: the reverse sync is the last thing the rename
		// does, so a burst fired alongside it is over before the Session is touched.
		// Racing the rename against an already-resolved marker asks whether it has
		// finished without waiting for it.
		const inFlight = Symbol('rename in flight');
		const commands: { status: number }[] = [];
		const maxTicks = 200;
		let renameProgress: unknown;
		do {
			commands.push(await $fetchRaw(
				`/api/events/${eventId}/feature-match-sessions/${session.id}/commands`,
				{
					method: 'POST',
					body: {
						commandId: `rename-race:${session.id}:${commands.length}`,
						type: 'AdjustLife',
						payload: { player: 'player1', delta: -1 },
					},
				},
			));
			renameProgress = await Promise.race([
				renaming,
				Promise.resolve(inFlight),
			]);
		} while (renameProgress === inFlight && commands.length < maxTicks);
		const renamed = await renaming;

		// The rename committed a Player row, so it may not be answered with a
		// conflict whatever the Session did meanwhile.
		expect(renamed.status).toBe(200);
		// Some ticks lose their own race against each other and are told so; that is
		// the operator command policy and not what this test is about. What matters
		// is that every tick answered with success is in the projection, and the
		// rename is in the snapshot — neither erased the other.
		const accepted = commands.filter(command => command.status === 200).length;
		expect(accepted).toBeGreaterThan(0);

		const startingLife = session.currentState.player1.lifeTotal;
		const refreshed = await $fetch(`/api/events/${eventId}/feature-match-slots/${slot.id}`);
		expect(refreshed.activeSession!.currentState.player1.lifeTotal).toBe(startingLife - accepted);
		expect(refreshed.activeSession!.sourceSnapshot.player1.data!.name).toBe('Ivy Renamed');
	});

	it('clears empty player metadata to null', async () => {
		const updated = await $fetch(`/api/events/${eventId}/feature-match-slots/${matchId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: {
					name: '',
					pronouns: '',
					gameData: { type: 'mtg', deckName: '', deckColors: null },
				},
				player2Data: null,
			},
		});

		expect(updated.id).toBe(matchId);
		expect(updated.player1Data).toBeNull();
		expect(updated.player2Data).toBeNull();
	});

	it('deletes a feature match slot', async () => {
		// Create a throwaway match
		const match = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {},
		});

		const result = await $fetch(`/api/events/${eventId}/feature-match-slots/${match.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone
		const res = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${match.id}`);
		expect(res.status).toBe(404);
	});

	it('auto-creates feature match slots on event creation (default numFeatureMatches=1)', async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Auto FM Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});

		try {
			const data = await $fetch(`/api/events/${event.id}/feature-match-slots`);
			expect(data.featureMatchSlots).toHaveLength(1);
			expect(data!.featureMatchSlots[0]!.eventId).toBe(event.id);
			expect(data!.featureMatchSlots[0]!.activeSession).toBeDefined();
			expect(data!.featureMatchSlots[0]!.activeSession!.currentState).toBeDefined();
			expect(data!.featureMatchSlots[0]!.activeSession!.sequence).toBe(1);
		}
		finally {
			await $fetch(`/api/events/${event.id}`, { method: 'DELETE' });
		}
	});

	it('syncs feature match slot count when numFeatureMatches is updated', async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Sync FM Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});

		try {
			// A fresh binding per reading rather than one reassigned `let`: the
			// route-typed `$fetch` result is a large conditional type, and
			// re-checking it against a previous binding exhausts the comparison
			// depth limit.
			// Default: 1 feature match
			const initial = await $fetch(`/api/events/${event.id}/feature-match-slots`);
			expect(initial.featureMatchSlots).toHaveLength(1);

			// Increase to 3
			await $fetch(`/api/events/${event.id}`, {
				method: 'PATCH',
				body: { numFeatureMatches: 3 },
			});

			const increased = await $fetch(`/api/events/${event.id}/feature-match-slots`);
			expect(increased.featureMatchSlots).toHaveLength(3);

			// Decrease to 2
			await $fetch(`/api/events/${event.id}`, {
				method: 'PATCH',
				body: { numFeatureMatches: 2 },
			});

			const decreased = await $fetch(`/api/events/${event.id}/feature-match-slots`);
			expect(decreased.featureMatchSlots).toHaveLength(2);
		}
		finally {
			await $fetch(`/api/events/${event.id}`, { method: 'DELETE' });
		}
	});

	/**
	 * The permitted Slot counts on local D1 (#702). Each Slot row bound four
	 * parameters, so a statement inserting more than twenty-five failed D1's
	 * hundred-parameter limit.
	 */
	describe('at the permitted Slot counts', () => {
		/** The Slots in display order, each holding its first Session. */
		function expectInitialisedInOrder(slots: { sortOrder: number; activeSession?: { sequence: number } | null }[]) {
			expect(slots.map(slot => slot.sortOrder)).toEqual(slots.map((_, index) => index));
			for (const slot of slots)
				expect(slot.activeSession?.sequence).toBe(1);
		}

		it('creates an Event with fifty Slots', async () => {
			const event = await $fetch('/api/events', {
				method: 'POST',
				body: {
					name: 'Integration Fifty Slots Event',
					game: 'mtg',
					featureMatchOrientation: 'horizontal',
					numFeatureMatches: 50,
				},
			});

			try {
				expect(event.numFeatureMatches).toBe(50);
				const data = await $fetch(`/api/events/${event.id}/feature-match-slots`);
				expect(data.featureMatchSlots).toHaveLength(50);
				expectInitialisedInOrder(data.featureMatchSlots);
			}
			finally {
				await $fetch(`/api/events/${event.id}`, { method: 'DELETE' });
			}
		});

		it('increases an Event by more than twenty-five Slots, then decreases it', async () => {
			const event = await $fetch('/api/events', {
				method: 'POST',
				body: { name: 'Integration Grown Slots Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
			});

			try {
				const [first] = (await $fetch(`/api/events/${event.id}/feature-match-slots`)).featureMatchSlots;

				const grown = await $fetch(`/api/events/${event.id}`, {
					method: 'PATCH',
					body: { numFeatureMatches: 40 },
				});
				expect(grown.numFeatureMatches).toBe(40);
				const increased = await $fetch(`/api/events/${event.id}/feature-match-slots`);
				expect(increased.featureMatchSlots).toHaveLength(40);
				expectInitialisedInOrder(increased.featureMatchSlots);
				expect(increased.featureMatchSlots[0]!.id).toBe(first!.id);

				await $fetch(`/api/events/${event.id}`, {
					method: 'PATCH',
					body: { numFeatureMatches: 3 },
				});
				const decreased = await $fetch(`/api/events/${event.id}/feature-match-slots`);
				expect(decreased.featureMatchSlots.map(slot => slot.id))
					.toEqual(increased.featureMatchSlots.slice(0, 3).map(slot => slot.id));
			}
			finally {
				await $fetch(`/api/events/${event.id}`, { method: 'DELETE' });
			}
		});
	});
});
