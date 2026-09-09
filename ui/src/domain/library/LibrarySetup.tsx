import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { LIBRARY_TITLE, looksLikeLibrary } from "@/domain/track/jeanPlaylists";
import { renamePlaylist } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./LibrarySetup.module.css";

export function LibrarySetup({ playlists }: { playlists: PlaylistInfo[] }) {
	const t = useTranslate();
	const queryClient = useQueryClient();

	const candidate = playlists.find(looksLikeLibrary) ?? null;

	const adopt = useMutation({
		mutationFn: async () => {
			await renamePlaylist((candidate as PlaylistInfo).id, LIBRARY_TITLE);
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
		},
	});

	return (
		<div className={styles.setup}>
			<p className={styles.eyebrow}>{t("search.title")}</p>
			<h1 className={styles.title}>{t("librarySetup.title")}</h1>

			<p className={styles.body}>
				<Trans
					phrase="librarySetup.how"
					menu={<b>{t("librarySetup.menu")}</b>}
					query={<code>ALL</code>}
				/>
			</p>

			<p className={styles.name}>
				<code>{LIBRARY_TITLE}</code>
			</p>

			<p className={styles.body}>{t("librarySetup.why")}</p>

			<p className={styles.aside}>{t("librarySetup.readOnly")}</p>

			{candidate ? (
				<div className={styles.migrate}>
					<p className={styles.migrateBody}>
						{candidate.itemCount > 0 ? (
							<Trans
								phrase="librarySetup.candidateSized"
								playlist={<b>{candidate.title}</b>}
								count={candidate.itemCount}
							/>
						) : (
							<Trans
								phrase="librarySetup.candidate"
								playlist={<b>{candidate.title}</b>}
							/>
						)}
					</p>
					<Button
						variant="primary"
						icon={Check}
						disabled={adopt.isPending}
						onClick={() => adopt.mutate()}
					>
						{adopt.isPending
							? t("librarySetup.renaming")
							: t("librarySetup.rename", { name: LIBRARY_TITLE })}
					</Button>
					{adopt.error ? (
						<p className={styles.error}>
							{t("librarySetup.renameFailed", { message: adopt.error.message })}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
