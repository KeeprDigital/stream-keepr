import {
	featureMatchLayoutTemplateLibrarySummary,
	listFeatureMatchLayoutTemplateLibrary,
} from '~~/server/modules/feature-match-layout-template-library';
import { requireUserId } from '~~/server/utils/auth';

/**
 * Browse the installation's Feature Match Layout Template library.
 *
 * Deliberately not under an Event, and deliberately a different path from the
 * Broadcast Graphic Template library rather than a filter on it. The two are
 * separate artifacts that share only an envelope, and a listing that could return
 * either would be one every caller had to narrow before it could use the answer.
 *
 * Layouts authored here and layouts a `.sklayout` Template Package installed appear
 * in one list, because "what can I place" is one question.
 *
 * The session is session-scoping, not access control (ADR-0010, #206).
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const entries = await listFeatureMatchLayoutTemplateLibrary(event);

	return { templates: entries.map(featureMatchLayoutTemplateLibrarySummary) };
});
