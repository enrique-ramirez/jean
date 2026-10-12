import { useCallback, useState } from "react";

import {
	isPlayingRoute,
	type PanelTab,
	ROUTE,
	playingRoute as routeOfPanel,
} from "@/domain/track/routes";

export function useNowPlayingLayer(
	route: string,
	navigate: (to: string, options?: { replace?: boolean }) => void,
) {
	const isOpen = isPlayingRoute(route);
	const [hasOpened, setHasOpened] = useState(isOpen);
	if (isOpen && !hasOpened) setHasOpened(true);
	const [openedFrom, setOpenedFrom] = useState("");
	// `history.back()` is wrong: a reload can land straight on `#/playing` with no entry behind it, and back would leave Jean.
	if (!isOpen && openedFrom !== route) setOpenedFrom(route);
	const shellRoute = isOpen ? openedFrom : route;

	// Replaced rather than pushed: the panel behind a track is not somewhere the reader asked to
	// travel back through, and the track settling picks one on its own.
	const selectPanel = useCallback(
		(tab: PanelTab) => navigate(`/${routeOfPanel(tab)}`, { replace: true }),
		[navigate],
	);

	const close = useCallback(
		() => navigate(`/${openedFrom}`),
		[navigate, openedFrom],
	);

	const toggle = useCallback(
		() => (isOpen ? close() : navigate(`/${ROUTE.playing}`)),
		[isOpen, close, navigate],
	);

	return {
		isOpen,
		hasOpened,
		shellRoute,
		setOpenedFrom,
		selectPanel,
		close,
		toggle,
	};
}
