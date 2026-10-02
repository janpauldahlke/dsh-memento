// src/shared/types.ts
var PLUGIN = "dsh-memento";
var HEALTH_ROUTE = "/api/dsh-memento/health";
var VERSION = "0.1.0";
var MILESTONE = "M0";

// src/host/index.ts
var name = PLUGIN;
var inject = [];
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function registerRoute(ctx) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: HEALTH_ROUTE,
    handler: (req, res) => {
      void (async () => {
        try {
          if (req.method !== "GET") {
            send(res, 405, { ok: false, error: "method not allowed; use GET" });
            return;
          }
          const payload = {
            ok: true,
            plugin: PLUGIN,
            version: VERSION,
            milestone: MILESTONE
          };
          send(res, 200, payload);
        } catch (err) {
          send(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      })();
    }
  });
  ctx.effect(() => unregister, "memento: health route");
}
function apply(ctx) {
  ctx.inject(["webServer"], (webCtx) => {
    try {
      registerRoute(webCtx);
    } catch (err) {
      webCtx.logger?.("dsh-memento").error("route registration failed: %s", err instanceof Error ? err.message : String(err));
    }
  });
}
export {
  HEALTH_ROUTE,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
