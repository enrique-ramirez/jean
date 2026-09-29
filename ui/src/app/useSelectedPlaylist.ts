import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PlaylistInfo } from "@/shared/api/types";
import type { RouteView } from "./routes";

const listed = (browsable: PlaylistInfo[], id: string | null | undefined) =>
	id && browsable.some((entry) => entry.id === id) ? id : null;

export function useSelectedPlaylist({
	route,
	view,
	isLayered,
	browsable,
	playingPlaylistId,
	navigate,
}: {
	route: string;
	view: RouteView;
	isLayered: boolean;
	browsable: PlaylistInfo[];
	playingPlaylistId: string | null | undefined;
	navigate: (to: string, options?: { replace?: boolean }) => void;
}) {
	const routedId = listed(browsable, route);

	const lastPlaylistId = useRef<string | null>(null);
	useEffect(() => {
		if (routedId) lastPlaylistId.current = routedId;
	}, [routedId]);

	const remember = useCallback((id: string) => {
		lastPlaylistId.current = id;
	}, []);

	const selectedId =
		routedId ??
		listed(browsable, lastPlaylistId.current) ??
		listed(browsable, playingPlaylistId) ??
		browsable[0]?.id;

	const playlist = useMemo(
		() => browsable.find((entry) => entry.id === selectedId) ?? null,
		[browsable, selectedId],
	);

	const routeNamesAVanishedPlaylist =
		!isLayered &&
		view.kind === "playlist" &&
		!routedId &&
		route === lastPlaylistId.current;

	useEffect(() => {
		if (!routeNamesAVanishedPlaylist || !selectedId) return;
		navigate(`/${selectedId}`, { replace: true });
	}, [routeNamesAVanishedPlaylist, selectedId, navigate]);

	return { selectedId, playlist, remember };
}
