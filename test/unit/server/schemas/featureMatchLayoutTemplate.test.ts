import { describe, expect, it } from 'vitest';
import { updateFeatureMatchLayoutTemplateSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';

/**
 * The Feature Match Layout Template library's revise surface.
 *
 * `revision` is required on every revise, so it is present in every valid body and
 * cannot on its own mean "change this". A body carrying nothing else is a revise
 * with nothing to revise: accepting it would burn a revision number and hand every
 * other author holding the template a stale precondition, for no change they could
 * ever see.
 */
describe('revising a Feature Match Layout Template', () => {
	it('refuses a patch carrying only the revision it read', () => {
		const parsed = updateFeatureMatchLayoutTemplateSchema.safeParse({ revision: 3 });

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues.map(issue => issue.message))
			.toContain('A template revision must change something');
	});

	/**
	 * The other side of the same rule, so the refusal above is the schema being
	 * specific rather than the schema refusing everything.
	 */
	it('accepts a patch carrying the revision and one field to change', () => {
		expect(updateFeatureMatchLayoutTemplateSchema.safeParse({ revision: 3, name: 'Renamed' }).success)
			.toBe(true);
		// `null` clears a description, and is a change like any other.
		expect(updateFeatureMatchLayoutTemplateSchema.safeParse({ revision: 3, description: null }).success)
			.toBe(true);
	});

	/**
	 * An omissible precondition is an inert one: a caller with no revision to state
	 * has not read the template it is revising.
	 */
	it('refuses a patch that changes something without stating the revision it read', () => {
		expect(updateFeatureMatchLayoutTemplateSchema.safeParse({ name: 'Renamed' }).success).toBe(false);
	});
});
