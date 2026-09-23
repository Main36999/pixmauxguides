#!/usr/bin/env node
/**
 * scripts/fonts/check-fonts.js — the font library's license and integrity
 * gate. Runs offline, with no dependencies, against what is committed:
 *
 *     npm run check:fonts
 *
 * src/build/content.js already refuses to BUILD a record whose files or
 * license file are missing. This goes further and checks the evidence:
 *
 *   LICENSE    every family has a "verified" audit record in
 *              src/data/font-license-audit.json whose license is on the
 *              allow-list; its OFL.txt body is word-for-word the official
 *              OFL 1.1 text (scripts/fonts/OFL-1.1.txt); its copyright
 *              header and Reserved Font Name flag match the data; it links
 *              an authoritative source pinned to the audited commit; it
 *              states its licenseEvidence, consistent with the upstream
 *              check (upstream_license_file_verified only with a verified
 *              upstream OFL 1.1 file on record)
 *   FILES      every file under public/fonts/<id>/ is listed in the audit
 *              with the SHA-256 it was imported with, and nothing else is
 *              there; no two families share a font file
 *   FONTS      every TTF/OTF parses, is static, names the family, matches
 *              its variant's weight and style, permits embedding, and does
 *              not carry a license name record that contradicts the OFL;
 *              every WOFF2 is structurally valid and fully decompresses
 *   DATA       fonts.json and the audit agree 1:1; ids and family names are
 *              unique; the count matches site.config.js
 *
 * Counting rule: ONE FAMILY = ONE FONT. All weights and styles of a family
 * (Regular, Bold, Italic, …) count once.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sfnt = require("./sfnt.js");

const REPO = path.resolve(__dirname, "..", "..");
const config = require(path.join(REPO, "site.config.js"));

const FONT_DIR = config.paths.content.fontFiles;
const FONTS_JSON = config.paths.content.fonts;
const AUDIT_JSON = path.join(path.dirname(FONTS_JSON), "font-license-audit.json");
const OFFICIAL_OFL = path.join(__dirname, "OFL-1.1.txt");

/** Licenses a family may ship under, keyed by the audit's licenseId. */
const ALLOWED_LICENSES = { "OFL-1.1": "SIL Open Font License 1.1" };

/**
 * What a family's license rests on (see scripts/fonts/import-google-fonts.js).
 * google_fonts_evidence_only is allowed only when no upstream license file
 * was found — never when one was found and said something else.
 */
const EVIDENCE = {
  upstream: "upstream_license_file_verified",
  googleFontsOnly: "google_fonts_evidence_only",
};
const EVIDENCE_ONLY_STATUSES = ["no-license-file-found", "no-repository-in-metadata", "unsupported-host"];

const GDI_WEIGHT = { 250: 100, 275: 200 };
const NAMES_OFL = /Open Font License|scripts\.sil\.org\/OFL|openfontlicense\.org|\bOFL\b/i;
const NAMES_OTHER = /Apache License|GNU (General|Lesser)|\bGPL\b|Creative Commons|all rights reserved|personal use|non-?commercial/i;

const errors = [];
const fail = (msg) => errors.push(msg);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function decode(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    return buf.toString("latin1");
  }
}
const licenseBody = (t) => {
  const at = t.indexOf("PREAMBLE");
  return at < 0 ? null : t.slice(at).replace(/\s+/g, " ").trim();
};
const licenseHeader = (t) => {
  const cut = t.search(/This Font Software is licensed under the SIL Open Font License/i);
  return (cut < 0 ? "" : t.slice(0, cut)).replace(/\s+/g, " ").trim();
};

