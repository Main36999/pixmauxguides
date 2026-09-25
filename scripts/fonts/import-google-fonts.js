#!/usr/bin/env node
/**
 * scripts/fonts/import-google-fonts.js — verifies candidate families against
 * a checkout of the official google/fonts repository and imports the ones
 * that pass into public/fonts/, src/data/fonts.json and
 * src/data/font-license-audit.json.
 *
 * NOT part of the build. It is the tool the font library was assembled with,
 * kept so the import is reproducible and reviewable. It needs:
 *
 *   - a google/fonts checkout at the commit named by --commit, containing
 *     every candidate's directory (a sparse, blob-less clone is enough);
 *   - the `wawoff2` package, installed WITHOUT saving it to package.json
 *     (`npm install --no-save wawoff2@2`) — the site itself has no
 *     dependencies and this keeps it that way;
 *   - network access, for the upstream-repository license cross-check.
 *
 *     node scripts/fonts/import-google-fonts.js \
 *       --gf <checkout> --commit <sha> --selection <file.json> \
 *       --editorial <file.json> --official-ofl <OFL.txt> [--date YYYY-MM-DD] \
 *       [--dry-run 1]      (verify and report only; writes nothing)
 *
 * --selection is [{ "dir": "ofl/lato", "category": "sans-serif" }, …] and
 * includes the families already in the library (they are re-verified, and
 * their files must still be byte-identical to upstream).
 * --editorial is { "<id>": { description, tags }, … } for families not yet in
 * fonts.json; existing records keep their editorial fields.
 *
 * A CANDIDATE IS REJECTED — never imported — if any of these fail:
 *
 *   1. METADATA.pb declares license OFL
 *   2. the directory ships OFL.txt, and its license body (from PREAMBLE on)
 *      is word-for-word the official OFL 1.1 text (whitespace-normalised)
 *   3. every font file METADATA.pb lists exists, parses, is static (no fvar),
 *      and its OS/2 weight and italic flags agree with METADATA.pb
 *   4. no font file forbids embedding (OS/2 fsType "restricted")
 *   5. each font's own license name record (ID 13), when present, names the
 *      OFL — a font that says anything else is a conflict
 *   6. the upstream project repository, when it has a license file, does
 *      not name a different license (GitHub, GitLab and SourceHut are
 *      searched; googlefontdirectory-hg is searched under ofl/<family>/)
 *   7. no font file duplicates the bytes of another family's file
 *
 * Re-running on an existing library changes nothing it has already recorded:
 * an existing family's audit record is kept verbatim (including verifiedAt)
 * when re-verification reproduces it, and is replaced — and reported — only
 * when something about the family actually changed. Rejections recorded by
 * earlier runs are kept unless this run re-evaluates the same directory.
 *
 * WOFF2 previews are generated only for families WITHOUT a Reserved Font
 * Name, then decompressed and compared (names, glyph count, code points)
 * against the original. RFN families are previewed from their original files.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sfnt = require("./sfnt.js");

const REPO = path.resolve(__dirname, "..", "..");
const FONT_DIR = path.join(REPO, "public", "fonts");
const FONTS_JSON = path.join(REPO, "src", "data", "fonts.json");
const AUDIT_JSON = path.join(REPO, "src", "data", "font-license-audit.json");

const BACKGROUNDS = [
  "#F4EFE4", "#E6F0EA", "#ECEAF7", "#F7E8E4", "#E4EEF7",
  "#F6F0D9", "#EFE7F2", "#E2F1F0", "#F3EBE2", "#EBF2E0",
];

/**
 * License file names tried in an upstream repository, in order. "Open Font
 * License.markdown" is The League of Moveable Type's name for its OFL.txt.
 */
const UPSTREAM_LICENSE_FILES = [
  "OFL.txt", "OFL.md", "OFL", "LICENSE", "LICENSE.txt", "LICENSE.md",
  "License.txt", "license.txt", "LICENCE", "LICENCE.txt", "OFL-1.1.txt",
  "Open Font License.markdown",
];

/**
 * The two values an audit record's `licenseEvidence` may take:
 *
 *   upstream_license_file_verified  the family's upstream project repository
 *                                   has a license file that is the OFL 1.1,
 *                                   in addition to the google/fonts evidence
 *   google_fonts_evidence_only      no upstream license file could be found;
 *                                   the license rests on the google/fonts
 *                                   repository alone (METADATA.pb, the
 *                                   official OFL.txt, the font files)
 */
