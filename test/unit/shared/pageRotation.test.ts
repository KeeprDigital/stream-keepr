import { describe, expect, it } from 'vitest';
import { msUntilNextRotationFlip, projectRotationPage, rotationAnchorForPage } from '~~/shared/modules/page-rotation';

describe('page rotation projection', () => {
	it('projects the page as elapsed whole durations since the anchor, wrapping past the last page', () => {
		const anchor = 1_000_000;
		const pageDurationMs = 10_000;
		const totalPages = 3;

		// Worked example: anchor at t=1,000,000, 10s pages, 3 pages.
		// 1,000,000..1,009,999 → page 1; ..1,019,999 → page 2; ..1,029,999 → page 3; then wraps.
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: 1_000_000 })).toBe(1);
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: 1_009_999 })).toBe(1);
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: 1_010_000 })).toBe(2);
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: 1_029_999 })).toBe(3);
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: 1_030_000 })).toBe(1);
		// Resume-in-phase: an arbitrary much-later instant lands mid-cycle, not at page 1.
		// 8 full pages elapsed at +85s → 8 % 3 = 2 → page 3.
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: 1_085_000 })).toBe(3);
	});

	it('projects from epoch zero when no anchor is stored, so pre-anchor configs rotate deterministically', () => {
		// now = 25s after epoch, 10s pages, 3 pages → 2 full pages elapsed → page 3.
		expect(projectRotationPage({ pageDurationMs: 10_000, totalPages: 3, now: 25_000 })).toBe(3);
		// Two renderings with no anchor and the same instant agree by construction.
		expect(projectRotationPage({ pageDurationMs: 10_000, totalPages: 3, now: 25_000 }))
			.toBe(projectRotationPage({ rotationAnchor: 0, pageDurationMs: 10_000, totalPages: 3, now: 25_000 }));
	});

	it('holds the first page for degenerate inputs: one page, no pages, zero duration, or an anchor in the future', () => {
		expect(projectRotationPage({ rotationAnchor: 0, pageDurationMs: 10_000, totalPages: 1, now: 95_000 })).toBe(1);
		expect(projectRotationPage({ rotationAnchor: 0, pageDurationMs: 10_000, totalPages: 0, now: 95_000 })).toBe(1);
		expect(projectRotationPage({ rotationAnchor: 0, pageDurationMs: 0, totalPages: 3, now: 95_000 })).toBe(1);
		// Clock skew can put a freshly written anchor slightly ahead of a
		// rendering's estimate of now; that must read as "rotation just started".
		expect(projectRotationPage({ rotationAnchor: 100_000, pageDurationMs: 10_000, totalPages: 3, now: 95_000 })).toBe(1);
	});

	it('re-anchors a manual selection so the chosen page is current and holds for one full duration', () => {
		const pageDurationMs = 10_000;
		const totalPages = 4;
		const now = 500_000;

		const anchor = rotationAnchorForPage({ page: 3, pageDurationMs, now });

		// The chosen page shows immediately…
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now })).toBe(3);
		// …still shows just before one full duration has passed…
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: now + pageDurationMs - 1 })).toBe(3);
		// …and rotation continues in order afterwards.
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: now + pageDurationMs })).toBe(4);
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs, totalPages, now: now + 2 * pageDurationMs })).toBe(1);
	});

	it('mints integer anchors from a fractional clock estimate', () => {
		// getServerTime() = Date.now() + an RTT-averaged float offset, but the
		// config schema requires an integer — the anchor must round, not fail.
		const anchor = rotationAnchorForPage({ page: 2, pageDurationMs: 10_000, now: 500_000.4375 });
		expect(Number.isInteger(anchor)).toBe(true);
		expect(anchor).toBe(490_000);
	});

	it('re-anchoring to page 1 behaves as a rotation restart', () => {
		const now = 42_000;
		const anchor = rotationAnchorForPage({ page: 1, pageDurationMs: 10_000, now });
		expect(anchor).toBe(now);
		expect(projectRotationPage({ rotationAnchor: anchor, pageDurationMs: 10_000, totalPages: 3, now })).toBe(1);
	});

	it('reports the time to the next flip, and null when nothing rotates', () => {
		// 25s elapsed of 10s pages → 5s into the third page → 5s until the flip.
		expect(msUntilNextRotationFlip({ rotationAnchor: 0, pageDurationMs: 10_000, totalPages: 3, now: 25_000 })).toBe(5_000);
		// Exactly on a boundary → a whole duration remains.
		expect(msUntilNextRotationFlip({ rotationAnchor: 0, pageDurationMs: 10_000, totalPages: 3, now: 20_000 })).toBe(10_000);
		// Anchor in the future → the first flip lands one duration after the anchor.
		expect(msUntilNextRotationFlip({ rotationAnchor: 30_000, pageDurationMs: 10_000, totalPages: 3, now: 25_000 })).toBe(15_000);
		// Nothing rotates with a single page or a degenerate duration.
		expect(msUntilNextRotationFlip({ rotationAnchor: 0, pageDurationMs: 10_000, totalPages: 1, now: 25_000 })).toBeNull();
		expect(msUntilNextRotationFlip({ rotationAnchor: 0, pageDurationMs: 0, totalPages: 3, now: 25_000 })).toBeNull();
	});
});
