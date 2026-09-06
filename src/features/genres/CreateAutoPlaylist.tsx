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
	const canCreate =
		state.kind === "ready" && state.capabilities.canCreateAutoPlaylists;

	const [isOpen, setIsOpen] = useState(false);
	const [title, setTitle] = useState(genre);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const query = genreQuery(genre);

	useEffect(() => {
		if (!isOpen) setTitle(genre);
	}, [isOpen, genre]);

	// The preview runs on foobar2000's main thread, so it is asked once per query rather than once per keystroke.
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
			// No `key`: the component 409s on a second playlist carrying one, and a genre autoplaylist is the
			// user's to rename or delete.
			const made = await createAutoPlaylist(origin, token, {
				title: title.trim(),
				query,
			});
			if (!made.ok) throw new Error(made.message);

			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return made.playlist;
		},
		onSuccess: (playlist) => {
			setIsOpen(false);
			if (playlist.beefwebId) onOpenPlaylist(playlist.beefwebId);
		},
	});

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
					autoFocus
				/>

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
