# ADR-0011: Social Profile rotation projects into ordinary Graphic Items

- **Status**: Accepted
- **Date**: 2026-08-18
- **Issue**: [#416](https://github.com/KeeprDigital/stream-keepr/issues/416)
- **Builds on**: ADR-0009 (clock-projected automatic progression)

A rotating Talent identity is represented by a named Social Profile Projection, not by an opaque all-in-one Graphic Item or a collection-valued Graphic Input. The projection references a Talent Graphic Source Selection, atomically supplies read-only network and profile values, and transitions one explicitly associated Presentation Group whose ordinary Text, Social Network Icon, and decorative children retain the compositor's existing independent layout, styling, animation, and Style Set capabilities.

Automatic rotation is a pure projection of authoritative Broadcast Graphics Live Session state, the accepted populated profile set, and synchronized server time. Operator actions write the projection's selection, automatic mode, and rotation anchor, while Screen Outputs never write as rotation advances; a rendering without trustworthy synchronized time holds its last accepted or anchored profile statically rather than blanking or writing. Accepted profile-set changes preserve and re-anchor the current network when it still exists, so adding a profile cannot make program jump merely because the catalog indexes changed. Feature Match Overlay is outside this decision's scope.

## Considered Options

- **Opaque Social Profile Graphic Item**: smaller to implement, but it would duplicate a weaker subset of Text Item, Graphic Group, and styling controls inside a bespoke widget.
- **Collection-valued Graphic Input**: would make the scalar binding catalog responsible for collection and clock behaviour it deliberately excludes, while still not providing independently styled icon and text consumers.
- **Timer-driven accepted-value updates**: would write on every profile change, make simultaneous outputs compete or require a writer election, and discard the output-purity and synchronized-clock reasoning established by ADR-0009.
