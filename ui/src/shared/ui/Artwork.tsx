import { DiscAlbum } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { classNames } from "@/shared/lib/classNames";
import { dropArtwork, heldArtwork, holdArtwork } from "./artworkHandles";
import {
	type ArtworkOutcome,
	onForgotten,
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
	revealsInstantly,
}: {
	src: string | null | undefined;
	identity?: string;
	size?: number | string;
	alt?: string;
	className?: string;
	onSettled?: (outcome: ArtworkOutcome) => void;
	// See `shared/ui/CLAUDE.md`, *Artwork*: when this is right and when it is not.
	revealsInstantly?: boolean;
}) {
	const key = identity ?? src ?? null;
	const [state, setState] = useState<ArtworkState>(
		() => knownState(key) ?? "waiting",
	);
	const [href, setHref] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const retryIfRefused = useEffectEvent(() => {
		if (state === "failed") setRetryToken((token) => token + 1);
	});
	const revealsAtOnce = useEffectEvent(() => revealsInstantly);
	const box = useRef<HTMLDivElement | null>(null);
	const release = useRef<((outcome?: ArtworkOutcome) => void) | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryToken re-fires this after a forgotten key, not a read
	useEffect(() => {
		const known = knownState(key);
		const forget = key ? onForgotten(key, retryIfRefused) : undefined;

		if (!src) {
			setState(src === null ? "failed" : "waiting");
			setHref(null);
			return forget;
		}

		if (known === "failed") {
			setState("failed");
			setHref(null);
			return forget;
		}

		setState(known ?? "waiting");
		setHref(null);

		if (!key) return forget;

		const element = box.current;
		if (!element) return forget;

		let live = true;
		let claimed = false;
		const abort = new AbortController();

		const dropClaim = () => {
			if (!claimed) return;
			claimed = false;
			dropArtwork(key);
		};

		// A 404 is the only refusal that says anything about the cover rather than about the
		// moment: `foo_jean` rate-limits covers and answers 503 while the library is rebuilding,
		// and either of those remembered would leave a sleeve blank until the tab is reloaded.
		let settled: ArtworkOutcome | undefined;

		const read = async () => {
			const response = await fetch(src, { signal: abort.signal });
			if (!response.ok) {
				if (response.status === 404) settled = "failed";
				throw new Error(`no artwork: ${response.status}`);
			}
			return response.blob();
		};

		const resolve = async () => {
			try {
				const url = await holdArtwork(key, read);
				claimed = true;

				if (!live) {
					dropClaim();
					return;
				}

				setHref(url);
				setState((current) => (current === "ok" ? current : "granted"));
			} catch {
				if (!live) return;
				release.current?.(settled);
				release.current = null;
				setState("failed");
			}
		};

		const claim = () => {
			const held = heldArtwork(key);
			if (held) {
				claimed = true;
				setHref(held);
				setState((current) => (current === "ok" ? current : "granted"));
				return;
			}

			release.current = requestArtwork(key, resolve);
		};

		let cancel = () => {};
		if (revealsAtOnce()) claim();
		else cancel = whenNearViewport(element, claim);

		return () => {
			forget?.();
			live = false;
			cancel();
			cancel = () => {};
			abort.abort();
			dropClaim();
			release.current?.();
			release.current = null;
		};
	}, [src, key, retryToken]);

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