const EVIDENCE = {
  upstream: "upstream_license_file_verified",
  googleFontsOnly: "google_fonts_evidence_only",
};

// ---------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ["gf", "commit", "selection", "editorial", "official-ofl"]) {
    if (!out[k]) throw new Error(`missing --${k}`);
  }
  out.date = out.date || new Date().toISOString().slice(0, 10);
  return out;
}

// ---------------------------------------------------------------------
// METADATA.pb (protobuf text format — only the fields used here)
// ---------------------------------------------------------------------

function parseMetadata(text) {
  const root = {};
  const stack = [root];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*#.*$/, "").trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^(\w+)\s*\{$/))) {
      const obj = {};
      const cur = stack[stack.length - 1];
      (cur[m[1]] = cur[m[1]] || []).push(obj);
      stack.push(obj);
    } else if (line === "}") {
      stack.pop();
    } else if ((m = line.match(/^(\w+)\s*:\s*(.*)$/))) {
      let v = m[2].trim();
      if (v.startsWith('"')) {
        try {
          v = JSON.parse(v.replace(/\\'/g, "'"));
        } catch (e) {
          v = v.replace(/^"|"$/g, "");
        }
      } else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      const cur = stack[stack.length - 1];
      (cur[m[1]] = cur[m[1]] || []).push(v);
    }
  }
  return root;
}

const first = (o, k) => (o && o[k] ? o[k][0] : undefined);

// ---------------------------------------------------------------------
// license text
// ---------------------------------------------------------------------

function licenseBody(text) {
  const at = text.indexOf("PREAMBLE");
  return at < 0 ? null : text.slice(at).replace(/\s+/g, " ").trim();
}

/** The copyright header of an OFL.txt: everything before the boilerplate. */
function licenseHeader(text) {
  const cut = text.search(/This Font Software is licensed under the SIL Open Font License/i);
  return (cut < 0 ? "" : text.slice(0, cut)).replace(/\s+/g, " ").trim();
}

const declaresRfn = (header) => /Reserved\s+Font\s+Names?/i.test(header);

const NAMES_OFL = /Open Font License|scripts\.sil\.org\/OFL|openfontlicense\.org|\bOFL\b/i;
const NAMES_OTHER = /Apache License|GNU (General|Lesser)|\bGPL\b|Creative Commons|Ubuntu Font Licen[cs]e|all rights reserved|personal use/i;

// ---------------------------------------------------------------------
// upstream cross-check
// ---------------------------------------------------------------------

/**
 * How to fetch a raw file from, and link to a file in, each supported host.
 * `refs` are tried in order; HEAD is the default branch where the host
 * resolves it.
 */
