import { loadConfig } from "../src/config.ts";
import { createServerContext } from "../src/server/context.ts";
import { callTool } from "../src/server/tool-router.ts";

const pdfUrl = "https://www.keio.ac.jp/ja/admissions/docs/sfc_2026spring_guide.pdf";

async function main(): Promise<void> {
  const context = createServerContext(loadConfig());
  const connect = await callTool(context, "browser_connect", { browser: "brave", port: 9222 });
  console.log("CONNECT");
  console.log(JSON.stringify(connect, null, 2));

  if (!connect.ok) {
    process.exitCode = 1;
    return;
  }

  const sessionId = connect.data.session.sessionId;

  try {
    const open = await callTool(context, "browser_pdf_open", {
      sessionId,
      url: pdfUrl,
      newTab: true,
      note: "Smoke test PDF tab"
    });
    console.log("PDF_OPEN");
    console.log(JSON.stringify(open, null, 2));

    if (!open.ok) {
      process.exitCode = 1;
      return;
    }

    const tabId = "tab" in open.data ? open.data.tab.tabId : connect.data.session.activeTabId;

    const state1 = await callTool(context, "browser_pdf_viewer_state", { sessionId, tabId });
    console.log("PDF_STATE_1");
    console.log(JSON.stringify(state1, null, 2));

    const next = await callTool(context, "browser_pdf_next_page", { sessionId, tabId });
    console.log("PDF_NEXT");
    console.log(JSON.stringify(next, null, 2));

    const state2 = await callTool(context, "browser_pdf_viewer_state", { sessionId, tabId });
    console.log("PDF_STATE_2");
    console.log(JSON.stringify(state2, null, 2));

    const prev = await callTool(context, "browser_pdf_prev_page", { sessionId, tabId });
    console.log("PDF_PREV");
    console.log(JSON.stringify(prev, null, 2));

    const extract = await callTool(context, "browser_pdf_extract", {
      sessionId,
      tabId,
      pages: [17],
      maxCharsPerPage: 2000
    });
    console.log("PDF_EXTRACT");
    console.log(JSON.stringify(extract, null, 2));

    const tracked = await callTool(context, "browser_list_managed_tabs", { sessionId });
    console.log("MANAGED_TABS");
    console.log(JSON.stringify(tracked, null, 2));
  } finally {
    await callTool(context, "browser_disconnect", { sessionId });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
