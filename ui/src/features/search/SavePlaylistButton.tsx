import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";
import type { FormEvent as ReactFormEvent } from "react";
import { useEffect, useRef } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import type { useScratchPlaylist } from "@/domain/library/useScratchPlaylist";
import { PLAYLISTS_KEY } from "@/domain/player/usePlaylists";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { encodeFill } from "@/shared/api/fillEncoding";
import { createPlaylist } from "@/shared/api/playlists";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useResettingState } from "@/shared/hooks/useResettingState";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Menu } from "@/shared/ui/Menu";
import styles from "./SavePlaylistButton.module.css";

export function SavePlaylistButton({
	search,
	library,
	scratch,
	holdsResults,
	canWritePlaylists,
	isOpen,
	onOpenChange,
	onOpenPlaylist,
}: {
	search: LibrarySearch;
	library: Library;
	scratch: ReturnType<typeof useScratchPlaylist>;
	holdsResults: boolean;
	canWritePlaylists: boolean;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onOpenPlaylist: (id: string) => void;
}) {
	const t = useTranslate();
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const [title, setTitle] = useResettingState(search.query, [isOpen]);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const { indices } = search.results;
	const trackCount = indices.length;

	useEffect(() => {
		if (isOpen) inputRef.current?.select();
	}, [isOpen]);

	const save = useMutation({
		mutationFn: async () => {
			const name = title.trim();

			if (holdsResults) {
				const id = await scratch.adopt(name);
				await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
				return { id, title: name };
			}

			const origin = requireFooJean(discovery.origin);
			const playlist = orThrow(
				await createPlaylist(origin, {
					title: name,
					...encodeFill(indices, {
						structure: library.structure,
						trackCount: library.paths?.length ?? 0,
					}),
				}),
			);
			// Refetched rather than invalidated: the route that follows resolves against this list, and an id it has not
			// seen yet lands on the old view.
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return playlist;
		},
		onSuccess: (playlist) => {
			search.clear();
			onOpenChange(false);
			if (playlist.id) onOpenPlaylist(playlist.id);
		},
	});

	const submit = (event: ReactFormEvent) => {
		event.preventDefault();
		if (title.trim().length > 0 && !save.isPending) save.mutate();
	};

	if (!canWritePlaylists) return null;

	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => onOpenChange(false)}
			align="start"
			trigger={
				<Button
					icon={ListPlus}
					aria-expanded={isOpen}
					disabled={trackCount === 0 || library.isLoading}
					title={library.isLoading ? t("search.stillReading") : undefined}
					onClick={() => onOpenChange(!isOpen)}
				>
					{t("search.saveAsPlaylist")}
				</Button>
			}
		>
			<form className={styles.form} onSubmit={submit}>
				<label className={styles.label} htmlFor="save-search-title">
					{t("search.newPlaylistFrom", { count: trackCount })}
				</label>

				<Input
					size="md"
					id="save-search-title"
					inputRef={inputRef}
					className={styles.input}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder={t("playlist.name")}
					aria-label={t("playlist.name")}
					spellCheck="false"
					autoComplete="off"
					autoFocus
				/>

				{save.error ? (
					<p className={styles.error}>
						{t("search.saveFailed", { message: save.error.message })}
					</p>
				) : null}

				<div className={styles.actions}>
					<Button onClick={() => onOpenChange(false)}>
						{t("action.cancel")}
					</Button>
					<Button
						variant="primary"
						type="submit"
						disabled={title.trim().length === 0 || save.isPending}
					>
						{t(save.isPending ? "action.saving" : "action.create")}
					</Button>
				</div>
			</form>
		</Menu>
	);
}
