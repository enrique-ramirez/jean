import { DiscAlbum } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { classNames } from "@/shared/lib/classNames";
import {
	canCacheArtwork,
	dropArtwork,
	heldArtwork,
	holdArtwork,
} from "./artworkCache";
import {
	type ArtworkOutcome,
	outcomeFor,
	requestArtwork,
} from "./artworkQueue";
import { whenNearViewport } from "./nearViewport";

type ArtworkState = "waiting" | "granted" | ArtworkOutcome;

import styles from "./Artwork.module.css";

const knownState = (key: string | null): ArtworkState | null =>
	key ? (outcomeFor(key) ?? null) : null;

export function Artwork({
	src,
	identity,
	size,
	alt = "",
	className,
	onSettled,
}: {
	// `undefined` is not known yet and holds the shimmer; `null` is there is no cover here and settles.
	src: string | null | undefined;
	// Which picture is meant, as against where to ask for it. beefweb addresses a cover by its position
	// in a playlist, so the address stops meaning the same picture as soon as anything edits that
	// playlist, and the same sleeve has a different address in every view. Everything that remembers a
	// cover -- the store, the shared blob, whether it 404ed -- keys on this. Left out, the address is
	// used, which is only safe where it cannot move: a path names a file, a playlist position does not.
	// `null` says this picture cannot be identified *and* its address may move, so nothing is kept.
	identity?: string | null;
	size?: number | string;
	alt?: string;
	className?: string;
	onSettled?: (outcome: ArtworkOutcome) => void;
}) {
	const key = identity === null ? null : (identity ?? src ?? null);
	const [state, setState] = useState<ArtworkState>(
		() => knownState(key) ?? "waiting",
	);
	const [href, setHref] = useState<string | null>(null);
	const box = useRef<HTMLDivElement | null>(null);
	const release = useRef<((outcome?: ArtworkOutcome) => void) | null>(null);

	useEffect(() => {
		const known = knownState(key);

		if (!src) {
			setState(src === null ? "failed" : "waiting");
			setHref(null);
			return;
		}

		if (known === "failed") {
			setState("failed");
			setHref(null);
			return;
		}

		setState(known ?? "waiting");
		setHref(null);

		if (!canCacheArtwork() || !key) {
			setHref(src);
			if (!known) setState("granted");
			return;
		}

		const element = box.current;
		if (!element) return;

		let live = true;
		let claimed = false;
		const abort = new AbortController();

		const dropClaim = () => {
			if (!claimed) return;
			claimed = false;
			dropArtwork(key);
		};

		const resolve = async () => {
			try {
				const url = await holdArtwork(key, src, abort.signal);
				claimed = true;

				if (!live) {
					dropClaim();
					return;
				}

				setHref(url);
				setState((current) => (current === "ok" ? current : "granted"));
			} catch {
				if (!live) return;
				release.current?.("failed");
				release.current = null;
				setState("failed");
			}
		};

		let cancel = whenNearViewport(element, async () => {
			const held = await heldArtwork(key);
			if (held) claimed = true;
			if (!live) {
				dropClaim();
				return;
			}

			if (held) {
				setHref(held);
				setState((current) => (current === "ok" ? current : "granted"));
				return;
			}

			release.current = requestArtwork(key, resolve);
		});

		return () => {
			live = false;
			cancel();
			cancel = () => {};
			abort.abort();
			dropClaim();
			release.current?.();
			release.current = null;
		};
	}, [src, key]);

	const settle = (outcome: ArtworkOutcome) => {
		release.current?.(outcome);
		release.current = null;
		setState(outcome);
	};

	const settledRef = useRef(onSettled);
	settledRef.current = onSettled;
	useEffect(() => {
		if (state === "ok" || state === "failed") settledRef.current?.(state);
	}, [state]);

	const classes = classNames(styles.artwork, className);

	return (
		<div
			ref={box}
			className={classes}
			style={size === undefined ? undefined : { width: size, height: size }}
			data-artwork={state}
		>
			{state === "ok" && href ? null : (
				<span
					className={`${styles.placeholder}${state === "failed" ? "" : " loading"}`}
					aria-hidden="true"
				>
					<DiscAlbum strokeWidth={1.5} />
				</span>
			)}

			{href && (state === "granted" || state === "ok") ? (
				<img
					className={styles.image}
					src={href}
					alt={alt}
					fetchPriority="low"
					decoding="async"
					draggable="false"
					onLoad={() => settle("ok")}
					onError={() => settle("failed")}
				/>
			) : null}
		</div>
	);
}
