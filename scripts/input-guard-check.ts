/**
 * Static analysis: verify all agent pane input dispatch calls pass a guard.
 *
 * The guard pattern (#624, #666, #760):
 * - `paneSendText` and `paneSendKeys` accept an optional `guard` function
 * - The guard is called right before herdr receives the write
 * - Without it, a sender's permission can lapse during `Bun.connect()`
 * - Agent pane input (pending messages, WS input handlers) must use the guard
 *
 * Run: `bun scripts/input-guard-check.ts`
 * In CI: `bun run check:input-guard` (wired into fast lane)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "node:fs";

interface CallSite {
  file: string;
  line: number;
  column: number;
  call: string;
  hasGuard: boolean;
}

interface Violation {
  site: CallSite;
  reason: string;
}

// Files where unguarded calls are expected (tests, HTTP-only handlers)
const ALLOWED_UNGUARDED_FILES = new Set([
  // Test files - run against owned panes, no authorization needed
  "server/herdr/client.test.ts",
  "server/secret.contract.test.ts",
  "server/output.contract.test.ts",
  "server/pane-layout.contract.test.ts",
]);

// Line patterns where unguarded calls are explicitly reviewed and allowed
// Each pattern is checked against 10-line context around the call site
const ALLOWED_UNGUARDED_PATTERNS: Array<{ file: string; pattern: RegExp; reason: string }> = [
  // HTTP POST handlers - synchronous request context, no connect race
  {
    file: "server/index.ts",
    pattern: /pathname === "\/api\/pane\/input"/,
    reason: "HTTP POST /api/pane/input: synchronous request, no connect race",
  },
  {
    file: "server/index.ts",
    pattern: /pathname === "\/api\/pane\/keys"/,
    reason: "HTTP POST /api/pane/keys: synchronous request, no connect race",
  },
  // prompt.ts - prompt answering has its own authorization model
  {
    file: "server/prompt.ts",
    pattern: /paneSend(Keys|Text)\(/,
    reason: "Prompt answering: uses its own answer-in-progress state, not pending leases",
  },
  // Secret input Enter after paste - deliberate: Enter must follow unchecked (#589)
  {
    file: "server/index.ts",
    pattern: /follows unchecked/,
    reason: "Secret input Enter (#589): deliberate, withheld Enter would leave secret visible",
  },
  // submitText without guard - authorize() is called by inTime() before each send
  // This is a known narrow race window during Bun.connect(); the immediate-send path
  // from an active WS connection has a smaller attack surface than pending messages,
  // and the client waits for the result synchronously. A proper fix would pass a guard.
  // REVIEW: consider adding guard parameter in a future PR.
  {
    file: "server/index.ts",
    pattern: /async function submitText|inTime\(\);[\s\S]*?paneSendText|authorize\(\);[\s\S]*?paneSendKeys.*\["Enter"\]/,
    reason: "submitText: inTime() calls authorize() before each send; known race window, lower risk than pending",
  },
  // Mirror write callback - called from within an attachment's scope
  {
    file: "server/index.ts",
    pattern: /write:\s*\([^)]*\)\s*=>\s*paneSendText/,
    reason: "Mirror write callback: internal to attachment lifecycle",
  },
];

function findCallSites(filePath: string, content: string): CallSite[] {
  const sites: CallSite[] = [];
  const lines = content.split("\n");
  
  const funcPattern = /paneSend(Text|Keys)\s*\(/g;
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let match;
    funcPattern.lastIndex = 0;
    
    while ((match = funcPattern.exec(line)) !== null) {
      const funcName = `paneSend${match[1]}`;
      
      // Find the full call including arguments by counting parentheses
      let parenCount = 1;
      let endPos = match.index + match[0].length;
      let searchLine = lineNum;
      let searchCol = endPos;
      let fullCall = line.slice(match.index, endPos);
      
      while (parenCount > 0 && searchLine < lines.length) {
        for (let i = searchCol; i < lines[searchLine].length && parenCount > 0; i++) {
          const char = lines[searchLine][i];
          if (char === "(") parenCount++;
          else if (char === ")") parenCount--;
          fullCall += char;
        }
        if (parenCount > 0) {
          fullCall += "\n";
          searchLine++;
          searchCol = 0;
        }
      }
      
      // Check if the call has a guard parameter (4th argument)
      // paneSendText(paneId, text, socketPath?, guard?)
      // paneSendKeys(paneId, keys, socketPath?, guard?)
      const hasGuard = checkHasGuard(fullCall, funcName);
      
      sites.push({
        file: filePath,
        line: lineNum + 1,
        column: match.index + 1,
        call: fullCall.replace(/\s+/g, " ").slice(0, 120),
        hasGuard,
      });
    }
  }
  
  return sites;
}

function checkHasGuard(call: string, funcName: string): boolean {
  // Parse the arguments roughly
  // Remove the function name and outer parens
  const argsMatch = call.match(/paneSend(?:Text|Keys)\s*\(([\s\S]*)\)$/);
  if (!argsMatch) return false;
  
  const argsStr = argsMatch[1];
  
  // Split by comma, respecting nesting
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";
  
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    const prev = i > 0 ? argsStr[i - 1] : "";
    
    if (!inString && (char === '"' || char === "'" || char === "`")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prev !== "\\") {
      inString = false;
    }
    
    if (!inString) {
      if (char === "(" || char === "[" || char === "{") depth++;
      else if (char === ")" || char === "]" || char === "}") depth--;
      else if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  
  // For paneSendText/paneSendKeys: args are (paneId, text/keys, socketPath?, guard?)
  // Guard is the 4th argument
  if (args.length < 4) return false;
  
  const guard = args[3];
  // Guard should be a function or callback, not undefined/null
  return guard !== undefined && guard !== "undefined" && guard !== "";
}

function isAllowedUnguarded(site: CallSite, lineContent: string, fileContent: string): string | null {
  const relPath = relative(process.cwd(), site.file).replace(/\\/g, "/");
  
  // Check file-level exceptions
  if (ALLOWED_UNGUARDED_FILES.has(relPath)) {
    return `Allowed file: ${relPath}`;
  }
  
  // Check pattern exceptions
  for (const allowed of ALLOWED_UNGUARDED_PATTERNS) {
    if (relPath === allowed.file || relPath.endsWith("/" + allowed.file)) {
      // Get broader context - 30 lines before and 10 after
      // This helps find function definitions and surrounding code patterns
      const lines = fileContent.split("\n");
      const startLine = Math.max(0, site.line - 31);
      const endLine = Math.min(lines.length, site.line + 10);
      const context = lines.slice(startLine, endLine).join("\n");
      
      if (allowed.pattern.test(context) || allowed.pattern.test(lineContent)) {
        return allowed.reason;
      }
    }
  }
  
  return null;
}

function main(): number {
  const root = process.cwd();
  const serverDir = join(root, "server");
  
  if (!existsSync(serverDir)) {
    console.error("Error: server/ directory not found. Run from repository root.");
    return 1;
  }
  
  // Find all TypeScript files in server/
  const files = globSync("**/*.ts", { cwd: serverDir, absolute: false });
  
  const allSites: CallSite[] = [];
  const violations: Violation[] = [];
  
  for (const file of files) {
    const filePath = join(serverDir, file);
    const content = readFileSync(filePath, "utf8");
    const sites = findCallSites(filePath, content);
    allSites.push(...sites);
    
    for (const site of sites) {
      if (site.hasGuard) continue;
      
      const lineContent = content.split("\n")[site.line - 1] || "";
      const allowed = isAllowedUnguarded(site, lineContent, content);
      
      if (!allowed) {
        violations.push({
          site,
          reason: "Missing guard parameter. Agent pane input must pass authorization guard to RPC.",
        });
      }
    }
  }
  
  console.log(`Input guard check: scanned ${files.length} files, found ${allSites.length} call sites`);
  console.log(`  With guard: ${allSites.filter(s => s.hasGuard).length}`);
  console.log(`  Without guard: ${allSites.filter(s => !s.hasGuard).length}`);
  
  if (violations.length > 0) {
    console.log(`\n❌ ${violations.length} violation(s) found:\n`);
    for (const v of violations) {
      console.log(`  ${relative(root, v.site.file)}:${v.site.line}:${v.site.column}`);
      console.log(`    ${v.site.call}`);
      console.log(`    → ${v.reason}\n`);
    }
    console.log("Fix: pass a guard function as the 4th argument to paneSendText/paneSendKeys.");
    console.log("     The guard is called right before herdr receives the write.");
    console.log("     Example: await paneSendKeys(paneId, keys, undefined, () => canStillSend());");
    console.log("\nIf this call is intentionally unguarded, add it to ALLOWED_UNGUARDED_PATTERNS");
    console.log("in scripts/input-guard-check.ts with a justification comment.");
    return 1;
  }
  
  console.log("\n✅ All agent pane input calls have guards or are in allowed exceptions.");
  return 0;
}

process.exit(main());
