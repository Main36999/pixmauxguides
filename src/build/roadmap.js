/**
 * src/build/roadmap.js — the Learning Roadmap's order, stated once.
 *
 * The roadmap is a curated, opinionated reading order through the guides,
 * grouped into stages. It has two readers, and they must read the guides in
 * exactly one order:
 *
 *   src/build/home.js      roadmap.html's stage-by-stage list, and the guide
 *                          and stage counts on the homepage's Learning
 *                          Roadmap card
 *   src/build/content.js   each guide page's own place on the roadmap — its
 *                          stage, its position and its neighbours — which
 *                          src/build/guide-template.js renders
 *
 * ROADMAP_STAGES and groupRoadmap() lived in src/build/home.js until the guide
 * pages needed them. They are moved here unchanged, and home.js re-exports
 * them under the same names. They could not stay there: home.js requires
 * content.js, so content.js cannot require home.js back.
 *
 * WHERE THE ORDER COMES FROM
 *
 * Each guide's `roadmapStage` / `roadmapStep` fields in guides.json, and
 * nothing else. `roadmapStep` is a sort key, not a number to show anyone: a
 * guide placed between two others takes a fraction (1.5, 8.25), so the
 * position a reader sees is always the guide's index in the sorted order. A
 * guide with no `roadmapStage` is simply left off the roadmap — that's the
 * mechanism for keeping a brand-new guide off the suggested path until you've
 * decided where it belongs.
 *
 * PURE. No fs, no ctx, no config require. Callers pass guides.json's records.
 */

"use strict";

const ROADMAP_STAGES = [
  {
    id: 1,
    title: "Foundations",
    blurb:
      "Start here. The three principles every later guide assumes you already know: how space, contrast, and line length carry meaning before color or type styling enters the picture.",
  },
  {
    id: 2,
    title: "Typography & Color Systems",
    blurb:
      "Turn one-off choices into systems — a type scale that resizes itself, a color palette built from tokens instead of swatches, and a dark theme that's re-derived rather than inverted.",
  },
  {
    id: 3,
    title: "Layout, Structure & Accessibility",
    blurb:
      "Make an interface hold together everywhere it's used: Figma's constraint model, a responsive layout that's a contract rather than a breakpoint list, and the accessibility tree underneath it all.",
  },
  {
    id: 4,
    title: "Systems & Motion",
    blurb:
      "The advanced layer teams reach for once the basics are solid: Figma's own data layer for theming, naming conventions that survive a rebrand, and motion timing with real physics behind it.",
  },
];

/**
 * The roadmap's grouping/ordering, shared by buildRoadmap() (roadmap.html)
 * and the homepage's Learning Roadmap card (its guide and stage counts), so
 * both read guides in exactly one order. Guides with a numeric `roadmapStage`
 * are sorted by `roadmapStep`, grouped by stage, and the stages are kept in
 * ROADMAP_STAGES order.
 */
function groupRoadmap(guides) {
  const roadmapGuides = guides
    .filter((g) => typeof g.roadmapStage === "number")
    .slice()
    .sort((a, b) => (a.roadmapStep || 0) - (b.roadmapStep || 0));

  const byStage = new Map();
  roadmapGuides.forEach((g) => {
    if (!byStage.has(g.roadmapStage)) byStage.set(g.roadmapStage, []);
    byStage.get(g.roadmapStage).push(g);
  });

  const stagesUsed = ROADMAP_STAGES.filter((s) => byStage.has(s.id));
  return { roadmapGuides, byStage, stagesUsed };
}

/**
 * Every roadmap guide's place on the roadmap, keyed by guide id.
 *
 * The sequence is the one roadmap.html displays: stage by stage in
 * ROADMAP_STAGES order, and within a stage in groupRoadmap()'s order. It is
 * read off groupRoadmap() rather than re-sorted here, so a guide page's
 * previous and next links can never disagree with the page they point back
 * to.
 *
 *   stageNumber  1-based, among the stages the roadmap shows
 *   stageCount   how many stages the roadmap shows
 *   stageTitle   the stage's ROADMAP_STAGES title
 *   position     1-based, across the whole roadmap — never `roadmapStep`
 *   total        how many guides the roadmap shows
 *   prev, next   { id, title } of the neighbouring guide, or null at an end
 *
 * A guide that is not on the roadmap has no entry.
 */
function roadmapPositions(guides) {
  const { byStage, stagesUsed } = groupRoadmap(guides);

  const sequence = [];
  stagesUsed.forEach((stage, i) => {
    byStage.get(stage.id).forEach((guide) => {
      sequence.push({ guide, stage, stageNumber: i + 1 });
    });
  });

  const neighbour = (entry) =>
    entry ? { id: entry.guide.id, title: entry.guide.title } : null;

  const positions = new Map();
  sequence.forEach((entry, i) => {
    positions.set(entry.guide.id, {
      stageNumber: entry.stageNumber,
      stageCount: stagesUsed.length,
      stageTitle: entry.stage.title,
      position: i + 1,
      total: sequence.length,
      prev: neighbour(sequence[i - 1]),
      next: neighbour(sequence[i + 1]),
    });
  });
  return positions;
}

module.exports = {
  ROADMAP_STAGES,
  groupRoadmap,
  roadmapPositions,
};
