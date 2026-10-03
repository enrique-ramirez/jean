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
import { keptOrder, moveOrder, reorderedSnapshot } from "./playlistPatch";
import {
	REFUSAL_PHRASES,
	type Refusal,
	type RowEdit,
	sendRowEdit,
} from "./rowEdit";

interface Session {
	playlistId: string;
	chain: string[];
	queue: RowEdit[];
	sorts: number;
	sending: RowEdit["kind"] | null;
	release: (() => void) | null;
}

type Rearrangement = Exclude<RowEdit, { kind: "sort" }>;

interface Overlay {
	playlistId: string;
	snapshot: PlaylistSnapshot;
	chain: string[];
	isSettled: boolean;
}

const isIdentity = (order: Int32Array) =>
	order.every((old, position) => old === position);

export function usePlaylistRowEdits({
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
		(held: Session, cause: Refusal, kind: RowEdit["kind"]) => {
			if (session.current !== held) return;
			abandon();
			pushToast({
				tone: "error",
				message: translate(REFUSAL_PHRASES[kind][cause], {
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
			held.sending = edit.kind;
			const answered = await sendRowEdit(
				player,
				held.playlistId,
				structure,
				edit,
			);
			if (session.current !== held) return;

			if (!answered.ok) {
				if (answered.reason === "refused" && answered.status === 403) recheck();
				refuse(held, rowEditRefusal(answered), edit.kind);
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
			if (edit.kind === "remove")
				pushToast({
					message: translate("playlist.rowsRemoved", {
						count: edit.positions.length,
						playlist: latest.current.playlist?.title ?? "",
					}),
				});
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
		const held = session.current;
		if (held) refuse(held, "other", held.sending ?? "move");
	});

	const drawnBase = useCallback(() => {
		const {
			playlist: current,
			snapshot: loaded,
			overlay: drawn,
		} = latest.current;
		return drawn && drawn.playlistId === current?.id ? drawn.snapshot : loaded;
	}, []);

	const canEdit =
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
				sending: null,
				release: null,
			};
		const held = session.current;
		held.release ??= holdPlaylistLoads(current.id);
		return held;
	}, []);

	const enqueue = useCallback(
		(current: PlaylistInfo, edit: RowEdit, drawn: PlaylistSnapshot) => {
			const held = sessionFor(current);
			if (edit.kind === "sort") held.sorts += 1;
			held.queue.push(edit);
			setOverlay({
				playlistId: current.id,
				snapshot: drawn,
				chain: [...held.chain],
				isSettled: false,
			});
			write(true);
		},
		[sessionFor, write],
	);

	const rearrange = useCallback(
		<Edit extends Rearrangement>(
			positions: number[],
			editFor: (named: number[], count: number) => Edit | null,
		): Edit | null => {
			const { playlist: current } = latest.current;
			if (!canEdit || !current) return null;
			if (session.current?.playlistId === current.id && session.current.sorts)
				return null;

			const base = drawnBase();
			const named = [...new Set(positions)].sort((a, b) => a - b);
			const edit = editFor(named, base.columns.trackCount);
			if (!edit) return null;

			enqueue(
				current,
				edit,
				reorderedSnapshot(base, edit.order, base.structure),
			);
			return edit;
		},
		[canEdit, drawnBase, enqueue],
	);

	const send = useCallback(
		(positions: number[], toFor: (moved: number[]) => number) =>
			rearrange(positions, (moved, count) => {
				const to = toFor(moved);
				const order = moveOrder(count, moved, to);
				return order && !isIdentity(order)
					? { kind: "move" as const, positions: moved, to, order }
					: null;
			})?.to ?? null,
		[rearrange],
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

	const remove = useCallback(
		(positions: number[]) =>
			rearrange(positions, (removed, count) => {
				const order = keptOrder(count, removed);
				return order && removed.length > 0
					? { kind: "remove" as const, positions: removed, order }
					: null;
			}) !== null,
		[rearrange],
	);

	const sort = useCallback(
		(pattern: string, ordering: string) => {
			const { playlist: current } = latest.current;
			if (!canEdit || !current) return;
			enqueue(current, { kind: "sort", pattern, ordering }, drawnBase());
		},
		[canEdit, drawnBase, enqueue],
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
		onReorder: canEdit ? move : undefined,
		onNudge: canEdit ? nudge : undefined,
		onRemove: canEdit ? remove : undefined,
		sort: canEdit ? sort : undefined,
	};
}
