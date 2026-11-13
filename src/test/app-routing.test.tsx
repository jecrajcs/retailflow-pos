import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches the Admin console route instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/admin");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("registers the new Cash Drawer and import approval routes", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.matchRoutes("/cash-drawer").at(-1)?.routeId).not.toBe(rootRouteId);
    expect(router.matchRoutes("/scanner").at(-1)?.routeId).not.toBe(rootRouteId);
    expect(router.matchRoutes("/api/retail-workbook-import").at(-1)?.routeId).not.toBe(rootRouteId);
    expect(router.matchRoutes("/api/cash-session-override").at(-1)?.routeId).not.toBe(rootRouteId);
  });
});
