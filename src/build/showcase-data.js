/**
 * src/build/showcase-data.js — loads the DEMO showcase data.
 *
 * PLATFORM REDESIGN (design preview). src/data/showcase-demo.json holds the
 * fictional designers and projects the redesigned showcase pages are
 * reviewed with. This module checks its shape, resolves every palette
 * against palettes-data.json, and derives the two orders the design uses:
 *
 *   projects   newest first (the only project order; no other sort)
 *   designers  by their most recent project, newest first
 *
 * Disciplines are listed only when at least one project uses them, so no
 * filter chip ever leads to nothing.
 */

"use strict";

const fs = require("fs");

const KINDS = new Set(["brand", "poster", "pack", "type", "ui", "illustration", "editorial"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  throw new Error(`showcase-demo.json: ${message}`);
}

/**
 * ILLUSTRATIVE like and view counts for the design preview (revision 03),
 * so the cards' metadata row can be reviewed. They are made up, derived
 * from the slug so every build gives the same numbers, and every page that
 * shows them marks them as sample counts. Real projects must take likes
 * and views from the backend; nothing here is ever a real statistic.
 */
function sampleStats(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const likes = 24 + (h % 860);
  const views = likes * (9 + ((h >>> 10) % 17)) + ((h >>> 4) % 97);
  return { likes, views };
}

function load(file, palettes) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const colorsById = new Map(palettes.map((p) => [p.id, p.colors]));

  const disciplines = raw.disciplines || [];
  const disciplineBySlug = new Map(disciplines.map((d) => [d.slug, d]));

  const designers = (raw.designers || []).map((d, i) => {
    const at = `designers[${i}]`;
    if (!SLUG.test(d.handle || "")) fail(`${at}.handle must be a lowercase slug`);
    if (!d.name) fail(`${at}.name is required`);
    if (!colorsById.has(d.palette)) fail(`${at}.palette ${d.palette} is not a bpozz palette`);
    if (!DATE.test(d.joined || "")) fail(`${at}.joined must be YYYY-MM-DD`);
    return Object.assign({}, d, { colors: colorsById.get(d.palette), projects: [] });
  });
  const designerByHandle = new Map(designers.map((d) => [d.handle, d]));
  if (designerByHandle.size !== designers.length) fail("designer handles must be unique");

  const projects = (raw.projects || []).map((p, i) => {
    const at = `projects[${i}]`;
    if (!SLUG.test(p.slug || "")) fail(`${at}.slug must be a lowercase slug`);
    if (!designerByHandle.has(p.designer)) fail(`${at}.designer ${p.designer} is not a listed designer`);
    if (!disciplineBySlug.has(p.discipline)) fail(`${at}.discipline ${p.discipline} is not listed`);
    if (!KINDS.has(p.kind)) fail(`${at}.kind ${p.kind} has no art`);
    if (!colorsById.has(p.palette)) fail(`${at}.palette ${p.palette} is not a bpozz palette`);
    if (!DATE.test(p.date || "")) fail(`${at}.date must be YYYY-MM-DD`);
    if (!Array.isArray(p.body) || !p.body.length) fail(`${at}.body needs at least one paragraph`);
    return Object.assign({}, p, {
      colors: colorsById.get(p.palette),
      designerRecord: designerByHandle.get(p.designer),
      disciplineRecord: disciplineBySlug.get(p.discipline),
      sample: sampleStats(p.slug),
    });
  });
  if (new Set(projects.map((p) => p.slug)).size !== projects.length) fail("project slugs must be unique");

  // Newest first; ties keep file order.
  projects.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  projects.forEach((p) => p.designerRecord.projects.push(p));

  const orderedDesigners = designers
    .filter((d) => d.projects.length)
    .sort((a, b) => (a.projects[0].date < b.projects[0].date ? 1 : a.projects[0].date > b.projects[0].date ? -1 : 0));

  const used = new Set(projects.map((p) => p.discipline));
  const listedDisciplines = disciplines
    .filter((d) => used.has(d.slug))
    .map((d) => Object.assign({}, d, { count: projects.filter((p) => p.discipline === d.slug).length }));

  return {
    notice: raw.notice,
    disciplines: listedDisciplines,
    designers: orderedDesigners,
    projects,
  };
}

module.exports = { load, sampleStats };
