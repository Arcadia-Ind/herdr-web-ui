### Fixed
- The header's connection chip, the chat's footer and the terminal's banner say "Connecting" until this
  page has connected to the PC once, and "Reconnecting" only after a connection dropped; before, every
  wait read as a reconnect, a fresh page's first one included.
