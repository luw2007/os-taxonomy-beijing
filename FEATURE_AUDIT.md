# Feature Audit — 3D 知识图谱

> Canonical tracking spreadsheet. Every feature extracted from code, tested, fixed, and re-tested.

## Phase 1+2: Feature Inventory & Test Results

| # | Feature | User Story | Status | Bug |
|---|---------|-----------|--------|-----|
| F01 | 3D graph loads | User opens page → 1590 nodes + 3221 links render as 3D force graph | ✅ PASS | |
| F02 | Loading indicator | User sees spinner + text while graph builds | ✅ PASS | |
| F03 | Loading hides | Spinner fades after init | ✅ PASS | |
| F04 | Node coloring | Each node colored by subject (8 colors) | ✅ PASS | |
| F05 | Node size | More central topics appear larger | ✅ PASS | |
| F06 | Dark background | Background is #0d1117 | ✅ PASS | |
| F07 | Node hover tooltip | Hovering shows name + subject + domain + age | ✅ FIXED | BUG-A |
| F08 | Node click → camera | Clicking node → camera flies to it | ✅ PASS | |
| F09 | Node click → highlight | Clicking highlights prereqs + dependents | ✅ FIXED | BUG-B |
| F10 | Node click → detail | Clicking opens right detail panel | ✅ PASS | |
| F11 | Detail: description | Panel shows topic description | ✅ PASS | |
| F12 | Detail: evidence | Panel shows mastery evidence checklist | ✅ PASS | |
| F13 | Detail: assessment | Panel shows assessment with {{name}}→孩子 | ✅ PASS | |
| F14 | Detail: prerequisites | Panel shows prerequisite topics | ✅ PASS | |
| F15 | Detail: dependents | Panel shows dependent topics | ✅ PASS | |
| F16 | Detail: standards | Panel shows curriculum standards | ✅ PASS | |
| F17 | Prereq click navigates | Clicking a prereq focuses that node | ✅ FIXED | BUG-C |
| F18 | Close detail | X button / ESC closes panel | ✅ PASS | |
| F19 | Subject filter | Clicking subject pill hides nodes | ✅ FIXED | BUG-D |
| F20 | Legend | Bottom-left color legend | ✅ PASS | |
| F21 | Search | Typing highlights matching nodes | ✅ FIXED | BUG-E |
| F22 | Search camera focus | Search flies to first match | ✅ PASS | |
| F23 | ESC clears all | ESC closes panel + search + highlight | ✅ PASS | |
| F24 | Responsive | Layout adapts to mobile | ✅ PASS | |
| F25 | Drag rotate | Drag to rotate 3D graph | ✅ PASS | |
| F26 | Zoom | Scroll to zoom | ✅ PASS | |
| F27 | CDN loads | 3d-force-graph from unpkg | ✅ PASS | |
| F28 | Empty evidence | 0-evidence topics omit evidence section | ✅ PASS | |
| F29 | Color refresh after change | Filters/highlights visually update | ✅ FIXED | BUG-G |
| F30 | Initial camera framing | Graph auto-frames on load | ✅ FIXED | BUG-H |

## Phase 2: Bugs Found

| Bug | Severity | Description | Root Cause | Fix |
|-----|----------|-------------|------------|-----|
| BUG-A | Medium | Tooltip appears at stale position on first hover | mousemove listener only fires on movement | showTooltip now takes pos param; lastHoverPos tracked |
| BUG-B | Low | highlightPath had dead `link.target === nodeId` check | 3d-force-graph mutates links to objects after init | Use `typeof link.source` check to handle both states |
| BUG-C | Medium | focusNodeById used stale nodeById map | Force sim mutates node objects (adds x/y/z) | Use graph.graphData().nodes directly |
| BUG-D | **High** | Hidden subjects still visible as dark dots + links | Only changed color, didn't remove from graph data | refreshGraphData() filters nodes+links, calls graph.graphData() |
| BUG-E | Low | No search result count; no 0-result feedback | Missing UX element | showSearchCount()/hideSearchCount() + "无匹配" text |
| BUG-F | Low | ESC clearing behavior minor issue | ClearHighlight now uses refresh() | Fixed by BUG-G fix |
| BUG-G | **Critical** | updateGraphColors() was a no-op — filters/highlights NEVER worked | `graph.nodeColor(graph.nodeColor())` doesn't trigger re-render | Replaced with `graph.refresh()` |
| BUG-H | Medium | No zoomToFit — graph may be off-center on load | Missing onEngineStop callback | Added `graph.onEngineStop(() => graph.zoomToFit(...))` |

## Phase 3: Fixes Applied

All 6 bug groups fixed in `viewer/app.js`, with supporting CSS for search count.

## Phase 4: Re-test Results

All 30 features PASS after fixes. E2E user journey (load → search → click → detail → navigate → filter → ESC) verified.
