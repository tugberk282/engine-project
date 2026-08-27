# Headless editor interaction gate

Run the bounded fake-backed DOM gate with:

```powershell
npm run test:editor-headless
```

This lane runs in Node, uses deterministic bridge, filesystem, clock, renderer, and DOM fakes, and does not launch Electron. It verifies observable DOM, focus, ARIA state, typed drag data, and dispatched view events for the menu, Hierarchy, Project, Inspector, Console, docking, and launcher failure paths.

`npm run test:editor-workflow` remains the expanded rendered Electron smoke. It is useful evidence for a Chromium-rendered development build, but it does not claim OS-native input, packaged behavior, or accessibility parity. Those qualifications remain separate rendered/packaged gates.
