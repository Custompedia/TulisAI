import vinextHandler from "vinext/server/fetch-handler";
import { runMaintenance } from "../src/server/storage/maintenance";
import { httpsRedirect } from "./https";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) { return httpsRedirect(request) ?? vinextHandler.fetch(request, env, ctx); },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runMaintenance(env)); }
} satisfies ExportedHandler<Env>;
