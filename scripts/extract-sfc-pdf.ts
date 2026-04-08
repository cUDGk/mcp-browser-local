import { extractPdf } from "../src/backends/chromium/pdf.ts";

const url = "https://www.keio.ac.jp/ja/admissions/docs/sfc_2026spring_guide.pdf";

async function main(): Promise<void> {
  const result = await extractPdf({
    url,
    pages: [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
    maxCharsPerPage: 12000
  });

  console.log(`TITLE: ${result.title ?? "(none)"}`);
  console.log(`PAGES: ${result.pageCount}`);

  for (const page of result.pageTexts) {
    console.log(`\n=== PAGE ${page.page} ===`);
    console.log(page.text);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
