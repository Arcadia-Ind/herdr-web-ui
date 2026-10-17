import type { InstalledTheme } from "../../shared/customization.ts";

function channels(hex: string): number[] { return hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16)); }
function mix(a: string, b: string, amount: number): string {
  const other = channels(b);
  return "#" + channels(a).map((value, i) => Math.round(value + (other[i]! - value) * amount).toString(16).padStart(2, "0")).join("");
}
function luminance(color: string): number {
  const values = channels(color).map((byte) => { const value = byte / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Keep a theme's hue where possible; choose the nearest shade that is readable on every surface. */
function readable(color: string, surfaces: string[], minimum = 4.5): string {
  const passes = (value: string) => surfaces.every((surface) => contrast(value, surface) >= minimum);
  if (passes(color)) return color;
  const end = ["#000000", "#ffffff"].sort((a, b) => Math.min(...surfaces.map((bg) => contrast(b, bg))) - Math.min(...surfaces.map((bg) => contrast(a, bg))))[0]!;
  for (let i = 1; i <= 100; i++) { const value = mix(color, end, i / 100); if (passes(value)) return value; }
  return end;
}

/** CSS tokens used by the existing components, including terminal, diff, focus and status colors. */
export function installedThemeTokens(theme: InstalledTheme): Record<string, string> {
  const c = theme.colors;
  const bg = c.panel_bg;
  const fg = readable(c.text, [bg]);
  const sidebar = c.sidebar_bg && contrast(fg, c.sidebar_bg) >= 4.5 ? c.sidebar_bg : bg;
  const row = c.active_row_bg && contrast(fg, c.active_row_bg) >= 4.5 ? c.active_row_bg : mix(bg, c.accent ?? fg, 0.15);
  const hover = mix(bg, fg, 0.07), elevated = mix(bg, fg, 0.04);
  const surfaces = [bg, sidebar, row, hover, elevated];
  const text = readable(fg, surfaces);
  const dim = readable(c.subtext0 ?? mix(bg, fg, 0.65), surfaces);
  const accent = readable(c.accent ?? fg, surfaces);
  const working = readable(c.blue ?? accent, surfaces), blocked = readable(c.red ?? fg, surfaces);
  const done = readable(c.green ?? fg, surfaces), notice = readable(c.yellow ?? fg, surfaces);
  const tint = (color: string) => `color-mix(in srgb, ${color} 15%, transparent)`;
  const vars: Record<string, string> = {
    "--bg": bg, "--bg-panel": sidebar, "--bg-elevated": elevated, "--bg-input": elevated,
    "--bg-hover": hover, "--bg-selected": row, "--bg-code": elevated,
    "--border": mix(bg, fg, 0.22), "--border-strong": mix(bg, fg, 0.4), "--bubble-border": mix(bg, fg, 0.22),
    "--text": text, "--text-strong": text, "--text-dim": dim,
    "--accent": accent, "--accent-tint": tint(accent), "--primary": accent,
    "--primary-hover": mix(accent, bg, 0.08), "--primary-tint": tint(accent),
    "--primary-text": contrast(accent, "#000000") >= contrast(accent, "#ffffff") ? "#000000" : "#ffffff",
    "--status-idle": dim, "--status-working": working, "--status-blocked": blocked, "--status-done": done,
    "--status-working-tint": tint(working), "--status-blocked-tint": tint(blocked), "--status-done-tint": tint(done),
    "--danger-tint": tint(blocked), "--danger-text": blocked, "--notice": notice,
    "--indicator-working": notice, "--indicator-blocked": blocked, "--indicator-done": done,
    "--indicator-idle": done, "--indicator-unknown": dim,
    "--term-bg": bg, "--term-fg": text, "--term-cursor": accent, "--term-selection": row,
    "--syntax-keyword": readable(c.mauve ?? accent, surfaces), "--syntax-string": done,
    "--syntax-number": readable(c.peach ?? notice, surfaces), "--syntax-type": working,
    "--syntax-variable": text, "--syntax-meta": readable(c.teal ?? accent, surfaces),
  };
  return vars;
}

/** Remove the previous theme first so selecting web colors restores all of its original tokens. */
export function applyInstalledTheme(root: HTMLElement, theme: InstalledTheme | null): void {
  const previous = root.dataset["installedThemeTokens"]?.split(" ") ?? [];
  for (const key of previous) if (key.startsWith("--")) root.style.removeProperty(key);
  const vars = theme ? installedThemeTokens(theme) : {};
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset["installedThemeTokens"] = Object.keys(vars).join(" ");
}
