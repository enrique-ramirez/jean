# The site

The page a stranger lands on, published at the root of GitHub Pages with the demo one level down at `demo/`. `demo/CLAUDE.md` is the player behind every frame on it.

**Its words are `README.md`.** The build slices the file on `<!-- site:name -->` markers, renders the markdown with `marked`, and drops each piece into a slot in `index.html`. Nothing rendered onto the page restates a claim the README makes, and a region that goes missing fails both the build and `test/unit/site.test.ts` rather than quietly leaving a hole in the page. What the page adds is the words a README has no place for: a headline, a caption under each frame, the name of the screen a frame opens on. The one exception is `<meta name="description">` and the Open Graph tags in `index.html`, hand-written rather than sliced from the README: a search result and a link preview take plain text at a fixed length, not a paragraph with a markdown link in it.

A region that a section is built out of opens with its own `###` heading, and `part()` takes the heading and the words under it as one thing. They stay together in the README so that neither can be rewritten without the other, and the page sets the heading at its own size.

`readme.ts` renders a whole region with `marked.parse`, which is the only call that reproduces a table or a fenced code block as itself; a run of markdown short enough to sit inside a paragraph the page already opened goes through `marked.parseInline` instead, since block rendering would wrap it in a `<p>` of its own.

The page is English, since the README is, and the phrase catalogue is the app's rather than the site's.

## Frames

Each is the demo in an iframe, opened at a hash route. `embeds.ts` holds the hero and an ordered `SECTIONS`, one per region, each naming its shape and the frames it draws. Every frame carries a distinct `title`: a screen reader reaches an iframe as a document of its own, and a page with several of them needs a name for each.

**They are all the same player.** One origin and one service worker share one player state across every frame, so a track started in one is already playing in the others: the fake's `subscribe` hands out a stream per frame. That is the page's one idea and the reason the frames are live rather than screenshots.

A frame keeps its own `localStorage` all the same, isolated in `demo/embed.ts`. Settings are read once, when Jean mounts, so two frames mounting at once MUST NOT share a store: one would read the other's between the write and the render.

An iframe's width is what Jean's own breakpoint reads, so a frame 392px wide draws the phone layout on a desktop. The shapes in `embeds.ts` are chosen for that, not for the page's rhythm alone.

**Frames are `inert` until somebody clicks one.** A tap that reaches an app inside an iframe is a tap the page cannot scroll with, and the tab key walks into a whole application and does not come back. Clicking anywhere on a frame takes it; clicking off it hands the keyboard back. Escape inside it does the same, when Jean has nothing of its own to dismiss, and only reaches out because every frame is same origin: a cross-origin iframe's `contentDocument` is null and there would be nothing to attach the listener to.

A frame that draws a screen the route cannot reach asks the demo for it. `focus: "search"` is the only one: Jean opens its results when the search field holds something and has focus, and focus is not a route. `demo/embed.ts` does the focusing, after the app has drawn.

## The comparison

Two frames at the same size, one clipped by `clip-path` at `--split`, so the reader sees the same screen in both themes with the join running through the artwork. It opens at phone width, where the screen fills the frame and the split cuts through something; at desktop width the now-playing screen leaves the right half of the frame empty and the comparison shows nothing.

The dragging is a range input lying over both frames, which brings the pointer and the arrow keys, and gives it a name a screen reader can read. The line and its knob are drawn separately and take no pointer events. Vertical gestures stay with the page, or the slider would eat the scroll on a phone.

Neither half is ever taken, so both stay `inert` for good.

## Building it

`pnpm site` writes `dist-site/`, then calls the demo build into `dist-site/demo`. `pnpm site:preview` serves the result on 8124, which is not the dev server's port. The faces come from `src/shared/styles/fonts.css`, the same files the app bundles, rather than a second copy or a font host.