function main() {
  const fonts = JSON.parse(fs.readFileSync(FONTS_JSON, "utf8"));
  const audit = JSON.parse(fs.readFileSync(AUDIT_JSON, "utf8"));
  const officialBody = licenseBody(fs.readFileSync(OFFICIAL_OFL, "utf8"));
  const commit = audit.source && audit.source.commit;
  if (!/^[0-9a-f]{40}$/.test(commit || "")) fail("audit.source.commit must be a full commit SHA");

  // ---- DATA: 1:1, unique, counted ----
  if (fonts.length !== config.fonts.count) {
    fail(`fonts.json has ${fonts.length} families; site.config.js fonts.count is ${config.fonts.count}`);
  }
  const records = new Map();
  for (const r of audit.families) {
    if (records.has(r.id)) fail(`audit: duplicate record ${r.id}`);
    records.set(r.id, r);
  }
  const ids = new Set(fonts.map((f) => f.id));
  for (const id of records.keys()) if (!ids.has(id)) fail(`audit: record ${id} has no fonts.json entry`);
  const names = new Map();
  for (const f of fonts) {
    const key = f.family.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (names.has(key)) fail(`duplicate family name: ${f.family} / ${names.get(key)}`);
    names.set(key, f.family);
  }
  const rejectedNames = new Set((audit.rejected || []).map((r) => r.name));
  for (const r of audit.rejected || []) {
    if (!Array.isArray(r.reasons) || !r.reasons.length) fail(`rejected ${r.name}: no reason recorded`);
  }

  // ---- per family ----
  const hashOwner = new Map();
  const stats = { files: 0, woff2: 0, originals: 0, variable: 0, rfn: 0, licenses: {}, evidence: {} };

  for (const font of fonts) {
    const at = font.id;
    const rec = records.get(font.id);
    if (!rec) {
      fail(`${at}: no audit record`);
      continue;
    }
    if (rejectedNames.has(font.name)) fail(`${at}: listed as rejected in the audit`);

    // LICENSE
    if (rec.verificationStatus !== "verified") fail(`${at}: verificationStatus is ${rec.verificationStatus}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.verifiedAt || "")) fail(`${at}: verifiedAt missing`);
    if (ALLOWED_LICENSES[rec.licenseId] !== font.license || rec.license !== font.license) {
      fail(`${at}: license ${rec.licenseId}/${font.license} is not on the allow-list or disagrees`);
    }
    stats.licenses[rec.licenseId] = (stats.licenses[rec.licenseId] || 0) + 1;
    if (rec.repositoryUrl !== font.repositoryUrl ||
        !font.repositoryUrl.startsWith(`https://github.com/google/fonts/tree/${commit}/${rec.googleFontsPath}`)) {
      fail(`${at}: repositoryUrl is not pinned to the audited google/fonts commit and path`);
    }
    if (rec.sourceUrl !== font.sourceUrl) fail(`${at}: sourceUrl disagrees with the audit`);
    // EVIDENCE: what the license rests on must be stated, and must agree
    // with what the upstream check actually found.
    const up = rec.upstream || {};
    if (up.status === "different-license-text") {
      fail(`${at}: upstream repository names a different license`);
    }
    if (rec.licenseEvidence === EVIDENCE.upstream) {
      if (up.status !== "ofl-1.1" || !/^https:\/\/\S+$/.test(up.licenseFileUrl || "") || !up.licenseFilePath) {
        fail(`${at}: claims ${EVIDENCE.upstream} but records no verified upstream OFL 1.1 file`);
      }
    } else if (rec.licenseEvidence === EVIDENCE.googleFontsOnly) {
      if (!EVIDENCE_ONLY_STATUSES.includes(up.status)) {
        fail(`${at}: marked ${EVIDENCE.googleFontsOnly} but upstream status is ${up.status}`);
      }
    } else {
      fail(`${at}: licenseEvidence must be ${EVIDENCE.upstream} or ${EVIDENCE.googleFontsOnly}`);
    }
    const gfe = rec.googleFontsEvidence || {};
    if (!gfe.metadataLicense || !gfe.licenseFile || !gfe.fontLicenseRecords) {
      fail(`${at}: googleFontsEvidence is incomplete`);
    }
    stats.evidence[rec.licenseEvidence] = (stats.evidence[rec.licenseEvidence] || 0) + 1;
    const dir = path.join(FONT_DIR, font.id);
    const licensePath = path.join(dir, font.licenseFile);
    if (!fs.existsSync(licensePath)) {
      fail(`${at}: ${font.licenseFile} missing`);
      continue;
    }
    const licenseText = decode(fs.readFileSync(licensePath));
    if (licenseBody(licenseText) !== officialBody) fail(`${at}: ${font.licenseFile} is not the official OFL 1.1 text`);
    const header = licenseHeader(licenseText);
    if (header !== rec.copyright || header !== font.copyright) {
      fail(`${at}: copyright in the data or audit differs from the ${font.licenseFile} header`);
    }
    const rfn = /Reserved\s+Font\s+Names?/i.test(header);
    if (rfn !== font.reservedFontName || rfn !== rec.reservedFontName) fail(`${at}: Reserved Font Name flag disagrees with the license file`);
    if (rfn) stats.rfn++;

    // FILES
    const listed = new Map(rec.files.map((f) => [f.file, f]));
    const onDisk = fs.readdirSync(dir);
    for (const name of onDisk) {
      if (!listed.has(name)) fail(`${at}: ${name} is on disk but not in the audit`);
    }
    for (const [name, entry] of listed) {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) {
        fail(`${at}: audited file ${name} is missing`);
        continue;
      }
      const buf = fs.readFileSync(p);
      const hash = sha256(buf);
      if (hash !== entry.sha256) fail(`${at}: ${name} does not match its audited SHA-256`);
      // License files are legitimately shared (one author, several families);
      // font files never are.
      if (entry.role !== "license") {
        if (hashOwner.has(hash) && hashOwner.get(hash) !== at) fail(`${at}: ${name} duplicates a font file of ${hashOwner.get(hash)}`);
        hashOwner.set(hash, at);
      }
      stats.files++;
    }
    for (const v of font.variants) {
      for (const name of [v.file, v.web]) if (!listed.has(name)) fail(`${at}: variant file ${name} is not audited`);
    }

    // FONTS
    for (const v of font.variants) {
      const buf = fs.readFileSync(path.join(dir, v.file));
      let info;
      try {
        info = sfnt.readSfnt(buf);
      } catch (e) {
        fail(`${at}: ${v.file} unreadable: ${e.message}`);
        continue;
      }
      stats.originals++;
      if (info.variable) stats.variable++;
      const family = info.names.typographicFamily || info.names.family || "";
      if (!family.toLowerCase().startsWith(font.family.toLowerCase())) fail(`${at}: ${v.file} names family "${family}", not "${font.family}"`);
      if (info.weightClass !== v.weight && GDI_WEIGHT[info.weightClass] !== v.weight) {
        fail(`${at}: ${v.file} weight ${info.weightClass} != variant ${v.weight}`);
      }
      if (sfnt.isItalic(info) !== (v.style === "italic")) fail(`${at}: ${v.file} italic flags != variant style ${v.style}`);
      const emb = sfnt.embedding(info.fsType);
      if (emb === "restricted" || emb === "unknown") fail(`${at}: ${v.file} forbids embedding (fsType ${info.fsType})`);
      const ld = info.names.licenseDescription;
      if (ld && (!NAMES_OFL.test(ld) || NAMES_OTHER.test(ld))) fail(`${at}: ${v.file} license record contradicts the OFL`);
      if (!info.codepoints.has(0x41) || !info.codepoints.has(0x61)) fail(`${at}: ${v.file} does not map basic Latin A/a`);

      if (v.web !== v.file) {
        try {
          sfnt.checkWoff2(fs.readFileSync(path.join(dir, v.web)));
          stats.woff2++;
        } catch (e) {
          fail(`${at}: ${v.web} is not a valid WOFF2: ${e.message}`);
        }
      }
    }
  }

  if (errors.length) {
    console.error(`✗ font check failed (${errors.length}):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  const lic = Object.entries(stats.licenses).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(
    `✓ ${fonts.length} font families verified — ${stats.files} files ` +
      `(${stats.originals} original font files, ${stats.woff2} WOFF2 previews), ` +
      `${stats.originals - stats.variable} static / ${stats.variable} variable font files, ` +
      `licenses: ${lic}, ${stats.rfn} with a Reserved Font Name, ` +
      `evidence: ${stats.evidence[EVIDENCE.upstream] || 0} upstream license file verified / ` +
      `${stats.evidence[EVIDENCE.googleFontsOnly] || 0} Google Fonts evidence only, ` +
      `${(audit.rejected || []).length} rejected candidates on record`,
  );
}

main();
