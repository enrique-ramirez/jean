import styles from "./Settings.module.css";
import { TagWriting } from "./TagWriting";

// A route rather than a sheet, unlike the shortcut list beside it in the top
// bar: shortcuts are a reference you dismiss, settings are a place you go.
export function SettingsView() {
	return (
		<div className={styles.view}>
			<header className={styles.header}>
				<p className={styles.eyebrow}>Jean</p>
				<h1 className={styles.title}>Settings</h1>
				<p className={styles.blurb}>
					What Jean can do depends on what the player can do. Everything here is
					detected rather than assumed, so a bare foobar2000 install is a
					complete app and each of these switches something extra on.
				</p>
			</header>

			<TagWriting />
		</div>
	);
}
