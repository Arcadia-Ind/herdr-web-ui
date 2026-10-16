import { existsSync } from "node:fs";

// Match CI's runner shell, including on macOS; use POSIX sh where bash is absent.
// Windows keeps herdr's native shell selection rather than receiving a Unix path.
export const testShellEnv = process.platform === "win32"
  ? {}
  : { SHELL: existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh" };
