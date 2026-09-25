import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { FormEvent as ReactFormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { genreQuery } from "@/domain/library/genreQuery";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import {
	createAutoPlaylist,
	previewQuery,
	requireFooJean,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useTranslate } from "@/shared/i18n/useTranslate";
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
	const t = useTranslate();
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const { origin, state } = discovery;
	const canCreate =
		state.kind === "ready" && state.capabilities.canCreateAutoPlaylists;

	const [isOpen, setIsOpen] = useState(false);
	const [title, setTitle] = useState(genre);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const query = genreQuery(genre);

	useEffect(() => {
		if (!isOpen) setTitle(genre);
	}, [isOpen, genre]);

	const { data: preview } = useQuery({
		queryKey: ["fooJeanPreview", origin, query],
		queryFn: () => (origin ? previewQuery(origin, query) : null),
		enabled: isOpen && Boolean(origin),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	const create = useMutation({
		mutationFn: async () => {
			const required = requireFooJean(origin);
			const made = await createAutoPlaylist(required, {
				title: title.trim(),
				query,
			});
			if (!made.ok) throw new Error(made.message);

			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return made.playlist;
		},
		onSuccess: (playlist) => {
			setIsOpen(false);
			onOpenPlaylist(playlist.id);
		},
	});

	if (!origin || !canCreate) return null;

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
					{t("genre.createAutoPlaylist")}
				</Button>
			}
		>
			<form className={styles.form} onSubmit={submit}>
				<label className={styles.label} htmlFor="autoplaylist-title">
					{t("genre.autoPlaylistOf", { genre })}
				</label>

				<Input
					size="md"
					id="autoplaylist-title"
					inputRef={inputRef}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder={t("playlist.name")}
					aria-label={t("playlist.name")}
					spellCheck="false"
					autoComplete="off"
					autoFocus
				/>

				<p className={styles.preview}>
					{preview == null
						? t("genre.asking")
						: !preview.valid
							? t("genre.queryFailed", { error: preview.error })
							: !preview.libraryEnabled
								? t("genre.noMediaLibrary")
								: t("genre.matches", { count: preview.matches })}
				</p>

				<p className={styles.note}>{t("genre.keptFilled", { genre })}</p>

				{create.error ? (
					<p className={styles.error}>
						{t("genre.createFailed", { message: create.error.message })}
					</p>
				) : null}

				<div className={styles.actions}>
					<Button onClick={() => setIsOpen(false)}>{t("action.cancel")}</Button>
					<Button
						variant="primary"
						type="submit"
						disabled={
							title.trim().length === 0 ||
							create.isPending ||
							preview?.valid === false
						}
					>
						{t(create.isPending ? "action.creating" : "action.create")}
					</Button>
				</div>
			</form>
		</Menu>
	);
}
