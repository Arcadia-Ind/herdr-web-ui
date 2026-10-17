import type { CSSProperties } from "react";
import type { UsageBarData, UsageBarItem } from "../lib/composerUsage.ts";
import { usageBarItems, usageStateLabel } from "../lib/composerUsage.ts";
import { useLocale, useT } from "../lib/i18n.ts";
import "./ComposerUsageBar.css";

/** Place immediately above the composer. The owner supplies existing data and display time. */
export function ComposerUsageBar(props: UsageBarData) {
  const t = useT();
  const locale = useLocale();
  const items = usageBarItems(props, t, locale);
  return <ComposerUsageReadings items={items} label={t("Context, cache, and account usage")} stateLabel={(state) => usageStateLabel(state, t)} />;
}

/** The same view can be rendered with synthetic observations without a SettingsProvider. */
export function ComposerUsageReadings({ items, label: groupLabel, stateLabel }: {
  items: readonly UsageBarItem[];
  label: string;
  stateLabel: (state: UsageBarItem["state"]) => string;
}) {
  return (
    <div className="composer-usage" role="group" aria-label={groupLabel}>
      <div className="composer-usage-strip">
        {items.map((item) => {
          const state = stateLabel(item.state);
          const label = [item.label, item.value, state].filter(Boolean).join(": ");
          return (
            <details key={item.id} className={`composer-usage-item is-${item.state}`}>
              <summary title={item.detail} aria-label={label}>
                <span className="composer-usage-label">{item.label}</span>
                <span className="composer-usage-value">{item.value}</span>
                {state && item.value !== state && <span className="composer-usage-state">{state}</span>}
                {item.percent !== null && <span className="composer-usage-meter" role="meter" aria-label={item.label}
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, item.percent))}
                  aria-valuetext={label} style={{ "--usage-fill": `${Math.min(100, Math.max(0, item.percent))}%` } as CSSProperties} />}
              </summary>
              <div className="composer-usage-detail">{item.detail}</div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
