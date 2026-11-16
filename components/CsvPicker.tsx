"use client";
import { useState } from "react";
import {
  localizeCSVUploadMessage,
  validateCSVUploadFiles,
} from "../lib/import/upload";

export function useCSVUpload(
  consume: (files: File[]) => Promise<boolean>,
  translate: (message: string) => string,
) {
  const [error, setError] = useState("");

  async function upload(files: File[]) {
    setError("");
    try {
      validateCSVUploadFiles(files);
      if (files.length) await consume(files);
    } catch (failure) {
      setError(
        localizeCSVUploadMessage(
          failure instanceof Error ? failure.message : String(failure),
          translate,
        ),
      );
    }
  }

  const picker = error ? (
    <div className="notice error" role="alert">
      {error}
      <button className="btn" onClick={() => setError("")}>
        {translate("Dismiss")}
      </button>
    </div>
  ) : null;

  return { upload, picker };
}
