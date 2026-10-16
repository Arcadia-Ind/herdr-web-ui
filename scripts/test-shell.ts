import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Match CI's runner shell, including on macOS; use POSIX sh where bash is absent.
// Windows keeps herdr's native shell selection rather than receiving a Unix path.
export function testShellEnv(dir: string): Record<string, string> {
  if (process.platform === "win32") return {};
  if (!existsSync("/bin/bash")) return { SHELL: "/bin/sh" };
  mkdirSync(dir, { recursive: true });
  const shell = join(dir, "test-bash");
  // Keep the long options before herdr's flags, including -l. Noninteractive bash also
  // reads BASH_ENV unless it is unset; none of the user's startup files belong in a pane.
  writeFileSync(shell, '#!/bin/sh\nunset BASH_ENV ENV\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 });
  chmodSync(shell, 0o700);
  return { SHELL: shell };
}
