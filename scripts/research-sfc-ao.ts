import { loadConfig } from "../src/config.ts";
import { createServerContext } from "../src/server/context.ts";
import { callTool } from "../src/server/tool-router.ts";

function extractText(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok: boolean }).ok &&
    "data" in result &&
    typeof (result as { data?: unknown }).data === "object" &&
    (result as { data: { text?: string } }).data?.text
  ) {
    return (result as { data: { text: string } }).data.text;
  }
  return "";
}

async function main(): Promise<void> {
  const context = createServerContext(loadConfig());

  const connect = await callTool(context, "browser_connect", { browser: "brave", port: 9222 });
  if (!connect.ok) {
    console.log(JSON.stringify(connect, null, 2));
    process.exitCode = 1;
    return;
  }

  const sessionId = connect.data.session.sessionId;

  try {
    const created = await callTool(context, "browser_new_tab", {
      sessionId,
      url: "https://www.google.com/search?q=%E6%85%B6%E6%87%89SFC+%E6%98%A5%E5%AD%A3AO"
    });
    console.log("NEW_TAB");
    console.log(JSON.stringify(created, null, 2));
    if (!created.ok) {
      process.exitCode = 1;
      return;
    }

    const tabId = created.data.tab.tabId;

    const googleText = await callTool(context, "browser_get_text", {
      sessionId,
      tabId,
      maxChars: 7000
    });
    console.log("GOOGLE_TEXT");
    console.log(extractText(googleText));

    const official = await callTool(context, "browser_navigate", {
      sessionId,
      tabId,
      url: "https://www.keio.ac.jp/ja/admissions/examinations/ao-sfc/",
      waitUntil: "load",
      timeoutMs: 20000
    });
    console.log("OFFICIAL_NAVIGATE");
    console.log(JSON.stringify(official, null, 2));

    const officialText = await callTool(context, "browser_get_text", {
      sessionId,
      tabId,
      maxChars: 12000
    });
    console.log("OFFICIAL_TEXT");
    console.log(extractText(officialText));

    const officialHtml = await callTool(context, "browser_get_html", {
      sessionId,
      tabId,
      target: {
        selector: "body"
      },
      mode: "outerHTML",
      maxChars: 40000
    });
    console.log("OFFICIAL_HTML");
    if (officialHtml.ok) {
      console.log(officialHtml.data.html);
    } else {
      console.log(JSON.stringify(officialHtml, null, 2));
    }
  } finally {
    await callTool(context, "browser_disconnect", { sessionId });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
