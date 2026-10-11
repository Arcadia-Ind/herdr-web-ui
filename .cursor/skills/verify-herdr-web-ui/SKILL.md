# Verify herdr-web-ui Changes

This skill teaches agents how to prove that a code change works by building the app,
running it in test mode, driving it with Playwright, and capturing evidence.

## Prerequisites

Check that Bun is available:
```bash
bun --version  # requires 1.4+
```

Chromium is installed by the test harness on first run. If `CHROME_PATH` is unset,
the scripts use the lockfile's Playwright Chromium.

## 1. Build the application

```bash
cd /workspace
bun install
bun run build
```

This produces `dist/` which the browser scripts serve.

## 2. Run unit tests first

```bash
HERDR_TEST_MODE=unit bun run test:unit
```

Unit tests need no herdr and finish in seconds. Fix any failures before proceeding.

## 3. Browser verification with the demo harness

The repo provides isolated demo regression scripts that build the real client against
fictional fixtures — no live herdr session required. Use these to verify UI changes:

```bash
# Build the demo client once
HERDR_DEMO_BUILD="$(mktemp -d)"
bun scripts/demo-build.ts "$HERDR_DEMO_BUILD"

# Run a specific regression against demo fixtures
HERDR_DEMO_BUILD="$HERDR_DEMO_BUILD" bun scripts/settings-pages-demo-regression.ts
HERDR_DEMO_BUILD="$HERDR_DEMO_BUILD" bun scripts/composer-fit-demo-regression.ts
# etc.

# Clean up
rm -rf "$HERDR_DEMO_BUILD"
```

## 4. Full browser verification (requires herdr)

If herdr is installed and the change needs live terminal interaction:

```bash
# The ui-regression script runs against its own test session
bun run build
bun scripts/ui-regression.ts

# Stop the test session when done
herdr --session herdr-web-ui-test server stop
```

## 5. Capture evidence

### Screenshots
All browser scripts accept environment variables for evidence capture:

```bash
mkdir -p /tmp/evidence
UI_EVIDENCE_DIR=/tmp/evidence bun scripts/settings-pages-demo-regression.ts
```

Screenshots are saved to the evidence directory on failure.

### Console errors and network failures
The browser scripts monitor `page.on("pageerror")` and assert no errors at the end.
A failing script preserves the error list in its output.

### Performance traces
Enable Playwright traces for detailed debugging:

```bash
CHECK_BROWSER_EVIDENCE_TRACE=1 \
CHECK_BROWSER_EVIDENCE_DIR=/tmp/evidence \
  bun scripts/ui-regression.ts
```

Traces include screenshots and action logs but not DOM snapshots or network bodies.

## 6. Evidence summary template

After running verification, include this summary in your PR:

```markdown
## Verification

- `bun run typecheck`: pass
- `bun run build`: pass
- `bun run test:unit`: N pass, 0 fail
- Browser demo scripts:
  - `settings-pages-demo-regression.ts`: PASS
  - `composer-fit-demo-regression.ts`: PASS
- Screenshots: [attach if relevant]
- Console errors: none
```

## Script reference

| Script | What it tests | Requires herdr |
|--------|--------------|----------------|
| `scripts/demo-build.ts` | Builds demo client | No |
| `scripts/*-demo-regression.ts` | UI against demo fixtures | No |
| `scripts/ui-regression.ts` | Full app with owned panes | Yes |
| `scripts/*-browser-qa.ts` | Feature-specific QA | Yes |
| `scripts/file-viewer-mobile-regression.ts` | File viewer on phone viewports | No |
| `scripts/keyboard-viewport-regression.ts` | Keyboard and rotation | No |

## Feature map

See [feature-map.md](./feature-map.md) for stable selectors, routes, and shortcuts
to locate UI elements in browser tests.

## Common patterns

### Wait for element with data attribute
```typescript
await page.locator('.workspace-group[data-workspace="ws-id"]').waitFor();
```

### Check connection is live
```typescript
await page.locator(".conn-live").waitFor();
```

### Navigate to a pane
```typescript
await page.goto(`${origin}/?pane=${encodeURIComponent(paneId)}`);
```

### Open command palette
```typescript
await page.keyboard.press("ControlOrMeta+Shift+k");
await page.getByRole("dialog", { name: "Command palette" }).waitFor();
```

### Assert no page errors
```typescript
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
// ... test actions ...
assert.deepEqual(errors, [], "No page errors");
```
