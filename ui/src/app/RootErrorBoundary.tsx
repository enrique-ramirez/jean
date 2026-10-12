import {
	Component,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";

import { DEVICE_ID_KEY, DEVICE_NAME_KEY } from "@/domain/player/device";
import { readStoredState } from "@/shared/hooks/useStoredState";
import { THEME_KEY, type Theme } from "@/shared/hooks/useTheme";
import { en, type Phrase } from "@/shared/i18n/en";
import { translate } from "@/shared/i18n/locale";
import { clearOwnedKeys } from "@/shared/lib/ownedStorage";
import { Button } from "@/shared/ui/Button";
import styles from "./RootErrorBoundary.module.css";

type FailurePhrase = Extract<Phrase, `error.${string}`>;

const phrase = (key: FailurePhrase): string => {
	try {
		return translate(key);
	} catch {
		return en[key];
	}
};

const clearIgnoringRefusal = (clear: () => void) => {
	try {
		clear();
	} catch {
		// A browser's `localStorage` and `sessionStorage` throw where storage is blocked.
	}
};

function resetThisDevice() {
	clearIgnoringRefusal(() =>
		clearOwnedKeys(localStorage, [DEVICE_ID_KEY, DEVICE_NAME_KEY]),
	);
	clearIgnoringRefusal(() => clearOwnedKeys(sessionStorage));
	location.reload();
}

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const isTheme = (stored: unknown): stored is Theme =>
	stored === "light" || stored === "dark";

const themeToDraw = (): Theme => {
	const chosen = readStoredState<Theme | null>(THEME_KEY, null, isTheme);
	if (chosen) return chosen;
	return window.matchMedia?.("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
};

function RenderFailure({ error }: { error: unknown }) {
	const actions = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		document.documentElement.dataset.theme ||= themeToDraw();
	}, []);

	useEffect(() => {
		actions.current?.querySelector("button")?.focus();
	}, []);

	return (
		<main className={styles.failure}>
			<div className={styles.message} role="alert">
				<h1 className={styles.title}>{phrase("error.title")}</h1>
				<p className={styles.body}>{phrase("error.body")}</p>
				<p className={styles.thrown}>{messageOf(error)}</p>
			</div>
			<div className={styles.actions} ref={actions}>
				<Button variant="primary" onClick={() => location.reload()}>
					{phrase("error.reload")}
				</Button>
				<Button onClick={resetThisDevice}>{phrase("error.reset")}</Button>
			</div>
			<p className={styles.resetDetail}>{phrase("error.resetDetail")}</p>
		</main>
	);
}

type Failure = { error: unknown } | null;

export class RootErrorBoundary extends Component<
	{ children: ReactNode },
	{ failure: Failure }
> {
	override state: { failure: Failure } = { failure: null };

	static getDerivedStateFromError(error: unknown): { failure: Failure } {
		return { failure: { error } };
	}

	override render() {
		const { failure } = this.state;
		return failure ? (
			<RenderFailure error={failure.error} />
		) : (
			this.props.children
		);
	}
}
