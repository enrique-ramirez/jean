import { Pencil, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	untitledPlaylistName,
	usePlaylistActions,
} from "@/domain/player/usePlaylists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { randomId } from "@/shared/lib/randomId";
import type { ActionNode } from "@/shared/ui/ActionMenu";
import { pushToast } from "@/shared/ui/toastStore";

const refused = (message: string) => () =>
	pushToast({ tone: "error", message });

export function usePlaylistEditing({
	playlists,
	shown,
	target,
	selectedId,
	onSelect,
}: {
	playlists: PlaylistInfo[];
	shown: PlaylistInfo[];
	target: PlaylistInfo | null;
	selectedId: string | null | undefined;
	onSelect: (id: string) => void;
}) {
	const t = useTranslate();
	const { create, rename, remove, move } = usePlaylistActions();
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [pendingCreates, setPendingCreates] = useState(
		new Map<string, Promise<string | null>>(),
	);

	const playerIndexOf = (position: number) =>
		playlists.findIndex((entry) => entry.id === shown[position].id);

	const reorder = (from: number, to: number) =>
		move.mutate(
			{ id: shown[from].id, index: playerIndexOf(to) },
			{ onError: refused(t("playlist.reorderRefused")) },
		);

	const newPlaylist = () => {
		const id = `pending:${randomId()}`;
		const title = untitledPlaylistName(shown);
		setRenamingId(id);

		const landed = create.mutateAsync({ id, title }).then(
			(playlist) => {
				setRenamingId((current) => (current === id ? playlist.id : current));
				return playlist.id;
			},
			() => {
				refused(t("playlist.createRefused"))();
				return null;
			},
		);

		setPendingCreates((current) => new Map(current).set(id, landed));
		landed.finally(() =>
			setPendingCreates((current) => {
				if (!current.has(id)) return current;
				const next = new Map(current);
				next.delete(id);
				return next;
			}),
		);
	};

	const deletePlaylist = (playlist: PlaylistInfo) => {
		if (playlist.id === selectedId) {
			const at = shown.findIndex((entry) => entry.id === playlist.id);
			const next = shown[at + 1] ?? shown[at - 1];
			if (next) onSelect(next.id);
		}
		remove.mutate(playlist.id, {
			onError: refused(
				t("playlist.deleteFailed", { playlist: playlist.title }),
			),
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: deletePlaylist's own captures, listed instead of it
	const actions = useMemo((): ActionNode[] => {
		if (!target) return [];

		return [
			{
				id: "rename",
				label: t("action.rename"),
				icon: Pencil,
				onSelect: () => setRenamingId(target.id),
			},
			{ type: "separator" },
			{
				id: "delete",
				label: t("action.delete"),
				icon: Trash2,
				danger: true,
				items: [
					{
						type: "message",
						text: t("playlist.deleteWarning", {
							playlist: target.title,
							count: target.itemCount,
						}),
					},
					{
						id: "confirm",
						label: t("playlist.delete"),
						icon: Trash2,
						danger: true,
						onSelect: () => deletePlaylist(target),
					},
					{ id: "cancel", label: t("playlist.keepIt"), icon: Undo2 },
				],
			},
		];
	}, [target, shown, selectedId, t]);

	const commitRename = (playlist: PlaylistInfo, title: string | null) => {
		setRenamingId(null);

		const pending = pendingCreates.get(playlist.id);
		if (pending) {
			if (title) {
				pending.then((id) => {
					if (id && title !== playlist.title)
						rename.mutate(
							{ id, title },
							{
								onError: refused(
									t("playlist.renameFailed", { playlist: title }),
								),
							},
						);
				});
			}
			return;
		}

		if (title && title !== playlist.title) {
			rename.mutate(
				{ id: playlist.id, title },
				{
					onError: refused(
						t("playlist.renameFailed", { playlist: playlist.title }),
					),
				},
			);
		}
	};

	return {
		renamingId,
		pendingCreates,
		isCreating: create.isPending,
		newPlaylist,
		reorder,
		commitRename,
		actions,
	};
}
