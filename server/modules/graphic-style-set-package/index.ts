/**
 * The Graphic Style Set Package (`.skstyle`) workflow: freezing one published Graphic
 * Style Set into a portable archive, and installing one that arrives.
 *
 * {@link ~~/shared/types/graphicStyleSetPackage} states what the artifact is and why it
 * is a sibling of the Template Package rather than a third kind of one. This module is
 * where the two halves meet the archive format and this installation's own library,
 * and it is deliberately the only place either half exists: whatever an export
 * declares is exactly what a receiver holds it to.
 */

export * from './export';
export * from './install';
export * from './issues';
export * from './preflight';
