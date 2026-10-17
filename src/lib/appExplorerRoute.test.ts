import { expect, it } from "bun:test";
import { embeddedExplorerFromSearch, embeddedExplorerHref } from "./appExplorerRoute.ts";
import { explorerHref } from "./explorerRoute.ts";
import { emptyExplorerState, openExplorerTab, toggleExplorerCode } from "./explorerState.ts";

it("keeps embedded explorer identity and paired state through a reload without changing app selection", () => {
  const context = { machine: "local", project: "sim", workspace: "w68", pane: "w68:p1", thread: "t-0165" };
  let state = openExplorerTab(emptyExplorerState(), "software/src/main.cpp", [{ source: "software/src/", description: "software/pseudocode/", suffix: ".md" }]);
  state = toggleExplorerCode(state, state.active!);
  const target = { context, state };
  const search = embeddedExplorerHref(target, "?pane=w1:p1&machine=pc2&sidebar=hidden").slice(1);
  const query = new URLSearchParams(search);
  expect(query.get("pane")).toBe("w1:p1");
  expect(query.get("machine")).toBe("pc2");
  expect(query.get("sidebar")).toBe("hidden");
  expect(embeddedExplorerFromSearch(search)).toEqual(target);
  expect(embeddedExplorerHref(null, search)).toBe("/?pane=w1%3Ap1&machine=pc2&sidebar=hidden");
});

it("refuses external, repeated, malformed and invalid embedded targets", () => {
  for (const search of ["?explorer=https://evil.invalid/", "?explorer=/?explore=1", "?explorer=x&explorer=y"]) {
    expect(embeddedExplorerFromSearch(search)).toBeNull();
  }
  const target = { context: { machine: "remote", project: "sim", workspace: "w1", pane: "w1:p1", thread: null }, state: emptyExplorerState() };
  const query = new URLSearchParams({ explorer: explorerHref(target) });
  expect(embeddedExplorerFromSearch("?" + query)?.context.machine).toBe("remote");
});
