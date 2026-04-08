import { loadConfig } from "../src/config.ts";
import { createServerContext } from "../src/server/context.ts";
import { callTool } from "../src/server/tool-router.ts";

async function main(): Promise<void> {
  const context = createServerContext(loadConfig());
  const connect = await callTool(context, "browser_connect", { browser: "brave", port: 9222 });
  if (!connect.ok) {
    console.log(JSON.stringify(connect, null, 2));
    process.exitCode = 1;
    return;
  }

  const sessionId = connect.data.session.sessionId;
  const open = await callTool(context, "browser_new_tab", { sessionId, url: "https://example.com/" });
  console.log("OPEN");
  console.log(JSON.stringify(open, null, 2));
  if (!open.ok) {
    process.exitCode = 1;
    return;
  }

  const tabId = open.data.tab.tabId;
  const close = await callTool(context, "browser_close_tab", { sessionId, tabId });
  console.log("CLOSE");
  console.log(JSON.stringify(close, null, 2));

  const tabs = await callTool(context, "browser_list_tabs", { sessionId });
  console.log("TABS");
  console.log(JSON.stringify(tabs, null, 2));
  await callTool(context, "browser_disconnect", { sessionId });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
