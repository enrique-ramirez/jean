import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { FormEvent as ReactFormEvent } from "react";
import { useRef, useState } from "react";

import { genreQuery } from "@/domain/library/genreQuery";
import { PLAYLISTS_KEY } from "@/domain/player/usePlaylists";
import { orThrow, retryWhenTooFast } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import {
	createAutoPlaylist,
	previewQuery,
	type QueryPreview,
} from "@/shared/api/playlists";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useResettingState } from "@/shared/hooks/useResettingState";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Menu } from "@/shared/ui/Menu";
import styles from "./CreateAutoPlaylist.module.css";

const askPreview = async (origin: string, query: string) =>
	orThrow(await previewQuery(origin, query));

function previewSays(
	t: Translate,
	{
		preview,
		failed,
		refused,
	}: { preview: QueryPreview | undefined; failed: boolean; refused: boolean },
) {
	if (preview) {
		if (!preview.valid) return t("genre.queryFailed", { error: preview.error });
		if (!preview.libraryEnabled) return t("genre.noMediaLibrary");
		return t("genre.matches", { count: preview.matches });
	}
	if (failed) return t("genre.previewFailed");
	return t(refused ? "genre.previewBusy" : "genre.asking");
}

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
	const [title, setTitle] = useResettingState(genre, [isOpen]);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const query = genreQuery(genre);

	const {
		data: preview,
		isError,
		isFetching,
		failureCount,
	} = useQuery({
		queryKey: ["fooJeanPreview", origin, query],
		queryFn: () => askPreview(requireFooJean(origin), query),
		enabled: isOpen && Boolean(origin),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		...retryWhenTooFast(),
	});

	const create = useMutation({
		mutationFn: async () => {
			const required = requireFooJean(origin);
			const made = orThrow(
				await createAutoPlaylist(required, { title: title.trim(), query }),
			);
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
			return made;
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
					{previewSays(t, {
						preview,
						failed: isError && !isFetching,
						refused: failureCount > 0,
					})}
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
							preview?.valid !== true
						}
					>
						{t(create.isPending ? "action.creating" : "action.create")}
					</Button>
				</div>
			</form>
		</Menu>
	);
}
