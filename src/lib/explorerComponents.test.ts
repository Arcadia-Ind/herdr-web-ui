import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { explorerFixtureApi, explorerFixtureListing, explorerFixtureTarget } from "../components/explorer/ExplorerFixture.tsx";
import { PairedExplorer } from "../components/explorer/PairedExplorer.tsx";
import { closeExplorerTab, selectExplorerMember, toggleExplorerCode } from "./explorerState.ts";
import { SettingsProvider } from "./settings.ts";

// Bun has navigator but no browser language list. No browser or user storage is opened.
const languageDescriptor = Object.getOwnPropertyDescriptor(navigator, "languages");
beforeAll(() => { Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US"] }); });
afterAll(() => {
  if (languageDescriptor) Object.defineProperty(navigator, "languages", languageDescriptor);
  else Reflect.deleteProperty(navigator, "languages");
});

function markup(target = explorerFixtureTarget()): string {
  return renderToStaticMarkup(createElement(SettingsProvider, null,
    createElement(PairedExplorer, { target, api: explorerFixtureApi, initialListing: explorerFixtureListing, history: false })));
}
const members = (html: string) => [...html.matchAll(/class="explorer-document"/g)].length;

describe("read-only explorer view", () => {
  it("refuses a remote context without a trusted owning-machine adapter", () => {
    const target = explorerFixtureTarget();
    target.context.machine = "remote";
    const html = renderToStaticMarkup(createElement(SettingsProvider, null, createElement(PairedExplorer, { target, history: false })));
    expect(html).toContain("File explorer is unavailable on this PC.");
    expect(html).not.toContain("explorer-document");
  });
  it("renders multiple pair groups and both members with one close control per group", () => {
    const html = markup();
    expect(members(html)).toBe(2);
    expect([...html.matchAll(/aria-label="Close pair /g)]).toHaveLength(2);
    expect(html).toContain('aria-label="software/pseudocode/drive/control.cpp.md"');
    expect(html).toContain('aria-label="software/src/drive/control.cpp"');
    expect(html).toContain("Read only");
    expect(html).not.toContain('contenteditable="true"');
    expect(html).not.toContain("xterm");
  });
  it("hides only the selected group's source and preserves its description", () => {
    const target = explorerFixtureTarget();
    target.state = toggleExplorerCode(target.state, target.state.active!);
    const html = markup(target);
    expect(members(html)).toBe(1);
    expect(html).toContain('aria-label="software/pseudocode/drive/control.cpp.md"');
    expect(html).not.toContain('aria-label="software/src/drive/control.cpp"');
    expect(html).toContain("Show code");
  });
  it("closes both members and keeps the other file open", () => {
    const target = explorerFixtureTarget();
    target.state = closeExplorerTab(target.state, "software/pseudocode/drive/control.cpp.md");
    const html = markup(target);
    expect(members(html)).toBe(1);
    expect(html).toContain('aria-label="docs/README.md"');
    expect(html).not.toContain("control.cpp");
    expect(html).not.toContain(">Pseudocode<");
  });
  it("keeps the selected member and a safe standalone link in the rendered view", () => {
    const target = explorerFixtureTarget();
    target.state = selectExplorerMember(target.state, target.state.active!, "description");
    const html = markup(target);
    expect(html).toContain('aria-pressed="true">Pseudocode');
    expect(html).toContain("project=demo");
    expect(html).toContain("thread=t-0001");
    expect(html).toContain("workspace=w1");
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
