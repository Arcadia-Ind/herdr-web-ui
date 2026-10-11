/**
 * Tests for the input guard static analysis.
 * 
 * Run: HERDR_TEST_MODE=unit bun test ./scripts/input-guard-check.test.ts
 */
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const createFixtureDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "input-guard-test-"));
  mkdirSync(join(dir, "server"));
  return dir;
};

const runCheck = (cwd: string): { code: number; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/input-guard-check.ts")], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

describe("input-guard-check", () => {
  let fixtureDir: string;

  afterEach(() => {
    if (fixtureDir) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("passes when all paneSendKeys/paneSendText calls have guards", () => {
    fixtureDir = createFixtureDir();
    writeFileSync(join(fixtureDir, "server/handler.ts"), `
      import { paneSendKeys, paneSendText } from "./herdr/client.ts";
      
      async function sendWithGuard(paneId: string) {
        const guard = () => checkPermission();
        await paneSendText(paneId, "hello", undefined, guard);
        await paneSendKeys(paneId, ["Enter"], undefined, () => stillAllowed());
      }
    `);
    
    const result = runCheck(fixtureDir);
    expect(result.stdout).toContain("All agent pane input calls have guards");
    expect(result.code).toBe(0);
  });

  it("fails when paneSendText is called without a guard", () => {
    fixtureDir = createFixtureDir();
    writeFileSync(join(fixtureDir, "server/bad-handler.ts"), `
      import { paneSendText } from "./herdr/client.ts";
      
      async function sendWithoutGuard(paneId: string) {
        // This is wrong: no guard means the authorization can lapse during Bun.connect()
        await paneSendText(paneId, "hello");
      }
    `);
    
    const result = runCheck(fixtureDir);
    expect(result.stdout).toContain("violation(s) found");
    expect(result.stdout).toContain("paneSendText(paneId, \"hello\")");
    expect(result.code).toBe(1);
  });

  it("fails when paneSendKeys is called without a guard", () => {
    fixtureDir = createFixtureDir();
    writeFileSync(join(fixtureDir, "server/bad-keys.ts"), `
      import { paneSendKeys } from "./herdr/client.ts";
      
      async function sendKeysWithoutGuard(paneId: string) {
        // Missing guard - security vulnerability
        await paneSendKeys(paneId, ["ctrl+c"]);
      }
    `);
    
    const result = runCheck(fixtureDir);
    expect(result.stdout).toContain("violation(s) found");
    expect(result.stdout).toContain("paneSendKeys(paneId, [\"ctrl+c\"])");
    expect(result.code).toBe(1);
  });

  it("allows unguarded calls in test files", () => {
    fixtureDir = createFixtureDir();
    // Create the test file in the allowed list
    mkdirSync(join(fixtureDir, "server/herdr"));
    writeFileSync(join(fixtureDir, "server/herdr/client.test.ts"), `
      import { paneSendText } from "./client.ts";
      
      it("sends text in a test", async () => {
        // Tests are allowed to skip guards - they run against owned panes
        await paneSendText(paneId, "test input");
      });
    `);
    
    const result = runCheck(fixtureDir);
    expect(result.stdout).toContain("All agent pane input calls have guards");
    expect(result.code).toBe(0);
  });

  it("reports the file and line number of violations", () => {
    fixtureDir = createFixtureDir();
    writeFileSync(join(fixtureDir, "server/somewhere.ts"), `
      // Line 1
      // Line 2
      import { paneSendText } from "./herdr/client.ts";
      // Line 4
      async function problem() {
        await paneSendText(paneId, "bad");
      }
    `);
    
    const result = runCheck(fixtureDir);
    expect(result.stdout).toContain("server/somewhere.ts:");
    expect(result.stdout).toContain("paneSendText(paneId, \"bad\")");
    expect(result.code).toBe(1);
  });
});
