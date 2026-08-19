import type { FeatureMatchNoteDiscardConflict } from '~~/shared/api';
import { failureStatus } from '~/utils/failureStatus';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

export function featureMatchNoteDiscardConflict(caught: unknown): FeatureMatchNoteDiscardConflict | null {
	if (failureStatus(caught) !== 409 || !isRecord(caught))
		return null;
	const body = caught.data;
	if (!isRecord(body) || !isRecord(body.data))
		return null;
	const conflict = body.data;
	if (conflict.code !== 'feature-match-note-discard-required' || !Array.isArray(conflict.assignments))
		return null;
	return conflict as unknown as FeatureMatchNoteDiscardConflict;
}
