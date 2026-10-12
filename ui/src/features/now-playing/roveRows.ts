import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { rovedIndex } from "@/shared/lib/rove";

const ROW_STOP = "[data-row-stop]";
const ROW_BESIDE = "[data-row-beside]";

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function acrossRow(row: Element, key: string, from: EventTarget) {
	const face = row.querySelector<HTMLElement>(ROW_STOP);
	const beside = row.querySelector<HTMLElement>(ROW_BESIDE);
	if (key === "ArrowRight" && from === face) return beside;
	if (key === "ArrowLeft" && from === beside) return face;
	return null;
}

export function roveRows(
	event: ReactKeyboardEvent,
	list: HTMLUListElement | null,
) {
	if (!ARROWS.has(event.key) || !list) return;
	if (
		event.target instanceof HTMLElement &&
		event.target.getAttribute("role") === "slider"
	)
		return;
	event.stopPropagation();
	event.preventDefault();

	if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
		const row = [...list.children].find((held) =>
			held.contains(event.target as Node),
		);
		if (row) acrossRow(row, event.key, event.target)?.focus();
		return;
	}

	const stops = [...list.children].flatMap(
		(row) => row.querySelector<HTMLElement>(ROW_STOP) ?? [],
	);
	const at = stops.findIndex((stop) =>
		stop.closest("li")?.contains(event.target as Node),
	);
	const next = rovedIndex(event.key, at, stops.length, { wrap: true });
	if (next !== null) stops[next]?.focus();
}
