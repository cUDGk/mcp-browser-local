import { loadConfig } from "../src/config.ts";
import { createServerContext } from "../src/server/context.ts";
import { callTool } from "../src/server/tool-router.ts";

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

  const listTabs = await callTool(context, "browser_list_tabs", { sessionId });
  console.log("TABS");
  console.log(JSON.stringify(listTabs, null, 2));

  const snapshot = await callTool(context, "browser_snapshot", { sessionId });
  console.log("SNAPSHOT");
  console.log(JSON.stringify(snapshot, null, 2));

  const disconnected = await callTool(context, "browser_disconnect", { sessionId });
  console.log("DISCONNECT");
  console.log(JSON.stringify(disconnected, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
