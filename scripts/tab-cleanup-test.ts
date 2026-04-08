import { loadConfig } from "../src/config.ts";
import { createServerContext } from "../src/server/context.ts";
import { callTool } from "../src/server/tool-router.ts";

const pdfUrl = "https://www.keio.ac.jp/ja/admissions/docs/sfc_2026spring_guide.pdf";

async function main(): Promise<void> {
  const context1 = createServerContext(loadConfig());
  const connect1 = await callTool(context1, "browser_connect", { browser: "brave", port: 9222 });
  if (!connect1.ok) {
    console.log(JSON.stringify(connect1, null, 2));
    process.exitCode = 1;
    return;
  }

  const sessionId1 = connect1.data.session.sessionId;
  const open = await callTool(context1, "browser_pdf_open", { sessionId: sessionId1, url: pdfUrl, newTab: true, note: "cleanup-test" });
  console.log("OPEN");
  console.log(JSON.stringify(open, null, 2));
  const tabId = open.ok ? open.data.tab.tabId : undefined;
  await callTool(context1, "browser_disconnect", { sessionId: sessionId1 });

  const context2 = createServerContext(loadConfig());
  const connect2 = await callTool(context2, "browser_connect", { browser: "brave", port: 9222 });
  if (!connect2.ok) {
    console.log(JSON.stringify(connect2, null, 2));
    process.exitCode = 1;
    return;
  }

  const sessionId2 = connect2.data.session.sessionId;
  const tabs = await callTool(context2, "browser_list_tabs", { sessionId: sessionId2 });
  console.log("CLEANUP_CHECK");
  console.log(JSON.stringify({ tabId, tabs }, null, 2));
  await callTool(context2, "browser_disconnect", { sessionId: sessionId2 });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
