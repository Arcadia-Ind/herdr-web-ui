import { expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as bridge from "./bridge.ts";
import { DeviceStore } from "./devices.ts";
import { createServer } from "./index.ts";
import { handleMachineRequest } from "./machine-api.ts";
import type { MachineManager } from "./machines.ts";
import type { UsageService } from "./usage.ts";

it("admits only cached usage reads through an installed app's registered bridge credential", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-bridge-usage-"));
  const devices = new DeviceStore(dir);
  const watcher = devices.pair(devices.startPairing().code, "Fixture watcher", "watch")!;
  devices.match(watcher.token);
  let bridgeToken = "";
  let registrationClosed = false;
  const registration = spyOn(bridge, "registerBridge").mockImplementation((_port, token) => {
    bridgeToken = token!;
    return { token: token!, close() { registrationClosed = true; } };
  });
  const refreshes: boolean[] = [];
  const report = { providers: [], updated_at: "2026-10-17T00:00:00Z" };
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "fixture-app-token", stateDir: dir,
    machines: false, sidecar: false, tailscaleOwner: null, registerBridge: true,
    tailnet: { identity: async () => ({ owner: null, tagged: false, soleLogin: null, dnsName: null, tailnetIp: null }) } as never,
    customization: { paths: { configDir: join(dir, "config"), stateDir: join(dir, "themes"), cacheDir: join(dir, "cache"), projectsRoot: join(dir, "projects"), socket: join(dir, "fixture.sock") } },
    usage: { report: async (refresh = false) => { refreshes.push(refresh); return report; } } as unknown as UsageService,
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const bearer = { authorization: `Bearer ${bridgeToken}` };
  const read = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(origin + path, init);
    await response.arrayBuffer();
    return response;
  };
  try {
    expect(bridgeToken.length).toBeGreaterThan(20);
    expect(bridgeToken).not.toBe("fixture-app-token");
    expect((await read("/api/workspace/projects", { headers: bearer })).status).toBe(200);
    expect((await read("/api/usage", { headers: bearer })).status).toBe(200);
    expect(refreshes).toEqual([false]);
    for (const [path, init] of [
      ["/api/usage?refresh=1", { headers: bearer }],
      ["/api/usage?refresh=0", { headers: bearer }],
      ["/api/usage/login", { headers: bearer }],
      ["/api/devices", { headers: bearer }],
      ["/api/usage", { headers: { ...bearer, "sec-fetch-site": "cross-site" } }],
      ["/api/usage", { headers: { ...bearer, origin: "https://other.invalid" } }],
      ["/api/usage", { headers: { cookie: `herdr_web_token=${bridgeToken}` } }],
      ["/api/usage", { method: "POST", headers: bearer }],
      ["/api/usage", { method: "HEAD", headers: bearer }],
    ] satisfies [string, RequestInit][]) expect((await read(path, init)).status).toBe(401);
    expect(refreshes).toEqual([false]);
    // Ordinary app and device access retains the existing authorization behavior.
    expect((await read("/api/usage", { headers: { authorization: "Bearer fixture-app-token" } })).status).toBe(200);
    expect((await read("/api/usage", { headers: { cookie: `herdr_web_device=${watcher.token}` } })).status).toBe(200);
    expect((await read("/api/usage", { method: "POST", headers: { cookie: `herdr_web_device=${watcher.token}`, "x-herdr-machine": "1" } })).status).toBe(403);
    expect((await read("/api/usage", { method: "POST", headers: { authorization: "Bearer fixture-app-token" } })).status).toBe(405);
    expect((await read("/api/usage")).status).toBe(401);
    // The proxy replaces browser credentials before the actual receiving auth gate.
    const forwarded: Headers[] = [];
    const nativeFetch = globalThis.fetch;
    const observeFetch: typeof fetch = Object.assign(async (input: URL | RequestInfo, init?: RequestInit) => {
      forwarded.push(new Headers(init?.headers));
      return nativeFetch(input, init);
    }, { preconnect: nativeFetch.preconnect });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(observeFetch);
    try {
      const manager = { endpoint: () => ({ url: origin, token: bridgeToken }), trackTerminal: () => () => undefined } as unknown as MachineManager;
      const response = await handleMachineRequest(new Request("http://fixture/api/machines/pc1/usage", { headers: {
        authorization: "Bearer browser-secret", cookie: "herdr_web_device=browser-secret", "x-forwarded-for": "203.0.113.10",
      } }), manager);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(report);
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]!.get("authorization")).toBe(`Bearer ${bridgeToken}`);
      expect(forwarded[0]!.get("cookie")).toBeNull();
      expect(forwarded[0]!.get("x-forwarded-for")).toBeNull();
    } finally { fetchSpy.mockRestore(); }
    expect(refreshes).toEqual([false, false, false, false]);
  } finally {
    server.stop();
    registration.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(registrationClosed).toBe(true);
});
