### Fixed
- Refuse explorer grants inside private configuration, including canonical aliases, while retaining
  registered Herdr worktrees and the existing private-child boundaries.
- Let registered installed-app bridges read cached usage with their own credential. Keep refresh,
  account controls, cross-site reads, browser cookies, and writes outside this permission.
