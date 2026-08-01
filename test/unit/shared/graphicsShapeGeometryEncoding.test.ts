import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Shape Geometry is one `CONTEXT.md` glossary term, so the codebase declares it
 * exactly once.
 *
 * Asserted structurally rather than by name, because a fork is exactly the thing a
 * name does not catch: `MediaClipShapeGeometry` was a second encoding of the same
 * concept wearing a different identifier — a tagged-union corner and an unsigned
 * optional edge inset — and nothing failed to compile while both existed. What
 * identifies a Shape Geometry declaration is its shape: the four corner keys plus
 * an edge slant. Anything declaring that combination is claiming to be Shape
 * Geometry, whatever it is called.
 *
 * `app/` and `server/` are scanned as well as `shared/`. The fork this replaced had
 * its renderer in `app/`, and a host-specific encoding is likeliest to appear beside
 * the host that wants it rather than in the shared vocabulary it is diverging from.
 *
 * What it cannot see, so that nobody reads more into a pass than is there: a slant
 * spelled without the word "slant", a declaration nested inside a namespace or
 * function, an intersection or mapped type, and a runtime schema rather than a type.
 */

const SCANNED_ROOTS = ['shared', 'app', 'server'].map(root => resolve(process.cwd(), root));
const CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory())
			return sourceFiles(path);
		return path.endsWith('.ts') ? [path] : [];
	});
}

function memberNames(members: readonly ts.TypeElement[]): string[] {
	return members.flatMap(member =>
		ts.isPropertySignature(member) && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
			? [member.name.text]
			: [],
	);
}

/** A declaration is a Shape Geometry encoding when it names all four corners and an edge slant. */
function isShapeGeometryEncoding(names: string[]): boolean {
	return CORNER_KEYS.every(key => names.includes(key))
		&& names.some(name => /slant/i.test(name));
}

function shapeGeometryDeclarations(): string[] {
	const found: string[] = [];

	for (const filename of SCANNED_ROOTS.flatMap(sourceFiles)) {
		const sourceFile = ts.createSourceFile(
			filename,
			readFileSync(filename, 'utf8'),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);

		sourceFile.forEachChild((node) => {
			if (ts.isInterfaceDeclaration(node)) {
				if (isShapeGeometryEncoding(memberNames(node.members)))
					found.push(`${relative(process.cwd(), filename)}:${node.name.text}`);
				return;
			}
			if (
				ts.isTypeAliasDeclaration(node)
				&& ts.isTypeLiteralNode(node.type)
				&& isShapeGeometryEncoding(memberNames(node.type.members))
			) {
				found.push(`${relative(process.cwd(), filename)}:${node.name.text}`);
			}
		});
	}

	return found.sort();
}

describe('shape Geometry encoding', () => {
	it('is declared exactly once across the codebase', () => {
		expect(shapeGeometryDeclarations()).toEqual(['shared/types/graphics.ts:ShapeGeometry']);
	});
});
