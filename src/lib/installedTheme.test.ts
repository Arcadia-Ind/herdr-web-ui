import { expect, it } from "bun:test";
import { contrast, installedThemeTokens } from "./installedTheme.ts";

it("preserves dark and light backgrounds with readable text, links and statuses", () => {
  for (const panel_bg of ["#101020", "#ffffff"]) {
    const vars = installedThemeTokens({ id: "custom", name: "Custom", mode: panel_bg === "#ffffff" ? "light" : "dark", colors: { panel_bg, text: "#999999", accent: "#8888aa", red: "#ffdddd", green: "#ccffcc", blue: "#eeeeff" } });
    for (const bg of ["--bg", "--bg-panel", "--bg-elevated", "--bg-selected", "--bg-hover"]) {
      for (const fg of ["--text", "--text-dim", "--accent", "--status-working", "--status-blocked", "--status-done"]) expect(contrast(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(vars["--bg"]).toBe(panel_bg);
    expect(contrast(vars["--primary"]!, vars["--primary-text"]!)).toBeGreaterThanOrEqual(4.5);
  }
});