const HOSTS = [
  {
    host: "github",
    match: /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/#?]+?)(?:\.git)?\/?$/i,
    refs: ["HEAD"],
    raw: (repo, ref, p) => `https://raw.githubusercontent.com/${repo}/${ref}/${p}`,
    view: (repo, ref, p) => `https://github.com/${repo}/blob/${ref}/${p}`,
  },
  {
    host: "gitlab",
    match: /^https?:\/\/(?:www\.)?gitlab\.com\/([^#?]+?)(?:\.git)?\/?$/i,
    refs: ["HEAD", "main", "master"],
    raw: (repo, ref, p) => `https://gitlab.com/${repo}/-/raw/${ref}/${p}`,
    view: (repo, ref, p) => `https://gitlab.com/${repo}/-/blob/${ref}/${p}`,
  },
  {
    host: "sourcehut",
    match: /^https?:\/\/git\.sr\.ht\/(~[^/]+\/[^/#?]+?)\/?$/i,
    refs: ["HEAD", "master", "main"],
    raw: (repo, ref, p) => `https://git.sr.ht/${repo}/blob/${ref}/${p}`,
    view: (repo, ref, p) => `https://git.sr.ht/${repo}/tree/${ref}/item/${p}`,
  },
];

/**
 * Where a family's license lives inside its upstream repository. Most
 * projects keep it at the root; googlefontdirectory-hg (Google's archive of
 * the original Font Directory) keeps one per family under ofl/<family>/.
 */
function licenseDirFor(repo, googleFontsPath) {
  if (/^googlefonts\/googlefontdirectory-hg$/i.test(repo)) {
    return `ofl/${path.basename(googleFontsPath)}/`;
  }
  return "";
}

/**
 * Looks for the family's license file in its upstream repository and says
 * exactly what was found. A network error aborts the import rather than
 * being recorded as "not found" — evidence must not depend on a flaky fetch.
 */
async function upstreamLicense(repositoryUrl, googleFontsPath) {
  const none = (status, extra) =>
    Object.assign({ status, licenseEvidence: EVIDENCE.googleFontsOnly }, extra);
  if (!repositoryUrl) return none("no-repository-in-metadata");
  const host = HOSTS.find((h) => h.match.test(repositoryUrl));
  if (!host) return none("unsupported-host", { repository: repositoryUrl });
  const repo = repositoryUrl.match(host.match)[1];
  const dir = licenseDirFor(repo, googleFontsPath);

  for (const ref of host.refs) {
    for (const name of UPSTREAM_LICENSE_FILES) {
      const p = (dir + name).split("/").map(encodeURIComponent).join("/");
      let res;
      try {
        res = await fetch(host.raw(repo, ref, p), { redirect: "follow" });
      } catch (e) {
        throw new Error(`upstream fetch failed for ${repositoryUrl}: ${e.message || e}`);
      }
      if (res.status !== 200) continue;
      const text = await res.text();
      if (/^\s*<(!doctype|html)/i.test(text)) continue; // a host's HTML page, not the file
      const isOfl = /SIL OPEN FONT LICENSE/i.test(text) && /Version 1\.1/i.test(text);
      return {
        status: isOfl ? "ofl-1.1" : "different-license-text",
        licenseEvidence: isOfl ? EVIDENCE.upstream : EVIDENCE.googleFontsOnly,
        host: host.host,
        repository: repositoryUrl,
        licenseFilePath: dir + name,
        licenseFileUrl: host.view(repo, ref, p),
        excerpt: isOfl ? undefined : text.slice(0, 200).replace(/\s+/g, " "),
      };
    }
  }
  return none("no-license-file-found", {
    host: host.host,
    repository: repositoryUrl,
    searched: `${dir || "(root)"}: ${UPSTREAM_LICENSE_FILES.join(", ")}`,
  });
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const versionOf = (v) => {
  const m = String(v || "").match(/(\d+\.\d+)/);
  return m ? m[1] : null;
};

function summary(info) {
  return JSON.stringify({
    family: info.names.family,
    subfamily: info.names.subfamily,
    version: info.names.version,
    copyright: info.names.copyright,
    glyphs: info.numGlyphs,
    codepoints: [...info.codepoints].sort((a, b) => a - b).join(","),
  });
}

// ---------------------------------------------------------------------
// verify one candidate
// ---------------------------------------------------------------------

function verifyCandidate(opts, cand, officialBody) {
  const dir = path.join(opts.gf, cand.dir);
  const reasons = [];
  const metaPath = path.join(dir, "METADATA.pb");
  if (!fs.existsSync(metaPath)) return { reasons: ["METADATA.pb missing"] };
  const meta = parseMetadata(fs.readFileSync(metaPath, "utf8"));
  const name = first(meta, "name");
  const out = { name, meta, reasons, files: [] };

  // 1. declared license
  if (first(meta, "license") !== "OFL") reasons.push(`METADATA.pb license is ${first(meta, "license")}, not OFL`);

  // 2. license file
  const oflPath = path.join(dir, "OFL.txt");
  if (!fs.existsSync(oflPath)) {
    reasons.push("no OFL.txt (or any license file) in the google/fonts directory");
  } else {
    out.licenseBuf = fs.readFileSync(oflPath);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(out.licenseBuf);
    } catch (e) {
      text = out.licenseBuf.toString("latin1");
    }
    if (licenseBody(text) !== officialBody) {
      reasons.push("OFL.txt license body is not word-for-word the official OFL 1.1 text");
    }
    out.licenseText = text;
    out.header = licenseHeader(text);
    if (!out.header) reasons.push("OFL.txt has no copyright header");
    out.rfn = declaresRfn(out.header);
  }

  // 3–5. font files
  const fonts = meta.fonts || [];
  if (!fonts.length) reasons.push("METADATA.pb lists no fonts");
  for (const f of fonts) {
    const filename = first(f, "filename");
    const weight = first(f, "weight");
    const style = first(f, "style");
    const p = path.join(dir, filename);
    if (!/^[\w-]+\.(ttf|otf)$/.test(filename)) {
      reasons.push(`${filename}: not a static .ttf/.otf file name`);
      continue;
    }
    if (!fs.existsSync(p)) {
      reasons.push(`${filename}: listed in METADATA.pb but missing`);
      continue;
    }
    const buf = fs.readFileSync(p);
    let info;
    try {
      info = sfnt.readSfnt(buf);
    } catch (e) {
      reasons.push(`${filename}: unreadable (${e.message})`);
      continue;
    }
    if (info.variable) reasons.push(`${filename}: variable font (fvar)`);
    // 250/275 for Thin/ExtraLight is the common Windows GDI workaround (a
    // usWeightClass below 250 can be faux-bolded by GDI); it is the same weight.
    const gdi = { 250: 100, 275: 200 };
    if (info.weightClass !== weight && gdi[info.weightClass] !== weight) {
      reasons.push(`${filename}: OS/2 weight ${info.weightClass} != METADATA ${weight}`);
    }
    if (sfnt.isItalic(info) !== (style === "italic")) {
      reasons.push(`${filename}: italic flags disagree with METADATA style ${style}`);
    }
    const embedding = sfnt.embedding(info.fsType);
    if (embedding === "restricted" || embedding === "unknown") {
      reasons.push(`${filename}: OS/2 fsType ${info.fsType} (${embedding}) forbids embedding`);
    }
    const ld = info.names.licenseDescription;
    if (ld && (!NAMES_OFL.test(ld) || NAMES_OTHER.test(ld))) {
      reasons.push(`${filename}: license name record conflicts: "${ld.slice(0, 120)}"`);
    }
    out.files.push({
      filename, weight, style, buf, info, embedding,
      metadataCopyright: first(f, "copyright"),
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

async function main() {
  const opts = args();
  const wawoff2 = require("wawoff2");
  const officialBody = licenseBody(fs.readFileSync(opts["official-ofl"], "utf8"));
  const selection = JSON.parse(fs.readFileSync(opts.selection, "utf8"));
  const editorial = JSON.parse(fs.readFileSync(opts.editorial, "utf8"));
  const existing = JSON.parse(fs.readFileSync(FONTS_JSON, "utf8"));
  const byId = new Map(existing.map((f) => [f.id, f]));
  const previousAudit = fs.existsSync(AUDIT_JSON)
    ? JSON.parse(fs.readFileSync(AUDIT_JSON, "utf8"))
    : { families: [], rejected: [] };
  const previousRecord = new Map(previousAudit.families.map((r) => [r.id, r]));
  const repoUrl = (dir) => `https://github.com/google/fonts/tree/${opts.commit}/${dir}`;

  const accepted = [];
  const rejected = [];
  const hashOwner = new Map();

  for (const cand of selection) {
    const v = verifyCandidate(opts, cand, officialBody);
    const id = v.name ? slug(v.name) : path.basename(cand.dir);
    const known = byId.get(id);
    if (known && known.repositoryUrl !== repoUrl(cand.dir)) {
      v.reasons.push(`id ${id} already used by a record from ${known.repositoryUrl}`);
    }
    // 7. duplicate bytes across families
    for (const f of v.files) {
      f.sha256 = sha256(f.buf);
      const owner = hashOwner.get(f.sha256);
      if (owner && owner !== id) v.reasons.push(`${f.filename}: same bytes as a file in ${owner}`);
    }
    // 6. upstream
    const upstreamUrl = first((v.meta && v.meta.source) ? v.meta.source[0] : null, "repository_url");
    v.upstream = await upstreamLicense(upstreamUrl, cand.dir);
    if (v.upstream.status === "different-license-text") {
      v.reasons.push(`upstream repository license is not OFL 1.1: "${v.upstream.excerpt}"`);
    }

    if (v.reasons.length) {
      rejected.push({
        name: v.name || cand.dir,
        googleFontsPath: cand.dir,
        sourceChecked: repoUrl(cand.dir),
        upstream: v.upstream,
        reasons: v.reasons,
      });
      console.log(`✗ ${v.name || cand.dir}: ${v.reasons.join("; ")}`);
      continue;
    }
    v.files.forEach((f) => hashOwner.set(f.sha256, id));
    accepted.push({ id, cand, v, upstreamUrl });
  }

  if (opts["dry-run"]) {
    console.log(`\ndry run: ${accepted.length} would be imported, ${rejected.length} rejected`);
    accepted.forEach((a) =>
      console.log(`  ${a.id}  rfn=${a.v.rfn}  evidence=${a.v.upstream.licenseEvidence}  files=${a.v.files.length}`),
    );
    return;
  }

  // ---- write files, audit records and data records ----
  const audit = [];
  const records = [];
  const newIds = accepted.filter((a) => !byId.has(a.id)).map((a) => a.id).sort();

  for (const { id, cand, v, upstreamUrl } of accepted) {
    const target = path.join(FONT_DIR, id);
    fs.mkdirSync(target, { recursive: true });
    const write = (name, buf) => {
      const p = path.join(target, name);
      if (fs.existsSync(p) && !fs.readFileSync(p).equals(buf)) {
        throw new Error(`${id}/${name} exists with different bytes — refusing to overwrite`);
      }
      fs.writeFileSync(p, buf);
    };
    write("OFL.txt", v.licenseBuf);

    const variants = [];
    const files = [];
    for (const f of v.files) {
      write(f.filename, f.buf);
      let web = f.filename;
      if (!v.rfn) {
        web = f.filename.replace(/\.(ttf|otf)$/, ".woff2");
        const woff = Buffer.from(await wawoff2.compress(f.buf));
        sfnt.checkWoff2(woff);
        const back = sfnt.readSfnt(Buffer.from(await wawoff2.decompress(woff)));
        if (summary(back) !== summary(f.info)) {
          throw new Error(`${id}/${web}: WOFF2 round trip changed the font`);
        }
        write(web, woff);
        files.push({ file: web, sha256: sha256(woff), role: "web preview (WOFF2 of " + f.filename + ")" });
      }
      files.push({
        file: f.filename,
        sha256: f.sha256,
        role: "original",
        upstreamPath: `${cand.dir}/${f.filename}`,
        fontVersion: f.info.names.version || null,
        embedding: f.embedding,
        fsType: f.info.fsType,
        glyphs: f.info.numGlyphs,
        codepoints: f.info.codepoints.size,
        licenseNameRecord: f.info.names.licenseDescription || null,
      });
      variants.push({ weight: f.weight, style: f.style, file: f.filename, web });
    }
    files.push({ file: "OFL.txt", sha256: sha256(v.licenseBuf), role: "license", upstreamPath: `${cand.dir}/OFL.txt` });

    const regular =
      v.files.find((f) => f.weight === 400 && f.style === "normal") || v.files[0];
    const version = versionOf(regular.info.names.version);
    const subsets = (v.meta.subsets || []).filter((s) => s !== "menu");

    const record = {
      id,
      family: v.name,
      licenseId: "OFL-1.1",
      license: "SIL Open Font License 1.1",
      licenseUrl: "https://openfontlicense.org/open-font-license-official-text/",
      licenseFile: "OFL.txt",
      copyright: v.header,
      reservedFontName: v.rfn,
      designer: first(v.meta, "designer"),
      manufacturerNameRecord: regular.info.names.manufacturer || null,
      version, // null when the font's version string is not numeric — never guessed
      googleFontsPath: cand.dir,
      repositoryUrl: repoUrl(cand.dir),
      sourceUrl: `https://fonts.google.com/specimen/${v.name.replace(/ /g, "+")}`,
      // What the license rests on. The google/fonts evidence below applies to
      // every family; licenseEvidence says whether the upstream project's
      // own license file was ALSO found and verified.
      licenseEvidence: v.upstream.licenseEvidence,
      googleFontsEvidence: {
        metadataLicense: `${cand.dir}/METADATA.pb declares license "OFL"`,
        licenseFile: `${cand.dir}/OFL.txt is the official OFL 1.1 text`,
        fontLicenseRecords: v.files.some((f) => f.info.names.licenseDescription)
          ? "font files' license name records (ID 13) name the OFL"
          : "font files carry no license name record (ID 13)",
      },
      upstream: v.upstream,
      checks: {
        metadataLicense: "OFL",
        licenseTextMatchesOfficial: true,
        fontsStatic: true,
        weightsAndStylesMatchMetadata: true,
        embeddingPermitted: true,
        licenseNameRecordsConsistent: true,
        uniqueFileHashes: true,
      },
      rights: {
        redistributionAllowed: true,
        webEmbeddingAllowed: true,
        modificationAllowed: true,
        commercialUseAllowed: true,
        sellingFontsAloneAllowed: false,
        licenseMustAccompanyCopies: true,
        modifiedVersionsMustRename: v.rfn,
      },
      files,
      verificationStatus: "verified",
      verifiedAt: opts.date,
    };
    // An existing family keeps its record verbatim when re-verification
    // reproduces it; a real change replaces it and is reported.
    const prev = previousRecord.get(id);
    const same =
      prev && JSON.stringify(Object.assign({}, record, { verifiedAt: prev.verifiedAt })) === JSON.stringify(prev);
    if (prev && !same) console.log(`! ${id}: audit record changed on re-verification — replaced`);
    audit.push(same ? prev : record);

    const base = byId.get(id);
    const common = {
      version: version || undefined,
      subsets,
      upstreamUrl: upstreamUrl || undefined,
    };
    if (base) {
      records.push(Object.assign({}, base, common));
      continue;
    }
    const ed = editorial[id];
    if (!ed || !ed.description || !Array.isArray(ed.tags)) {
      throw new Error(`no editorial description/tags for new family ${id}`);
    }
    records.push(Object.assign(
      {
        id,
        name: v.name,
        family: v.name,
        category: cand.category,
        designer: first(v.meta, "designer"),
        description: ed.description,
        tags: ed.tags,
        background: BACKGROUNDS[newIds.indexOf(id) % BACKGROUNDS.length],
        featured: 0, // assigned below
        dateAdded: first(v.meta, "date_added"),
        license: "SIL Open Font License 1.1",
        licenseUrl: "https://openfontlicense.org/open-font-license-official-text/",
        licenseFile: "OFL.txt",
        copyright: v.header,
        reservedFontName: v.rfn,
        source: "Google Fonts",
        sourceUrl: `https://fonts.google.com/specimen/${v.name.replace(/ /g, "+")}`,
        repositoryUrl: repoUrl(cand.dir),
      },
      common,
      { variants },
    ));
  }

  // Featured order for new families: continue after the existing maximum,
  // round-robin across categories so the "Featured" sort stays mixed.
  let next = Math.max(0, ...existing.map((f) => f.featured)) + 1;
  const queues = {};
  records
    .filter((r) => !byId.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .forEach((r) => (queues[r.category] = queues[r.category] || []).push(r));
  const cats = Object.keys(queues).sort();
  while (cats.some((c) => queues[c].length)) {
    for (const c of cats) if (queues[c].length) queues[c].shift().featured = next++;
  }

  // Rejections from earlier runs stay on record unless re-evaluated here.
  const evaluated = new Set(selection.map((c) => c.dir));
  const carried = (previousAudit.rejected || []).filter((r) => !evaluated.has(r.googleFontsPath));
  rejected.unshift(...carried);

  records.sort((a, b) => a.id.localeCompare(b.id, "en"));
  audit.sort((a, b) => a.id.localeCompare(b.id, "en"));

  fs.writeFileSync(FONTS_JSON, JSON.stringify(records, null, 2) + "\n");
  fs.writeFileSync(
    AUDIT_JSON,
    JSON.stringify(
      {
        description:
          "License audit for every family in src/data/fonts.json. One family = one font: " +
          "all weights and styles of a family count once. Generated by " +
          "scripts/fonts/import-google-fonts.js; checked by scripts/fonts/check-fonts.js.",
        source: { repository: "https://github.com/google/fonts", commit: opts.commit },
        officialLicenseText: "https://openfontlicense.org/documents/OFL.txt",
        families: audit,
        rejected,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\n${audit.length} families verified, ${rejected.length} rejected`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
