import type {
	TemplatePackageKind,
	TemplatePackagePayloads,
} from '../../shared/types/templatePackage';

/**
 * A Template Package payload registry that reads any document as installable.
 *
 * The Graphics Asset Library refuses to receive a package without a registry, so a
 * test exercising the *envelope* — entry names, integrity, limits, asset mapping,
 * installation bookkeeping — has to say what it wants the artifact check to do
 * rather than leave the dependency out and have the check silently disappear.
 *
 * Wiring this is that statement: the document is not the subject of the test, and a
 * fixture that is not a Broadcast Graphic is deliberate. A test whose subject *is*
 * the artifact wires the real registry instead.
 */
export function acceptEveryTemplateDocument(): TemplatePackagePayloads {
	return (kind: TemplatePackageKind) => ({
		packageKind: kind,
		readInstallableDocument: () => ({ outcome: 'read', capabilities: [] }),
	});
}
