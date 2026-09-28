import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { FormEvent as ReactFormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { genreQuery } from "@/domain/library/genreQuery";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import {
	createAutoPlaylist,
	type PreviewResult,
	previewQuery,
	type QueryPreview,
	requireFooJean,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Menu } from "@/shared/ui/Menu";
import styles from "./CreateAutoPlaylist.module.css";

const PREVIEW_BUSY_RETRIES = 3;

class PreviewRefused extends Error {
	readonly retryInMs: number | null;

	constructor({ retryInMs }: Extract<PreviewResult, { ok: false }>) {
		super("preview refused");
		this.retryInMs = retryInMs;
	}
}

const retryInMsOf = (error: Error) =>
	error instanceof PreviewRefused ? error.retryInMs : null;

async function askPreview(origin: string, query: string) {
	const result = await previewQuery(origin, query);
	if (!result.ok) throw new PreviewRefused(result);
	return result.preview;
}

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
	const [title, setTitle] = useState(genre);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const query = genreQuery(genre);

	useEffect(() => {
		if (!isOpen) setTitle(genre);
	}, [isOpen, genre]);

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
		retry: (count, error) =>
			retryInMsOf(error) !== null && count < PREVIEW_BUSY_RETRIES,
		retryDelay: (_, error) => retryInMsOf(error) ?? 0,
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
