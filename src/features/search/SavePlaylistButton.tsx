import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";
import type { FormEvent as ReactFormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import type { useScratchPlaylist } from "@/domain/library/useScratchPlaylist";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { createPlaylist } from "@/shared/api/beefweb";
import { plural } from "@/shared/lib/text";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Menu } from "@/shared/ui/Menu";
import styles from "./SavePlaylistButton.module.css";

// The one place Jean writes a playlist, and it takes an explicit click. How the tracks get across is the source's business.
// Reaching past the source for a playlist id fails silently: a ref only indexes its own source, so media-library refs read out of the autoplaylist take whatever sits at those positions in a differently ordered list.
export function SavePlaylistButton({
	search,
	library,
	scratch,
	holdsResults,
	isOpen,
	onOpenChange,
	onOpenPlaylist,
}: {
	search: LibrarySearch;
	library: Library;
	scratch: ReturnType<typeof useScratchPlaylist>;
	holdsResults: boolean;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onOpenPlaylist: (id: string) => void;
}) {
	const queryClient = useQueryClient();
	const [title, setTitle] = useState(search.query);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const { indices } = search.results;
	const trackCount = indices.length;

	// The title follows the search field until the dialog is opened, then stops moving under the cursor while it is being edited.
	useEffect(() => {
		if (!isOpen) setTitle(search.query);
	}, [isOpen, search.query]);

	useEffect(() => {
		if (isOpen) inputRef.current?.select();
	}, [isOpen]);

	const save = useMutation({
		mutationFn: async () => {
			const name = title.trim();

			// If playing these results already built a playlist of exactly them, renaming it saves it: playback carries on and the scratch stops being Jean's.
			if (holdsResults) {
				const id = await scratch.adopt(name);
				await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
				return { id, title: name };
			}

			const playlist = await createPlaylist(name);
			await library.source.addTo(playlist.id, indices);
			// Refetched rather than invalidated: the route that follows resolves against this list, and an id it has not seen yet lands on the old view.
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return playlist;
		},
		onSuccess: (playlist) => {
			// The results have somewhere permanent to live now, so the scratch is done.
			search.clear();
			onOpenChange(false);
			// A guard rather than a branch: `holdsResults` already rules this out, and navigating to a null id would be the worse failure.
			if (playlist.id) onOpenPlaylist(playlist.id);
		},
	});

	const submit = (event: ReactFormEvent) => {
		event.preventDefault();
		if (title.trim().length > 0 && !save.isPending) save.mutate();
	};

	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => onOpenChange(false)}
			align="start"
			trigger={
				<Button
					icon={ListPlus}
					aria-expanded={isOpen}
					// Saving a set that is still filling in would quietly write a fraction of the matches and look like the whole answer.
					disabled={trackCount === 0 || library.isLoading}
					title={library.isLoading ? "Still reading your library" : undefined}
					onClick={() => onOpenChange(!isOpen)}
				>
					Save as playlist
				</Button>
			}
		>
			<form className={styles.form} onSubmit={submit}>
				<label className={styles.label} htmlFor="save-search-title">
					New playlist from {plural(trackCount, "result")}
				</label>

				<Input
					size="md"
					id="save-search-title"
					inputRef={inputRef}
					className={styles.input}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Playlist name"
					aria-label="Playlist name"
					spellCheck="false"
					autoComplete="off"
					// The dialog exists to be typed in, and opens with the query in the field for editing.
					autoFocus
				/>

				{save.error ? (
					<p className={styles.error}>Could not save -- {save.error.message}</p>
				) : null}

				<div className={styles.actions}>
					<Button onClick={() => onOpenChange(false)}>Cancel</Button>
					<Button
						variant="primary"
						type="submit"
						disabled={title.trim().length === 0 || save.isPending}
					>
						{save.isPending ? "Saving..." : "Create"}
					</Button>
				</div>
			</form>
		</Menu>
	);
}
