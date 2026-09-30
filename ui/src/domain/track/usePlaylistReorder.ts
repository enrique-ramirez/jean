import { useCallback, useEffect, useRef, useState } from "react";
import { permitsPlaylistWrites } from "@/shared/api/discovery";
import { rowEditRefusal } from "@/shared/api/playlists";
import type { PlaylistInfo } from "@/shared/api/types";
import { useCoalescedWrite } from "@/shared/hooks/useCoalescedWrite";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import type { PlaylistSnapshot } from "./playlistEntries";
import { carryPlaylist, holdPlaylistLoads } from "./playlistLoader";
import { moveOrder, reorderedSnapshot } from "./playlistPatch";
import {
	REFUSAL_PHRASES,
	type ReorderEdit,
	sendReorderEdit,
} from "./reorderEdit";

interface Session {
	playlistId: string;
	chain: string[];
	queue: ReorderEdit[];
	sorts: number;
	release: (() => void) | null;
}

interface Overlay {
	playlistId: string;
	snapshot: PlaylistSnapshot;
	chain: string[];
	isSettled: boolean;
}

const isIdentity = (order: Int32Array) =>
	order.every((old, position) => old === position);

export function usePlaylistReorder({
	playlist,
	snapshot,
}: {
	playlist: PlaylistInfo | null;
	snapshot: PlaylistSnapshot;
}) {
	const { discovery, recheck } = useFooJean();
	const { origin } = discovery;
	const canWritePlaylists = permitsPlaylistWrites(discovery);

	const [overlay, setOverlay] = useState<Overlay | null>(null);
	const session = useRef<Session | null>(null);

	const latest = useRef({ playlist, snapshot, overlay, origin });
	latest.current = { playlist, snapshot, overlay, origin };

	const abandon = useCallback(() => {
		session.current?.release?.();
		session.current = null;
		setOverlay(null);
	}, []);

	useEffect(() => abandon, [abandon]);

	const playlistId = playlist?.id;
	useEffect(() => {
		if (session.current && session.current.playlistId !== playlistId) abandon();
	}, [playlistId, abandon]);

	const settle = useCallback(() => {
		setOverlay((current) => current && { ...current, isSettled: true });
	}, []);

	const refuse = useCallback(
		(held: Session, cause: "moved" | "locked" | "other") => {
			if (session.current !== held) return;
			abandon();
			pushToast({
				tone: "error",
				message: translate(REFUSAL_PHRASES[cause], {
					playlist: latest.current.playlist?.title ?? "",
				}),
			});
		},
		[abandon],
	);

	const drain = useCallback(async () => {
		const held = session.current;
		const { origin: player } = latest.current;
		if (!held || !player) return;

		for (let edit = held.queue.shift(); edit; edit = held.queue.shift()) {
			const structure = held.chain[held.chain.length - 1];
			const answered = await sendReorderEdit(
				player,
				held.playlistId,
				structure,
				edit,
			);
			if (session.current !== held) return;

			if (!answered.ok) {
				if (answered.reason === "refused" && answered.status === 403) recheck();
				refuse(held, rowEditRefusal(answered));
				return;
			}

			const { order } = answered.value;
			carryPlaylist(
				held.playlistId,
				structure,
				answered.value.structure,
				order,
			);
			held.chain.push(answered.value.structure);

			if (edit.kind === "sort") {
				held.sorts -= 1;
				pushToast({
					message: translate("playlist.sorted", {
						playlist: latest.current.playlist?.title ?? "",
						ordering: edit.ordering,
					}),
				});
			}
			setOverlay(
				(current) =>
					current && {
						...current,
						chain: [...held.chain],
						snapshot:
							edit.kind === "sort"
								? reorderedSnapshot(
										current.snapshot,
										order,
										current.snapshot.structure,
									)
								: current.snapshot,
					},
			);
		}

		held.release?.();
		held.release = null;
		settle();
	}, [recheck, refuse, settle]);

	const write = useCoalescedWrite<true>(drain, () => {
		if (session.current) refuse(session.current, "other");
	});

	const drawnBase = useCallback(() => {
		const {
			playlist: current,
			snapshot: loaded,
			overlay: drawn,
		} = latest.current;
		return drawn && drawn.playlistId === current?.id ? drawn.snapshot : loaded;
	}, []);

	const canReorder =
		canWritePlaylists &&
		playlist !== null &&
		!playlist.isAutoPlaylist &&
		playlist.role === null &&
		!snapshot.isLoading &&
		snapshot.error === null;

	const sessionFor = useCallback((current: PlaylistInfo) => {
		if (session.current?.playlistId !== current.id)
			session.current = {
				playlistId: current.id,
				chain: [current.structure],
				queue: [],
				sorts: 0,
				release: null,
			};
		const held = session.current;
		held.release ??= holdPlaylistLoads(current.id);
		return held;
	}, []);

	const send = useCallback(
		(positions: number[], toFor: (moved: number[]) => number) => {
			const { playlist: current } = latest.current;
			if (!canReorder || !current) return null;
			if (session.current?.playlistId === current.id && session.current.sorts)
				return null;

			const base = drawnBase();
			const moved = [...new Set(positions)].sort((a, b) => a - b);
			const to = toFor(moved);
			const order = moveOrder(base.columns.trackCount, moved, to);
			if (!order || isIdentity(order)) return null;

			const held = sessionFor(current);
			held.queue.push({ kind: "move", positions: moved, to, order });
			setOverlay({
				playlistId: current.id,
				snapshot: reorderedSnapshot(base, order, base.structure),
				chain: [...held.chain],
				isSettled: false,
			});
			write(true);
			return to;
		},
		[canReorder, drawnBase, sessionFor, write],
	);

	const move = useCallback(
		(positions: number[], gap: number) =>
			send(
				positions,
				(moved) => gap - moved.filter((position) => position < gap).length,
			),
		[send],
	);

	const nudge = useCallback(
		(positions: number[], delta: number) =>
			send(positions, (moved) => moved[0] + delta),
		[send],
	);

	const sort = useCallback(
		(pattern: string, ordering: string) => {
			const { playlist: current } = latest.current;
			if (!canReorder || !current) return;

			const base = drawnBase();
			const held = sessionFor(current);
			held.sorts += 1;
			held.queue.push({ kind: "sort", pattern, ordering });
			setOverlay({
				playlistId: current.id,
				snapshot: base,
				chain: [...held.chain],
				isSettled: false,
			});
			write(true);
		},
		[canReorder, drawnBase, sessionFor, write],
	);

	const structure = playlist?.structure;
	useEffect(() => {
		if (!overlay?.isSettled || structure === undefined) return;
		const newest = overlay.chain[overlay.chain.length - 1];
		if (structure !== newest && overlay.chain.includes(structure)) return;
		session.current = null;
		setOverlay(null);
	}, [overlay, structure]);

	return {
		snapshot:
			overlay && overlay.playlistId === playlistId
				? overlay.snapshot
				: snapshot,
		onReorder: canReorder ? move : undefined,
		onNudge: canReorder ? nudge : undefined,
		sort: canReorder ? sort : undefined,
	};
}
