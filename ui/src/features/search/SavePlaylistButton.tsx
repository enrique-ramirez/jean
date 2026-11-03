import { ListPlus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import type { useScratchPlaylist } from "@/domain/library/useScratchPlaylist";
import { NewPlaylistForm } from "@/domain/player/NewPlaylistForm";
import { useMakePlaylist } from "@/domain/player/usePlaylistActions";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { encodeFill } from "@/shared/api/fillEncoding";
import { createPlaylist } from "@/shared/api/playlists";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useResettingState } from "@/shared/hooks/useResettingState";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Menu } from "@/shared/ui/Menu";

export function SavePlaylistButton({
	search,
	library,
	scratch,
	holdsResults,
	canSave,
	isOpen,
	onOpenChange,
	onOpenPlaylist,
}: {
	search: LibrarySearch;
	library: Library;
	scratch: ReturnType<typeof useScratchPlaylist>;
	holdsResults: boolean;
	canSave: boolean;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onOpenPlaylist: (id: string) => void;
}) {
	const t = useTranslate();
	const { discovery } = useFooJean();
	const [title, setTitle] = useResettingState(search.query, [isOpen]);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const { indices } = search.results;
	const trackCount = indices.length;

	useEffect(() => {
		if (isOpen) inputRef.current?.select();
	}, [isOpen]);

	const save = useMakePlaylist(
		async () => {
			const name = title.trim();
			if (holdsResults) return { id: await scratch.adopt(name), title: name };

			const origin = requireFooJean(discovery.origin);
			return orThrow(
				await createPlaylist(origin, {
					title: name,
					...encodeFill(indices, {
						structure: library.structure,
						trackCount: library.trackCount,
					}),
				}),
			);
		},
		(playlist) => {
			search.clear();
			onOpenChange(false);
			if (playlist.id) onOpenPlaylist(playlist.id);
		},
	);

	if (!canSave) return null;

	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => onOpenChange(false)}
			align="start"
			trigger={
				<Button
					icon={ListPlus}
					aria-expanded={isOpen}
					disabled={trackCount === 0}
					onClick={() => onOpenChange(!isOpen)}
				>
					{t("search.saveAsPlaylist")}
				</Button>
			}
		>
			<NewPlaylistForm
				label={t("search.newPlaylistFrom", { count: trackCount })}
				title={title}
				onTitleChange={setTitle}
				inputRef={inputRef}
				error={
					save.error
						? t("search.saveFailed", { message: save.error.message })
						: null
				}
				isPending={save.isPending}
				pendingLabel={t("action.saving")}
				onSubmit={() => save.mutate()}
				onCancel={() => onOpenChange(false)}
			/>
		</Menu>
	);
}
