import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { PLAYLISTS_KEY } from "@/domain/player/usePlayer";
import { LIBRARY_TITLE, looksLikeLibrary } from "@/domain/track/jeanPlaylists";
import { renamePlaylist } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import { plural } from "@/shared/lib/text";
import { Button } from "@/shared/ui/Button";
import styles from "./LibrarySetup.module.css";

// beefweb sees playlists and the filesystem, and foobar2000's Media Library is invisible to it, so an autoplaylist is the way through.
// There is no picker: the exact title is the contract, because adopting anything loosely named "Library" can make a stray playlist stand in for a whole collection.
export function LibrarySetup({ playlists }: { playlists: PlaylistInfo[] }) {
	const queryClient = useQueryClient();

	// Offered, never taken: renaming somebody's playlist is theirs to agree to.
	const candidate = playlists.find(looksLikeLibrary) ?? null;

	const adopt = useMutation({
		mutationFn: async () => {
			// Only reachable from the button this candidate renders.
			await renamePlaylist((candidate as PlaylistInfo).id, LIBRARY_TITLE);
			await queryClient.refetchQueries({ queryKey: PLAYLISTS_KEY });
		},
	});

	return (
		<div className={styles.setup}>
			<p className={styles.eyebrow}>Search</p>
			<h1 className={styles.title}>Point Jean at your library</h1>

			<p className={styles.body}>
				beefweb can only see playlists, so foobar2000's Media Library has to
				become one. In foobar2000: <b>Library → Search</b>, enter{" "}
				<code>ALL</code> as the query, then save it as an autoplaylist named
				exactly:
			</p>

			<p className={styles.name}>
				<code>{LIBRARY_TITLE}</code>
			</p>

			<p className={styles.body}>
				It holds every track you have and keeps itself in sync. The name is how
				Jean knows the playlist is meant for it rather than one of yours -- so
				it has to match, and Jean keeps it out of your sidebar once it does.
			</p>

			<p className={styles.aside}>
				Jean only ever reads it. Nothing here creates, clears or reorders a
				playlist.
			</p>

			{candidate ? (
				<div className={styles.migrate}>
					<p className={styles.migrateBody}>
						You already have a playlist called <b>{candidate.title}</b>
						{candidate.itemCount > 0
							? ` (${plural(candidate.itemCount, "track")})`
							: null}
						. If that is your library, Jean can rename it.
					</p>
					<Button
						variant="primary"
						icon={Check}
						disabled={adopt.isPending}
						onClick={() => adopt.mutate()}
					>
						{adopt.isPending ? "Renaming..." : `Rename it to ${LIBRARY_TITLE}`}
					</Button>
					{adopt.error ? (
						<p className={styles.error}>
							Could not rename -- {adopt.error.message}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
