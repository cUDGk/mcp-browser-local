import { loadConfig } from "../src/config.ts";
import { createServerContext } from "../src/server/context.ts";
import { callTool } from "../src/server/tool-router.ts";

const context = createServerContext(loadConfig());
console.time("browser_list_installations");
const installations = await callTool(context, "browser_list_installations", {});
console.timeEnd("browser_list_installations");
console.log(JSON.stringify(installations, null, 2));
console.time("browser_list_running");
const running = await callTool(context, "browser_list_running", {});
console.timeEnd("browser_list_running");
console.log(JSON.stringify(running, null, 2));
process.exit(0);
