import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { genreQuery } from "@/domain/library/genreQuery";
import { NewPlaylistForm } from "@/domain/player/NewPlaylistForm";
import { useMakePlaylist } from "@/domain/player/usePlaylistActions";
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
	const { discovery } = useFooJean();
	const { origin, state } = discovery;
	const canCreate =
		state.kind === "ready" && state.capabilities.canCreateAutoPlaylists;

	const [isOpen, setIsOpen] = useState(false);
	const [title, setTitle] = useResettingState(genre, [isOpen]);

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

	const create = useMakePlaylist(
		async () =>
			orThrow(
				await createAutoPlaylist(requireFooJean(origin), {
					title: title.trim(),
					query,
				}),
			),
		(playlist) => {
			setIsOpen(false);
			onOpenPlaylist(playlist.id);
		},
	);

	if (!origin || !canCreate) return null;

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
			<NewPlaylistForm
				label={t("genre.autoPlaylistOf", { genre })}
				title={title}
				onTitleChange={setTitle}
				error={
					create.error
						? t("genre.createFailed", { message: create.error.message })
						: null
				}
				isPending={create.isPending}
				pendingLabel={t("action.creating")}
				canSubmit={preview?.valid === true}
				onSubmit={() => create.mutate()}
				onCancel={() => setIsOpen(false)}
			>
				<p className={styles.preview} role="status">
					{previewSays(t, {
						preview,
						failed: isError && !isFetching,
						refused: failureCount > 0,
					})}
				</p>

				<p className={styles.note}>{t("genre.keptFilled", { genre })}</p>
			</NewPlaylistForm>
		</Menu>
	);
}
