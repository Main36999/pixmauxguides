# Icons provenance and license audit

Internal record. Not published (`docs/` is not in `PUBLISH_DIRS`).

Audit date: 2026-09-26, base commit `820cecf`.

## Summary

| Group | Icons | Status |
| --- | --- | --- |
| Legacy icons, commit `9a915c3` | 43 | First-party. No upstream source recorded, and no non-trivial geometry matches a major open-source library. |
| Legacy icons, commit `9a915c3` | 4 | `PROVENANCE_UNCERTAIN`, see below. |
| First-party expansion (this change) | 48 | Original BPOZZ artwork, drawn for this repository. Each record carries `"source": "BPOZZ"`, `"creator": "BPOZZ"`, `"provenance": "Original BPOZZ artwork"` in `src/data/icons.json`. |

## PROVENANCE_UNCERTAIN

The following files are kept unchanged. They are not deleted, rewritten or replaced, and they carry no third-party notice:

- `public/icons/outline-essentials/svg/close.svg` and `png/close.png`
- `public/icons/outline-essentials/svg/plus.svg` and `png/plus.png`
- `public/icons/outline-essentials/svg/menu.svg` and `png/menu.png`
- `public/icons/outline-essentials/svg/chevron-down.svg` and `png/chevron-down.png`

**Why they are uncertain.** Each of the four files is made up only of straight strokes, such as `M5 12h14`, `m6 9 6 6 6-6` and `M18 6 6 18`. Every one of those strokes is element-for-element identical to geometry in Lucide (`lucide-static` 1.48.0). The comparison covered about 24,000 SVGs from Lucide, Heroicons, Tabler, Feather and Phosphor. Both commit `9a915c3` and the rest of the history are silent about how these four were drawn.

**What the evidence does not show.** Nothing establishes a third-party origin either. The strokes are the most basic way to draw these shapes on a 24px grid, so identical coordinates are expected from independent work. Similarity is not evidence of copying, and these icons are not Lucide icons by any record.

**Status.** They remain `PROVENANCE_UNCERTAIN` until the owner decides. The owner can accept them as first-party, or redraw them.

## Icon asset license

**Icon asset license is currently unspecified.**

- The repository has no LICENSE or NOTICE file that covers `public/icons/`.
- `terms.html`, under "Content ownership", covers "guide text, structure, and illustrations" and restricts redistributing guide content. It does not mention icons.
- The Icons pages offer SVG, PNG and ZIP downloads without stating what visitors may do with them.

The 3D renderer's comment (`scripts/icons/render-3d.js`) says Inigo Quilez's signed-distance-function snippets are "MIT-licensed". His article on 2D distance functions (iquilezles.org/articles/distfunctions2d) has no license statement. That claim is therefore unverified, and no new claim was added.

**Smallest explicit mechanism, for the owner to decide.** Choose one license for BPOZZ-created icons, then state it in two places:
1. a `LICENSE` text inside each pack ZIP;
2. one line on the Icons pages (or a short Terms clause).

The four `PROVENANCE_UNCERTAIN` icons should be resolved before a license is granted over them. No license was chosen, and the Terms were not changed.
