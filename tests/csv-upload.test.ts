import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localizeCSVUploadMessage,
  validateCSVUploadFiles,
} from "../lib/import/upload";
import { Language, translate } from "../lib/i18n";

test("multiple CSV files are accepted while Excel, TSV, and empty files fail clearly", () => {
  assert.doesNotThrow(() =>
    validateCSVUploadFiles([
      { name: "employees.csv", size: 12 },
      { name: "availability.CSV", size: 24 },
    ]),
  );
  assert.throws(
    () => validateCSVUploadFiles([{ name: "planning.xlsx", size: 12 }]),
    /planning\.xlsx: Unsupported file type\. Upload \.csv files only\./,
  );
  assert.throws(
    () => validateCSVUploadFiles([{ name: "legacy.xls", size: 12 }]),
    /Unsupported file type/,
  );
  assert.throws(
    () => validateCSVUploadFiles([{ name: "data.tsv", size: 12 }]),
    /Unsupported file type/,
  );
  assert.throws(
    () => validateCSVUploadFiles([{ name: "empty.csv", size: 0 }]),
    /empty\.csv: The file is empty/,
  );
});

test("unsupported Excel uploads show a localized CSV-only error in every language", () => {
  const message = "planning.xlsx: Unsupported file type. Upload .csv files only.";
  for (const language of ["en", "tr", "fr", "es"] as Language[]) {
    const localized = localizeCSVUploadMessage(message, (text) =>
      translate(language, text),
    );
    assert.ok(localized.startsWith("planning.xlsx: "));
    assert.equal(
      localized.slice("planning.xlsx: ".length),
      translate(language, "Unsupported file type. Upload .csv files only."),
    );
    if (language !== "en")
      assert.notEqual(localized, message, `${language} should translate the rejection`);
  }
});

test("CSV-only upload and AI destination messages are translated in all four languages", () => {
  const messages = [
    "Drop CSV files here",
    "Choose CSV files",
    "Upload CSV files",
    "Unsupported file type. Upload .csv files only.",
    "AI returned a dataset type incompatible with Scheduling. Select the matching destination or upload a Scheduling CSV file.",
    "AI could not match this file to Scheduling. Choose a compatible destination or upload a matching CSV file.",
    "AI returned a dataset type incompatible with Resource Allocation. Select the matching destination or upload a Resource Allocation CSV file.",
    "AI could not match this file to Resource Allocation. Choose a compatible destination or upload a matching CSV file.",
  ];
  for (const message of messages) {
    assert.equal(translate("en", message), message);
    for (const language of ["tr", "fr", "es"] as Language[])
      assert.notEqual(translate(language, message), message, `${language}: ${message}`);
  }
});
