import { translate } from "../i18n/locale";
import styles from "./Skeleton.module.css";

type Length = number | string;

const toCss = (length: Length) =>
	typeof length === "number" ? `${length}px` : length;

export const busyProps = (busy: boolean) =>
	busy ? ({ "aria-busy": true } as const) : {};

export const BusyNote = () => (
	<span className="visually-hidden">{translate("skeleton.loading")}</span>
);

export function Skeleton({
	width,
	height,
	className,
}: {
	width?: Length;
	height?: Length;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={`${styles.skeleton} loading${className ? ` ${className}` : ""}`}
			style={{
				width: width === undefined ? undefined : toCss(width),
				height: height === undefined ? undefined : toCss(height),
			}}
		/>
	);
}
