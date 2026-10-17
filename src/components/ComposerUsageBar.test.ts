import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUsage } from "../../shared/composer-usage.ts";
import { usageBarItems, usageStateLabel } from "../lib/composerUsage.ts";
import type { Translate } from "../lib/i18n.ts";
import { ComposerUsageReadings } from "./ComposerUsageBar.tsx";

const at = "2026-10-17T05:00:00Z";
const session: SessionUsage = { provider: "codex", model: "test", observed_at: at,
  context: { used: 12_000, limit: 10_000, basis: "total" },
  cache: { input_tokens: 1000, read_tokens: 0, creation_tokens: null }, quota: null };
const t: Translate = (key, vars) => key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match));
const render = (sample: SessionUsage | null) => renderToStaticMarkup(createElement(ComposerUsageReadings, {
  items: usageBarItems({ agent: "codex", session: sample, account: null, now: Date.parse(at) }, t),
  label: "Usage", stateLabel: (state) => usageStateLabel(state, t),
}));

describe("composer usage bar markup", () => {
  it("exposes four expandable summaries and honest meters without provider calls", () => {
    const html = render(session);
    expect(html.match(/<details\b/g)).toHaveLength(4);
    expect(html.match(/<summary\b/g)).toHaveLength(4);
    expect(html).toContain("120%");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("Cache reads / all input tokens in the last request.");
    expect(html).toContain('role="group"');
  });

  it("does not draw zero-valued meters for missing data", () => {
    const html = render(null);
    expect(html).toContain("Unavailable");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain('aria-valuenow="0"');
  });
});
