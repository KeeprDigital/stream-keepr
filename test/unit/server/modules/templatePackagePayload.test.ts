import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { templatePackagePayloads } from '~~/server/modules/template-package-payload';
import { GRAPHIC_ITEM_KINDS } from '~~/shared/modules/graphics/itemDefinitions';
import { TEMPLATE_PACKAGE_KINDS } from '~~/shared/types/templatePackage';
import { maximalBroadcastGraphicDocument } from '../../../helpers/broadcastGraphicDocument';

const asset = { assetId: 'asset-1', revisionId: 'revision-1' };

function skgraphic() {
	return templatePackagePayloads('skgraphic');
}

function read(document: unknown) {
	return skgraphic().readInstallableDocument(document);
}

function rejectionCodes(document: unknown) {
	const outcome = read(document);
	if (outcome.outcome !== 'rejected')
		throw new Error('Expected the document to be refused');
	return [...new Set(outcome.issues.map(issue => issue.code))];
}

describe('the Template Package payload registry', () => {
	/**
	 * The envelope carries several artifacts and each one's payload decides what its
	 * document has to be. A kind added to the envelope without an entry here would be
	 * carried as unread data — a package installing a Template nothing can use, with
	 * nothing anywhere reporting a problem.
	 */
	it('answers for every Template Package kind the envelope carries', () => {
		for (const kind of TEMPLATE_PACKAGE_KINDS) {
			const payload = templatePackagePayloads(kind);
			expect(payload.packageKind).toBe(kind);
			expect(typeof payload.readInstallableDocument).toBe('function');
		}
	});
});

describe('the `.skgraphic` payload', () => {
	it('reads a Broadcast Graphic and reports the capabilities it requires', () => {
		const outcome = read(maximalBroadcastGraphicDocument({ asset }));

		expect(outcome.outcome).toBe('read');
		if (outcome.outcome !== 'read')
			return;
		// Every Graphic Item Definition the document uses is named, a Graphic Group's
		// children included: a receiver that never learned a child's Definition could
		// accept a package holding a kind it cannot render.
		//
		// Compared against the shared vocabulary rather than a written list, so it also
		// pins that the fixture still uses every kind. A Definition added to
		// `GRAPHIC_ITEM_KINDS` and never placed in the fixture is a branch of the
		// transfer nobody is holding to anything, and this is where that shows up.
		const definitions = outcome.capabilities
			.filter(requirement => requirement.capability === 'graphic-item-definition')
			.map(requirement => requirement.identity)
			.sort();
		expect(definitions).toEqual([...GRAPHIC_ITEM_KINDS].sort());
		// And the application fonts, which travel as identifiers rather than bytes.
		expect(outcome.capabilities.some(requirement =>
			requirement.capability === 'application-font' && requirement.identity === 'inter',
		)).toBe(true);
	});

	/**
	 * The point of reading the document at all. A package whose Template is
	 * well-formed JSON but not a Broadcast Graphic would otherwise install as a
	 * Template that nothing can place, render, or repair.
	 */
	it('refuses a document that is not a Broadcast Graphic', () => {
		expect(rejectionCodes({ backdrop: asset })).toEqual(['invalid-template-document']);
		expect(rejectionCodes('a lower third')).toEqual(['invalid-template-document']);
		expect(rejectionCodes(null)).toEqual(['invalid-template-document']);
	});

	/**
	 * Placing a template rewrites its Graphic Item ids and rewrites every stagger
	 * that names one, resolving an old id through one flat map across the top level
	 * and every Graphic Group's children. A document with a colliding id makes that
	 * map ambiguous, so a placement would rewrite one container's stagger onto
	 * another container's item. The Screen's own write path refuses such a document;
	 * this is the same refusal applied to one arriving from another installation.
	 */
	it('refuses a document whose Graphic Item ids collide across a Graphic Group', () => {
		const document = maximalBroadcastGraphicDocument({ asset });
		const group = document.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('expected a Graphic Group');
		group.children[0]!.id = 'headline';

		expect(rejectionCodes(document)).toEqual(['invalid-template-document']);
	});

	it('refuses a document declaring a Graphic Item kind this installation does not implement', () => {
		const document = maximalBroadcastGraphicDocument({ asset }) as BroadcastGraphicConfig & {
			items: { type: string }[];
		};
		document.items[0]!.type = 'particle-emitter';

		expect(rejectionCodes(document)).toEqual(['invalid-template-document']);
	});

	/**
	 * A rejection names the field rather than only the document, because an author
	 * correcting a design on the *sending* installation has to know where to look.
	 */
	it('names the field responsible for a refusal', () => {
		const document = maximalBroadcastGraphicDocument({ asset });
		document.name = '';

		const outcome = read(document);
		if (outcome.outcome !== 'rejected')
			throw new Error('Expected the document to be refused');
		expect(outcome.issues.some(issue => issue.subject === 'name')).toBe(true);
	});
});
