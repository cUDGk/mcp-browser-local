import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "../../core/errors.js";
import type { ServerConfig } from "../../config.js";
import { assertPathUnderAllowedRoots, assertSafeNavUrl } from "../../core/security.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsPromise: Promise<PdfJsModule> | undefined;

async function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsPromise;
}

export async function extractPdf(
  input: { filePath?: string; url?: string; pages?: number[]; maxCharsPerPage?: number },
  config: ServerConfig
): Promise<{
  title?: string;
  pageCount: number;
  pageTexts: Array<{ page: number; text: string }>;
}> {
  let data: Uint8Array;

  if (input.filePath) {
    // S2: restrict reads to allowedReadRoots; require .pdf extension.
    if (!input.filePath.toLowerCase().endsWith(".pdf")) {
      throw new ToolError("INVALID_ARGUMENT", "filePath must end with .pdf");
    }
    const resolved = await assertPathUnderAllowedRoots(input.filePath, config.allowedReadRoots);
    const stat = await fs.stat(resolved);
    if (stat.size > config.maxPdfBytes) {
      throw new ToolError("INVALID_ARGUMENT", `PDF file exceeds size cap (${stat.size} > ${config.maxPdfBytes})`);
    }
    data = new Uint8Array(await fs.readFile(resolved));
  } else if (input.url) {
    // S3: SSRF guard + reject file:// + per-hop AbortController derived from a total deadline.
    if (input.url.toLowerCase().startsWith("file:")) {
      throw new ToolError("INVALID_ARGUMENT", "file:// is not allowed for PDF fetch");
    }
    await assertSafeNavUrl(input.url, config);
    // S3: track one total deadline; each hop gets its own AbortController with
    // `deadline - Date.now()` ms so a shared signal isn't exhausted across hops.
    const deadline = Date.now() + config.defaultCommandTimeoutMs;
    const makeHopController = () => {
      const ctrl = new AbortController();
      const remaining = Math.max(0, deadline - Date.now());
      const t = setTimeout(() => ctrl.abort(), remaining);
      return { ctrl, t };
    };
    try {
      // S8: follow redirects manually so each Location is re-validated against the SSRF guard.
      // Without this, an attacker-controlled host can 302 to http://127.0.0.1/ and bypass the
      // private-network check that ran on input.url.
      let { ctrl, t } = makeHopController();
      let response = await fetch(input.url, { signal: ctrl.signal, redirect: "manual" }).finally(() => clearTimeout(t));
      let currentUrl = input.url;
      let hops = 0;
      while (response.status >= 300 && response.status < 400 && hops < 5) {
        const loc = response.headers.get("location");
        if (!loc) break;
        const next = new URL(loc, currentUrl).toString();
        await assertSafeNavUrl(next, config);
        ({ ctrl, t } = makeHopController());
        response = await fetch(next, { signal: ctrl.signal, redirect: "manual" }).finally(() => clearTimeout(t));
        currentUrl = next;
        hops += 1;
      }
      if (!response.ok) {
        throw new ToolError("PDF_OPEN_FAILED", `Failed to fetch PDF from ${input.url}`, true, {
          status: response.status
        });
      }
      const contentLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(contentLength) && contentLength > config.maxPdfBytes) {
        throw new ToolError("INVALID_ARGUMENT", `Remote PDF exceeds size cap (${contentLength} > ${config.maxPdfBytes})`);
      }
      const buf = new Uint8Array(await response.arrayBuffer());
      if (buf.byteLength > config.maxPdfBytes) {
        throw new ToolError("INVALID_ARGUMENT", `Remote PDF exceeds size cap (${buf.byteLength} > ${config.maxPdfBytes})`);
      }
      data = buf;
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError("PDF_OPEN_FAILED", `PDF fetch failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  } else {
    throw new ToolError("INVALID_ARGUMENT", "PDF extraction requires filePath or url");
  }

  try {
    const { getDocument } = await loadPdfJs();
    const loadingTask = getDocument({ data });
    const document = await loadingTask.promise;
    const requestedPages = input.pages && input.pages.length > 0 ? input.pages : Array.from({ length: document.numPages }, (_, index) => index + 1);
    if (requestedPages.length > config.maxPdfPages) {
      throw new ToolError("INVALID_ARGUMENT", `PDF page count exceeds cap (${requestedPages.length} > ${config.maxPdfPages})`);
    }
    const outOfBounds = requestedPages.filter((p) => p < 1 || p > document.numPages);
    if (outOfBounds.length > 0) {
      throw new ToolError("INVALID_ARGUMENT", `Page numbers out of range [1..${document.numPages}]: ${outOfBounds.join(", ")}`);
    }
    const pageTexts: Array<{ page: number; text: string }> = [];

    for (const pageNumber of requestedPages) {
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
    if (error instanceof ToolError) throw error;
    throw new ToolError("PDF_PARSE_FAILED", "Failed to parse PDF", false, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
