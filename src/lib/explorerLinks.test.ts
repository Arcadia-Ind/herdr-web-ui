import { expect, it } from "bun:test";
import { explorerLinkedPath } from "./explorerLinks.ts";

it("resolves relative document links through the workspace root", () => {
  expect(explorerLinkedPath("docs/README.md", "../software/src/tool.py")).toBe("software/src/tool.py");
  expect(explorerLinkedPath("software/pseudocode/pkg/unit.py.md", "../../../src/pkg/unit.py#L5")).toBe("src/pkg/unit.py");
  expect(explorerLinkedPath("README.md", "docs/A%20file.md")).toBe("docs/A file.md");
});

it("refuses root escapes, external addresses, encoded roots, and invalid path bytes", () => {
  for (const href of ["../../etc/passwd", "/etc/passwd", "%2Fetc/passwd", "https://example.com/a", "file:///etc/passwd", "../%2e%2e/etc", "\\host\\file", "C:/secret", "%00x", "#heading", "%zz"]) {
    expect(explorerLinkedPath("docs/README.md", href)).toBeNull();
  }
});
