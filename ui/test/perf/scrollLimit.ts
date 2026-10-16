// Serialised into the page by Playwright, like `pageProbes.ts`.

// The tallest an element can be made before the engine stops honouring it: Chromium clamps to its
// limit, Firefox ignores a height past its own. Found by bisection on what `scrollHeight` reads
// back, so it is whatever this browser build does.
export function honouredHeight(): number {
	const scroller = document.createElement("div");
	scroller.style.cssText =
		"position:fixed;top:0;left:0;width:100px;height:100px;overflow:auto;visibility:hidden";
	const spacer = document.createElement("div");
	spacer.style.width = "1px";
	scroller.append(spacer);
	document.body.append(scroller);

	// Chromium reads some heights past 2^24 px back a pixel or two short.
	const ROUNDING_PX = 4;
	const honours = (height: number) => {
		spacer.style.height = `${height}px`;
		return scroller.scrollHeight >= height - ROUNDING_PX;
	};

	let honoured = 1_000_000;
	let refused = 2 ** 31;
	while (refused - honoured > 1) {
		const middle = Math.floor((honoured + refused) / 2);
		if (honours(middle)) honoured = middle;
		else refused = middle;
	}
	scroller.remove();
	return honoured;
}

export interface ListEnd {
	rowCount: number;
	lastRendered: number;
	rowHeight: number;
	scrollHeight: number;
}

export async function scrollListToEnd(): Promise<ListEnd | null> {
	const grid = document.querySelector<HTMLElement>('[role="grid"]');
	const scroller = grid?.closest<HTMLElement>("[data-drop-scroller]");
	if (!grid || !scroller) return null;

	scroller.scrollTop = scroller.scrollHeight;
	await new Promise((resolve) => setTimeout(resolve, 500));
	const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")];
	return {
		rowCount: Number(grid.getAttribute("aria-rowcount")),
		lastRendered: Math.max(...rows.map((row) => Number(row.dataset.row))),
		rowHeight: rows[0]?.offsetHeight ?? 0,
		scrollHeight: scroller.scrollHeight,
	};
}

export function scrollListToStart() {
	const grid = document.querySelector('[role="grid"]');
	const scroller = grid?.closest("[data-drop-scroller]");
	if (scroller) scroller.scrollTop = 0;
}
