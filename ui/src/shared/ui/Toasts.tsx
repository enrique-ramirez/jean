import { Check, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./Toasts.module.css";
import { dismissToast, holdToast, releaseToast, useToasts } from "./toastStore";

const ICONS = { default: Check, error: TriangleAlert, neutral: Info };

export function Toasts({ pinned = null }: { pinned?: ReactNode }) {
	const t = useTranslate();
	const toasts = useToasts();

	return (
		<div
			className={styles.layer}
			role="status"
			aria-live="polite"
			data-toasts=""
		>
			{toasts.map((toast) => {
				const Icon = ICONS[toast.tone] ?? ICONS.default;

				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: a pointer resting on it or focus inside it holds the timer; nothing here is pressed
					<div
						key={toast.id}
						className={styles.toast}
						data-tone={toast.tone}
						onMouseEnter={() => holdToast(toast.id)}
						onMouseLeave={() => releaseToast(toast.id)}
						onFocus={() => holdToast(toast.id)}
						onBlur={() => releaseToast(toast.id)}
					>
						<Icon
							className={styles.icon}
							size={15}
							strokeWidth={2.2}
							aria-hidden="true"
						/>
						<p className={styles.message}>{toast.message}</p>

						{toast.action ? (
							<button
								type="button"
								className={styles.action}
								onClick={() => {
									dismissToast(toast.id);
									toast.action?.run();
								}}
							>
								{toast.action.label}
							</button>
						) : null}

						<button
							type="button"
							className={styles.close}
							aria-label={t("action.dismiss")}
							onClick={() => dismissToast(toast.id)}
						>
							<X size={13} strokeWidth={2.2} aria-hidden="true" />
						</button>
					</div>
				);
			})}
			{pinned}
		</div>
	);
}
