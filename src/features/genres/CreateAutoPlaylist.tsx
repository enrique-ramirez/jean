import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { FormEvent as ReactFormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { genreQuery } from "@/domain/library/genreQuery";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { createAutoPlaylist, previewQuery } from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { plural } from "@/shared/lib/text";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Menu } from "@/shared/ui/Menu";
import styles from "./CreateAutoPlaylist.module.css";

// The preview runs on foobar2000's main thread, so it is asked once the dialog opens and not again:
// the query is derived from the genre and does not change while somebody edits the *name*.
export function CreateAutoPlaylist({
	genre,
	onOpenPlaylist,
}: {
	genre: string;
	onOpenPlaylist: (id: string) => void;
}) {
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const { origin, token, state } = discovery;
	// `capabilities` exist only once the component is paired and answering, which is the same condition
	// this button needs anyway.
	const canCreate =
		state.kind === "ready" && state.capabilities.canCreateAutoPlaylists;

	const [isOpen, setIsOpen] = useState(false);
	const [title, setTitle] = useState(genre);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const query = genreQuery(genre);

	// The name follows the genre until the dialog is opened, then stops moving under the cursor.
	useEffect(() => {
		if (!isOpen) setTitle(genre);
	}, [isOpen, genre]);

	// Through react-query rather than an effect, and the reason is the component's own advice: the
	// preview runs on foobar2000's main thread, so one request per keystroke is one main-thread
	// callback per keystroke. A bare effect fires twice per open under StrictMode and again on every
	// reopen; keyed on the query, this asks once and remembers the answer.
	const { data: preview } = useQuery({
		queryKey: ["fooJeanPreview", origin, query],
		queryFn: () =>
			origin && token ? previewQuery(origin, token, query) : null,
		enabled: isOpen && Boolean(origin && token),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	const create = useMutation({
		mutationFn: async () => {
			if (!origin || !token) throw new Error("foo_jean is not reachable.");
			// No `key`. A key would make this Jean's to recognise and manage, and a genre autoplaylist is
			// the user's music -- theirs to rename, keep or delete. It also 409s on the second one, which
			// would refuse a perfectly reasonable request.
			const made = await createAutoPlaylist(origin, token, {
				title: title.trim(),
				query,
			});
			if (!made.ok) throw new Error(made.message);

			// Refetched rather than invalidated: the route that follows resolves against this list, and
			// beefweb assigns its id lazily -- asking is what makes it look.
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return made.playlist;
		},
		onSuccess: (playlist) => {
			setIsOpen(false);
			if (playlist.beefwebId) onOpenPlaylist(playlist.beefwebId);
		},
	});

	// Absent rather than disabled: without the component this is not a thing Jean can do, and a dead
	// button explaining a component somebody has not installed is worse than no button.
	if (!origin || !token || !canCreate) return null;

	const submit = (event: ReactFormEvent) => {
		event.preventDefault();
		if (title.trim().length > 0 && !create.isPending) create.mutate();
	};

	return (
		<Menu
			isOpen={isOpen}
			onDismiss={() => setIsOpen(false)}
			align="start"
			trigger={
				<Button
					icon={Sparkles}
					aria-expanded={isOpen}
					onClick={() => setIsOpen(!isOpen)}
				>
					Create autoplaylist
				</Button>
			}
		>
			<form className={styles.form} onSubmit={submit}>
				<label className={styles.label} htmlFor="autoplaylist-title">
					An autoplaylist of {genre}
				</label>

				<Input
					size="md"
					id="autoplaylist-title"
					inputRef={inputRef}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Playlist name"
					aria-label="Playlist name"
					spellCheck="false"
					autoComplete="off"
					// The dialog exists to be typed in, and opens with the genre in the field for editing.
					autoFocus
				/>

				{/* The player's own count, not Jean's. They can differ: Jean matches the tag whole in
				    JavaScript and this is foobar2000 answering its own query against the Media Library. */}
				<p className={styles.preview}>
					{preview == null
						? "Asking the player what this matches…"
						: !preview.valid
							? `The player could not read that query — ${preview.error}`
							: !preview.libraryEnabled
								? "This player has no Media Library configured, so an autoplaylist would stay empty."
								: `The player matches ${plural(preview.matches, "track")}.`}
				</p>

				<p className={styles.note}>
					foobar2000 keeps it filled, so tracks tagged {genre} later join it on
					their own.
				</p>

				{create.error ? (
					<p className={styles.error}>
						Could not create it — {create.error.message}
					</p>
				) : null}

				<div className={styles.actions}>
					<Button onClick={() => setIsOpen(false)}>Cancel</Button>
					<Button
						variant="primary"
						type="submit"
						disabled={
							title.trim().length === 0 ||
							create.isPending ||
							preview?.valid === false
						}
					>
						{create.isPending ? "Creating…" : "Create"}
					</Button>
				</div>
			</form>
		</Menu>
	);
}
