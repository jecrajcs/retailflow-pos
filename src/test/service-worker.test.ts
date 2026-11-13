import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
const origin = "https://retailflow.test";

type WorkerEvent = {
  request?: Request;
  respondWith?: (response: Promise<Response>) => void;
};

function navigationRequest(url: string) {
  return { method: "GET", mode: "navigate", url } as Request;
}

function createWorkerHarness() {
  const stores = new Map<string, Map<string, Response>>();
  let offline = false;
  const fetchMock = vi.fn(async (input: Request | string) => {
    if (offline) throw new Error("offline");
    const request = typeof input === "string" ? new Request(new URL(input, origin)) : input;
    return new Response(`network:${new URL(request.url).pathname}`);
  });
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        add: async (path: string) => {
          const request = new Request(new URL(path, origin));
          entries.set(request.url, await fetchMock(request));
        },
        put: async (request: Request, response: Response) => {
          entries.set(request.url, response);
        },
        match: async (request: Request) => entries.get(request.url)?.clone(),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        delete: async (request: Request) => entries.delete(request.url),
      };
    }),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const self = {
    location: { origin },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (name: string, callback: (event: WorkerEvent) => void) =>
      handlers.set(name, callback),
  };
  runInNewContext(workerSource, { self, caches, URL, Request, Response, fetch: fetchMock });
  return {
    handlers,
    stores,
    fetchMock,
    setOffline(value: boolean) {
      offline = value;
    },
  };
}

describe("offline scanner service worker", () => {
  it("serves a previously opened scanner page when the connection drops", async () => {
    const worker = createWorkerHarness();
    const respond = (request: Request) => {
      let response: Promise<Response> | undefined;
      worker.handlers.get("fetch")!({
        request,
        respondWith: (value: Promise<Response>) => (response = value),
      });
      return response;
    };

    const onlineResponse = await respond(navigationRequest(`${origin}/scanner?mode=phone`));
    expect(await onlineResponse?.text()).toBe("network:/scanner");
    worker.setOffline(true);
    const offlineResponse = await respond(navigationRequest(`${origin}/scanner?mode=phone`));
    expect(await offlineResponse?.text()).toBe("network:/scanner");
    expect(worker.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches built scanner assets but leaves API requests out of the cache", async () => {
    const worker = createWorkerHarness();
    const respond = (request: Request) => {
      let response: Promise<Response> | undefined;
      worker.handlers.get("fetch")!({
        request,
        respondWith: (value: Promise<Response>) => (response = value),
      });
      return response;
    };

    expect(await (await respond(new Request(`${origin}/assets/scanner-hash.js`)))?.text()).toBe(
      "network:/assets/scanner-hash.js",
    );
    worker.setOffline(true);
    expect(await (await respond(new Request(`${origin}/assets/scanner-hash.js`)))?.text()).toBe(
      "network:/assets/scanner-hash.js",
    );

    const apiResponse = respond(new Request(`${origin}/api/retail-sync`));
    expect(apiResponse).toBeUndefined();
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(worker.stores.get("dailyplazaa-shell-v1")?.size).toBe(1);
  });
});
