import { describe, expect, it } from "bun:test";
import { explorerPath } from "../../shared/explorer.ts";
import { closeExplorerTab, emptyExplorerState, explorerPair, openExplorerTab, restoreExplorerState, selectExplorerMember, toggleExplorerCode } from "./explorerState.ts";
import { explorerFromSearch, explorerHref } from "./explorerRoute.ts";

const rules = [{ source: "software/src/", description: "software/pseudocode/", suffix: ".md" }];
const source = "software/src/titan_drive_core/src/control_step.cpp";
const description = "software/pseudocode/titan_drive_core/src/control_step.cpp.md";
const context = { machine: "local", project: "sim", thread: "t-0165", workspace: "w68", pane: "w68:p1" };

describe("declared repository pairs", () => {
  it("retains the source extension and resolves both directions to one identity", () => {
    expect(explorerPair(source, rules)).toEqual({ id: source, code: source, description, selected: "code" });
    expect(explorerPair(description, rules)).toEqual({ id: source, code: source, description, selected: "description" });
  });
  it("does not infer a same-name pair in an unrelated repository", () => {
    expect(explorerPair(source, [])).toEqual({ id: source, code: source, description: null, selected: "code" });
    expect(explorerPair("docs/control_step.md", rules).code).toBeNull();
    expect(explorerPair("software/pseudocode/README.md", rules).code).toBeNull();
  });
  it("rejects traversal, roots, drive paths, empty segments and control bytes", () => {
    for (const path of ["../x", "a/../x", "/etc/passwd", "~/x", "C:/x", "C:x", "\\host\\x", "a//b", "a/./b", "a\0b", "a\nb"]) expect(explorerPath(path)).toBeNull();
    expect(explorerPath("docs/A file #1.md")).toBe("docs/A file #1.md");
  });
});

describe("pair tab state", () => {
  it("reuses either member, closes both, and selects the nearest remaining group", () => {
    let state = openExplorerTab(emptyExplorerState(), source, rules);
    state = openExplorerTab(state, "docs/guide.md", rules);
    state = openExplorerTab(state, description, rules);
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]!.selected).toBe("description");
    expect(closeExplorerTab(state, source)).toEqual({ tabs: [state.tabs[1]!], active: "docs/guide.md" });
    expect(closeExplorerTab(state, description)).toEqual(closeExplorerTab(state, source));
  });
  it("keeps each pair's selected member and code visibility independently", () => {
    const other = "software/src/tool/run.sh";
    let state = openExplorerTab(emptyExplorerState(), source, rules);
    state = toggleExplorerCode(state, source);
    expect(state.tabs[0]!.selected).toBe("description");
    state = openExplorerTab(state, other, rules);
    state = selectExplorerMember(state, other, "code");
    expect(state.tabs[0]!.showCode).toBe(false);
    expect(state.tabs[1]!.showCode).toBe(true);
    state = openExplorerTab(state, description, rules);
    expect(state.tabs[0]!.showCode).toBe(false);
    state = selectExplorerMember(state, source, "code");
    expect(state.tabs[0]!.showCode).toBe(true);
  });
  it("keeps source-only and description-only files usable", () => {
    let state = openExplorerTab(emptyExplorerState(), "README.md", []);
    expect(toggleExplorerCode(state, "README.md")).toEqual(state);
    state = closeExplorerTab(state, "missing");
    expect(state.active).toBe("README.md");
    expect(closeExplorerTab(state, "README.md")).toEqual(emptyExplorerState());
  });
  it("revalidates forged partners from history against the declared repository rule", () => {
    const saved = openExplorerTab(emptyExplorerState(), source, rules);
    saved.tabs[0]!.description = "docs/unrelated.md";
    const restored = restoreExplorerState(saved, rules);
    expect(restored.tabs[0]!.description).toBe(description);
    expect(selectExplorerMember(restored, "missing", "code")).toBe(restored);
  });
  it("bounds open groups and keeps the last valid selection when the limit is reached", () => {
    let state = emptyExplorerState();
    for (let index = 0; index < 32; index++) state = openExplorerTab(state, "src/f" + index + ".ts", []);
    expect(state.tabs).toHaveLength(32);
    expect(openExplorerTab(state, "src/too-many.ts", [])).toBe(state);
    const long = "folder/" + "é".repeat(3000) + ".ts";
    expect(openExplorerTab(emptyExplorerState(), long, []).tabs).toHaveLength(0);
  });
});

describe("explorer links", () => {
  it("round trips all identity, ordered groups, member selection, visibility and active group", () => {
    let state = openExplorerTab(emptyExplorerState(), source, rules);
    state = toggleExplorerCode(state, source);
    state = openExplorerTab(state, "docs/A file #1.md", rules);
    const href = explorerHref({ context, state }, "/");
    expect(href).not.toContain("/Users/");
    expect(explorerFromSearch(href.slice(1))).toEqual({ context, state });
  });
  it("does not trust a root, invalid identity, invalid selection, or an oversized URL", () => {
    expect(explorerFromSearch("?explore=1&machine=local&project=sim&workspace=w68&root=/etc")).toBeNull();
    expect(explorerFromSearch("?explore=1&project=../sim&workspace=w68")).toBeNull();
    expect(explorerFromSearch("?explore=1&project=sim&workspace=w68&tabs=" + "x".repeat(40000))).toBeNull();
    const state = openExplorerTab(emptyExplorerState(), source, rules);
    state.tabs[0]!.showCode = false;
    expect(explorerFromSearch(explorerHref({ context, state }, "/").slice(1))).toBeNull();
    expect(explorerFromSearch("?explore=1&project=sim&project=other&workspace=w68")).toBeNull();
  });
  it("requires the same project, workspace and thread on every restored entry", () => {
    const first = explorerHref({ context, state: emptyExplorerState() }, "/");
    const secondContext = { ...context, thread: "t-0164", pane: "w67:p1", workspace: "w67" };
    const second = explorerHref({ context: secondContext, state: emptyExplorerState() }, "/");
    expect(explorerFromSearch(first.slice(1))!.context).toEqual(context);
    expect(explorerFromSearch(second.slice(1))!.context).toEqual(secondContext);
  });
});
