import { useLayoutEffect, useState } from "react";
import { useDismissable } from "@/shared/hooks/useDismissable";
import type { Point } from "@/shared/hooks/useLongPress";
import styles from "./ActionMenu.module.css";
import { Header, type PanelProps, usePanel } from "./actionPanel";
import { useFocusCapture } from "./menuKeys";

const EDGE_MARGIN = 8;

export function ActionPopover({
	anchor,
	header,
	actions,
	onDismiss,
}: PanelProps & { anchor: Point }) {
	const { body, onKeyDown, page, depth, back } = usePanel({
		actions,
		onDismiss,
		canFilter: true,
		focusFilter: true,
	});
	const ref = useDismissable<HTMLDivElement>(true, onDismiss);
	const [placement, setPlacement] = useState<{
		left: number;
		top: number;
		maxHeight: number;
		origin: string;
	} | null>(null);

	// Measured once, on open: recomputing as a nested page changes height would slide the menu out
	// from under the pointer, and `maxHeight` absorbs the overflow.
	useLayoutEffect(() => {
		const { width, height } = (
			ref.current as HTMLDivElement
		).getBoundingClientRect();
		const room = { x: window.innerWidth, y: window.innerHeight };

		const flipX = anchor.x + width > room.x - EDGE_MARGIN;
		const flipY = anchor.y + height > room.y - EDGE_MARGIN;
		const left = flipX ? Math.max(EDGE_MARGIN, anchor.x - width) : anchor.x;
		const top = flipY ? Math.max(EDGE_MARGIN, anchor.y - height) : anchor.y;

		setPlacement({
			left,
			top,
			maxHeight: room.y - top - EDGE_MARGIN,
			origin: `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}`,
		});
	}, [anchor, ref]);

	useFocusCapture(ref, placement !== null, '[aria-checked="true"]');

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the panel takes the keyboard for the whole menu, see menuKeys.ts
		<div
			ref={ref}
			className={styles.popover}
			data-placed={placement ? "true" : undefined}
			style={
				placement
					? {
							left: placement.left,
							top: placement.top,
							maxHeight: placement.maxHeight,
							transformOrigin: placement.origin,
						}
					: undefined
			}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			<Header header={header} page={page} depth={depth} onBack={back} />
			{body}
		</div>
	);
}
