import { describe, expect, it } from 'vitest';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { supportedFeatureMatchLayoutVocabularyVersion } from '~~/shared/featureMatchLayoutVocabulary';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { featureMatchLayoutTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

// A four-Seat layout declares each new term it names, so an installation without one refuses the package by identity (ADR-0087).
describe('a four-Seat layout\'s Template Package requirements', () => {
	const layout = BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES.find(template => template.id === 'commander-table')!.config.layout;
	const identities = featureMatchLayoutTemplatePackageRequirements({ ...layout, frame: layout.frame }).capabilities.map(requirement => `${requirement.capability}:${requirement.identity}`);

	it.each([
		'host-vocabulary:feature-match/source-role/player3',
		'host-vocabulary:feature-match/source-role/player4',
		'host-vocabulary:feature-match/token/player4Name',
		'host-vocabulary:feature-match/token/player1Commander1Image',
		'host-vocabulary:feature-match/token/player3Commander2Image',
		'graphic-item-definition:commander-damage',
		'graphic-item-definition:seat-indicator',
	])('declares %s', (identity) => {
		expect(identities).toContain(identity);
	});

	it('names only terms this installation implements, at the format version it had', () => {
		const vocabulary = identities.filter(identity => identity.startsWith('host-vocabulary:feature-match/'))
			.map(identity => identity.slice('host-vocabulary:'.length));

		expect(vocabulary.map(supportedFeatureMatchLayoutVocabularyVersion)).toEqual(vocabulary.map(() => 1));
		expect(getGraphicItemDefinition('commander-damage').configurationVersion).toBe(1);
	});
});
