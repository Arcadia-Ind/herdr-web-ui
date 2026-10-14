### Fixed
- A tab that opens a busy pane late (a phone or tablet coming back to a pane another tab holds) shows
  the whole screen again. It got only the last part of the pane's output, so the prompt and the
  status line under a working agent stayed blank until something redrew them.
  ([#1018](https://github.com/devswha/herdr-web-ui/pull/1018), [#939](https://github.com/devswha/herdr-web-ui/pull/939) by @Noobear)
