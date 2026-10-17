import { expect, it } from "bun:test";
import type { ProjectCatalog } from "../../shared/customization.ts";
import { projectReadFailed, projectReadSucceeded } from "./projectCatalogState.ts";

it("retains the last catalog and bounded failure details until a successful refresh", () => {
  const catalog: ProjectCatalog = { projects: [], partial: false };
  const error = Object.assign(new Error("catalog read failed"), { status: 503, code: "catalog_unavailable" });
  const stale = projectReadFailed(projectReadSucceeded(catalog), error);
  expect(stale.catalog).toBe(catalog);
  expect(stale.unavailable).toBe(true);
  expect(stale.error).toMatchObject({ name: "Error", message: "catalog read failed", status: 503, code: "catalog_unavailable" });
  expect(stale.error?.at).toBeGreaterThan(0);
  expect(projectReadSucceeded(catalog)).toEqual({ catalog, unavailable: false, error: null });
});

it("distinguishes an initial failure and retains timeout and network diagnostics", () => {
  const first = projectReadFailed(undefined, new DOMException("Timed out", "TimeoutError"));
  expect(first.catalog).toBeNull();
  expect(first.error?.name).toBe("TimeoutError");
  const retry = projectReadFailed(first, new TypeError("Failed to fetch"));
  expect(retry.error?.message).toBe("Failed to fetch");
  expect(projectReadFailed(retry, new Error("x".repeat(1000))).error?.message).toHaveLength(400);
});
