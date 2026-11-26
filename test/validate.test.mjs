import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDataset } from "../scripts/validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "data", "vc_intake_index.json"), "utf8"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("published dataset and README pass all privacy, schema, and URL checks", () => {
  const errors = validateDataset(dataset, readme);
  assert.deepEqual(errors, []);
  assert.equal(dataset.total_forms, dataset.forms.length);
  assert.equal(dataset.unique_firms, dataset.forms.length);
});

test("rejects duplicate firm slugs", () => {
  const clone = structuredClone(dataset);
  clone.forms[1].firm_slug = clone.forms[0].firm_slug;
  const errors = validateDataset(clone, readme);
  assert.ok(errors.some((e) => e.includes("duplicate firm_slug")));
});

test("rejects personal or raw email strings", () => {
  const clone = structuredClone(dataset);
  clone.forms[0].firm_name = "Test VC partner@example.com";
  const errors = validateDataset(clone, readme);
  assert.ok(errors.some((e) => e.includes("email pattern")));
});

test("rejects invalid intake URLs and forbidden words", () => {
  const clone = structuredClone(dataset);
  clone.forms[0].intake_url = "ftp://invalid.example.com";
  clone.forms[1].headquarters = "Affiliate Network";
  const errors = validateDataset(clone, readme);
  assert.ok(errors.some((e) => e.includes("invalid intake_url")));
  assert.ok(errors.some((e) => e.includes("forbidden keyword")));
});
