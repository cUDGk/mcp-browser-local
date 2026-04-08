import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "../../core/errors.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsPromise: Promise<PdfJsModule> | undefined;

async function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsPromise;
}

export async function extractPdf(input: { filePath?: string; url?: string; pages?: number[]; maxCharsPerPage?: number }): Promise<{
  title?: string;
  pageCount: number;
  pageTexts: Array<{ page: number; text: string }>;
}> {
  let data: Uint8Array;

  if (input.filePath) {
    data = new Uint8Array(await fs.readFile(path.resolve(input.filePath)));
  } else if (input.url) {
    const response = await fetch(input.url);
    if (!response.ok) {
      throw new ToolError("PDF_OPEN_FAILED", `Failed to fetch PDF from ${input.url}`, true, {
        status: response.status
      });
    }
    data = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new ToolError("INVALID_ARGUMENT", "PDF extraction requires filePath or url");
  }

  try {
    const { getDocument } = await loadPdfJs();
    const loadingTask = getDocument({ data });
    const document = await loadingTask.promise;
    const pages = input.pages && input.pages.length > 0 ? input.pages : Array.from({ length: document.numPages }, (_, index) => index + 1);
    const pageTexts: Array<{ page: number; text: string }> = [];

    for (const pageNumber of pages) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const joined = text.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .slice(0, input.maxCharsPerPage ?? 4000);
      pageTexts.push({ page: pageNumber, text: joined });
    }

    const metadata = await document.getMetadata().catch(() => undefined);
    return {
      title: typeof (metadata?.info as { Title?: unknown } | undefined)?.Title === "string" ? (metadata?.info as { Title: string }).Title : undefined,
      pageCount: document.numPages,
      pageTexts
    };
  } catch (error) {
    throw new ToolError("PDF_PARSE_FAILED", "Failed to parse PDF", false, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
