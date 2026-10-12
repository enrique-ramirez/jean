import { Suspense, useMemo } from "react";

import type { Library } from "@/domain/library/useLibrary";
import { ROUTE } from "@/domain/track/routes";
import type { PlaylistInfo } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import {
	AutoPlaylistDialog,
	CommandPalette,
	SettingsDialog,
	ShortcutSheet,
} from "./lazyLayers";
import type { PlayingRoute } from "./routes";
import type { useModals } from "./useModals";

function usePaletteEntries(
	browsable: PlaylistInfo[],
	playingFrom: PlayingRoute | null,
) {
	const t = useTranslate();

	const playlists = useMemo(
		() =>
			browsable.map((playlist) => ({
				route: playlist.id,
				title: playlist.title,
				count: playlist.itemCount,
			})),
		[browsable],
	);

	const views = useMemo(
		() => [
			...(playingFrom?.temporaryRow
				? [{ route: playingFrom.route, title: playingFrom.name }]
				: []),
			{ route: ROUTE.all, title: t("library.allMusic") },
		],
		[playingFrom, t],
	);

	return { views, playlists };
}

export function ShellModals({
	modals,
	browsable,
	playingFrom,
	library,
	editedAutoPlaylist,
	onOpenFromPalette,
	onOpenPlaylist,
	onAutoPlaylistDismissed,
}: {
	modals: ReturnType<typeof useModals>;
	browsable: PlaylistInfo[];
	playingFrom: PlayingRoute | null;
	library: Library;
	editedAutoPlaylist: PlaylistInfo | null;
	onOpenFromPalette: (route: string) => void;
	onOpenPlaylist: (id: string) => void;
	onAutoPlaylistDismissed: () => void;
}) {
	const palette = usePaletteEntries(browsable, playingFrom);

	return (
		<>
			{modals.isOpen.palette ? (
				<Suspense fallback={null}>
					<CommandPalette
						views={palette.views}
						playlists={palette.playlists}
						onSelect={onOpenFromPalette}
						onDismiss={() => modals.close("palette")}
					/>
				</Suspense>
			) : null}

			{modals.isOpen.shortcuts ? (
				<Suspense fallback={null}>
					<ShortcutSheet onDismiss={() => modals.close("shortcuts")} />
				</Suspense>
			) : null}

			{modals.isOpen.settings ? (
				<Suspense fallback={null}>
					<SettingsDialog onDismiss={() => modals.close("settings")} />
				</Suspense>
			) : null}

			{modals.isOpen.autoplaylist ? (
				<Suspense fallback={null}>
					<AutoPlaylistDialog
						library={library}
						editing={editedAutoPlaylist ?? undefined}
						onOpenPlaylist={onOpenPlaylist}
						onDismiss={() => {
							modals.close("autoplaylist");
							onAutoPlaylistDismissed();
						}}
					/>
				</Suspense>
			) : null}
		</>
	);
}
