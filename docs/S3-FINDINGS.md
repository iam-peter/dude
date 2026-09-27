# S3 — Graph renderer: findings

Status: **spike, 2026-09-27; waiting for a verdict on real sessions.** Chromium 151 (Chrome
for Testing, headless); Firefox not tried yet. Compared on the sessions page, where a
*Classic / Flow* switch next to the view modes swaps the renderer on the same data
(`src/ui/flow/`). Candidates per SPEC §8.3: Svelte Flow, Cytoscape.js, D3 + d3-dag.

## Choice of candidate

Svelte Flow (`@xyflow/svelte` 1.7, MIT) was the only one tried. Its nodes are Svelte
components, so the screenshot cards stay HTML, and it brings pan/zoom, a minimap, fit
view and draggable nodes. Cytoscape.js draws nodes as styled canvas shapes, which suits
screenshot cards with titles poorly; D3 + d3-dag would replace little of what exists.
Neither has a layout engine better than ELK, which stays in all cases.

## Findings

1. **The layout problem was ELK's input, not the renderer.** Classic let ELK route only
   the tree edges and drew Back/Forward and same-page links afterwards as arcs, which
   cut through cards. With every link given to ELK (`layoutGraph(…, { routeAll: true })`)
   all lines go around the cards. The extra links take part in the layering, which moves
   some cards (e.g. a revisited page lands lower), but nothing overlaps. This works
   with either renderer.
2. **Edge labels sat on the arrowheads**: the label point was an ELK control point near
   the end. It is now the middle of the curve (`midpoint` in `graph-layout.ts`), for both
   renderers.
3. **Svelte Flow works as a drop-in** behind the same `View`: cards as custom nodes,
   links as custom edges that draw ELK's route. Click selects (Flow tells it from a
   drag), double-click opens, the splitter sets its height, the legend is unchanged.
4. **Dragging and "Tidy up" work**: moved cards are kept per session and view in
   localStorage and survive reloads. Lines of a moved card fall back to a plain curve
   (ELK's route no longer fits); *Tidy up* forgets the moves and lays out again.
5. **Cost:** the sessions page grows from 94 kB to 288 kB (JS + CSS; gzip JS 27 → 82 kB).
   It is loaded from disk, not the network, so this mostly costs parse time.
6. **Minimap** helps on long sessions but covers part of the graph; at 150 × 84 px it is
   acceptable in a 500 px tall graph.
7. **Busy sessions tangled** (user report): cards too close, several lines meeting at one
   point of a card, spline curves bundling. Tried on a recorded tangle of 27 visits over
   four pages: more spacing alone helps little; **orthogonal routing** gives every link
   its own lane and its own point on the card side and reads best. Routing links that
   go back around the whole graph (`elk.layered.feedbackEdges`) makes big loops and more
   crossings, with splines as well as orthogonal. → Orthogonal with wider spacing is now
   the default, for both renderers; corners are rounded (`roundedPath`).
8. **Fitting a long session into view makes the cards unreadable.** Flow now starts at a
   readable zoom around the current page (about two steps either side), like Classic;
   the ⛶ button still fits everything.

## Open

- Try it on long real sessions (e.g. a heise reading session with many branches), in both
  browsers, and decide: Flow for all three views, Flow for the network only, or Classic
  with `routeAll` (finding 1) and no new dependency.
- If Flow stays: its own keyboard navigation between cards, and whether the sidebar's
  network view should use it too.
