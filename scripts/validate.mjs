import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const FORBIDDEN_RE = /\b(affiliate|affiliates|commission|commissions|harrybuild|hforj|haiweiliu|alexbuilding|meetsurfaced|mingcomco)\b/i;
const HIDDEN_CHAR_RE = /[\u200B-\u200D\uFEFF\u2060]/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidHttpUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseCsvRow(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export function validateDataset(dataset, readmeText = "", csvText = "") {
  const errors = [];

  if (!dataset || typeof dataset !== "object") {
    return ["Dataset must be a JSON object."];
  }
  if (!Array.isArray(dataset.forms) || dataset.forms.length === 0) {
    return ["Dataset 'forms' must be a non-empty array."];
  }
  if (dataset.total_forms !== dataset.forms.length) {
    errors.push(`total_forms (${dataset.total_forms}) does not match forms.length (${dataset.forms.length}).`);
  }
  if (!ISO_DATE_RE.test(String(dataset.as_of || ""))) {
    errors.push(`Invalid top-level as_of date: ${dataset.as_of}`);
  }
  if (dataset.directory_url !== "https://modevc.com/investors/") {
    errors.push(`Unexpected directory_url: ${dataset.directory_url}`);
  }
  if (dataset.mcp_endpoint !== "https://modevc.com/api/mcp") {
    errors.push(`Unexpected mcp_endpoint: ${dataset.mcp_endpoint}`);
  }

  const seenSlugs = new Set();
  for (let i = 0; i < dataset.forms.length; i++) {
    const f = dataset.forms[i];
    const tag = `forms[${i}] (${f?.firm_slug || "missing-slug"})`;

    if (typeof f.firm_slug !== "string" || !/^[a-z0-9-]+$/.test(f.firm_slug)) {
      errors.push(`${tag}: invalid firm_slug`);
    } else if (seenSlugs.has(f.firm_slug)) {
      errors.push(`${tag}: duplicate firm_slug`);
    } else {
      seenSlugs.add(f.firm_slug);
    }

    if (typeof f.firm_name !== "string" || !f.firm_name.trim()) {
      errors.push(`${tag}: missing firm_name`);
    }
    if (!isValidHttpUrl(f.website)) {
      errors.push(`${tag}: invalid website URL (${f.website})`);
    }
    if (!isValidHttpUrl(f.intake_url)) {
      errors.push(`${tag}: invalid intake_url (${f.intake_url})`);
    }
    if (!isValidHttpUrl(f.directory_url) || new URL(f.directory_url).hostname !== "modevc.com") {
      errors.push(`${tag}: directory_url must be on modevc.com (${f.directory_url})`);
    }
    if (typeof f.form_provider !== "string" || !f.form_provider.trim()) {
      errors.push(`${tag}: missing form_provider`);
    }
    if (typeof f.has_captcha !== "boolean") {
      errors.push(`${tag}: has_captcha must be boolean`);
    }
    if (typeof f.prefill_supported !== "boolean") {
      errors.push(`${tag}: prefill_supported must be boolean`);
    }
    if (!Array.isArray(f.stages) || !Array.isArray(f.sectors)) {
      errors.push(`${tag}: stages and sectors must be arrays`);
    }
    if (f.verified_http_status !== 200) {
      errors.push(`${tag}: verified_http_status must be 200`);
    }
    if (!ISO_DATE_RE.test(String(f.last_checked || ""))) {
      errors.push(`${tag}: invalid last_checked date (${f.last_checked})`);
    }

    const serialized = JSON.stringify(f);
    if (EMAIL_RE.test(serialized)) {
      errors.push(`${tag}: personal or raw email pattern detected`);
    }
    if (FORBIDDEN_RE.test(serialized)) {
      errors.push(`${tag}: forbidden keyword detected`);
    }
    if (HIDDEN_CHAR_RE.test(serialized)) {
      errors.push(`${tag}: hidden Unicode tracking character detected`);
    }
  }

  if (dataset.unique_firms !== seenSlugs.size) {
    errors.push(`unique_firms (${dataset.unique_firms}) does not match unique slug count (${seenSlugs.size}).`);
  }

  if (readmeText) {
    if (EMAIL_RE.test(readmeText)) {
      errors.push("README.md contains an email address pattern.");
    }
    if (FORBIDDEN_RE.test(readmeText)) {
      errors.push("README.md contains a forbidden keyword.");
    }
    if (HIDDEN_CHAR_RE.test(readmeText)) {
      errors.push("README.md contains a hidden Unicode tracking character.");
    }
    if (!readmeText.includes("https://modevc.com/investors/") || !readmeText.includes("https://modevc.com/api/mcp")) {
      errors.push("README.md must link to both https://modevc.com/investors/ and https://modevc.com/api/mcp.");
    }
  }

  if (csvText) {
    if (EMAIL_RE.test(csvText)) {
      errors.push("vc_intake_forms.csv contains an email address pattern.");
    }
    if (FORBIDDEN_RE.test(csvText)) {
      errors.push("vc_intake_forms.csv contains a forbidden keyword.");
    }
    if (HIDDEN_CHAR_RE.test(csvText)) {
      errors.push("vc_intake_forms.csv contains a hidden Unicode tracking character.");
    }
    const csvLines = csvText.trimEnd().split(/\r?\n/);
    if (csvLines.length < 2) {
      errors.push("vc_intake_forms.csv must contain a header and data rows.");
    } else {
      const header = parseCsvRow(csvLines[0]);
      const dataRows = csvLines.slice(1);
      if (dataRows.length !== dataset.forms.length) {
        errors.push(`vc_intake_forms.csv row count (${dataRows.length}) does not match JSON forms count (${dataset.forms.length}).`);
      }
      const csvSlugs = new Set();
      for (let i = 0; i < dataRows.length; i++) {
        const cols = parseCsvRow(dataRows[i]);
        if (cols.length !== header.length) {
          errors.push(`vc_intake_forms.csv row ${i + 1}: expected ${header.length} columns, got ${cols.length}`);
          continue;
        }
        csvSlugs.add(cols[0]);
        if (!isValidHttpUrl(cols[3]) || !isValidHttpUrl(cols[4])) {
          errors.push(`vc_intake_forms.csv row ${i + 1} (${cols[0]}): invalid URL`);
        }
        if (cols[14] !== "200") {
          errors.push(`vc_intake_forms.csv row ${i + 1} (${cols[0]}): verified_http_status must be 200`);
        }
      }
      if (csvSlugs.size !== seenSlugs.size) {
        errors.push(`vc_intake_forms.csv unique slug count (${csvSlugs.size}) does not match JSON (${seenSlugs.size}).`);
      }
    }
  }

  return errors;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataPath = path.join(root, "data", "vc_intake_index.json");
  const csvPath = path.join(root, "data", "vc_intake_forms.csv");
  const readmePath = path.join(root, "README.md");
  const dataset = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const csvText = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, "utf8") : "";
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const errors = validateDataset(dataset, readme, csvText);
  if (errors.length > 0) {
    console.error("Validation failed:\n" + errors.slice(0, 20).join("\n"));
    process.exit(1);
  }
  const csvCount = csvText ? csvText.trimEnd().split(/\r?\n/).length - 1 : 0;
  console.log(
    `OK: ${dataset.total_forms} JSON forms and ${csvCount} CSV rows (${dataset.unique_firms} unique firms, as_of ${dataset.as_of}), 0 emails, 0 forbidden words, 0 duplicate slugs.`
  );
}
