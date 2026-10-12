import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { RootErrorBoundary } from "@/app/RootErrorBoundary";
import { followPollWith } from "@/domain/player/playerPoll";
import { libraryPollFollower } from "@/domain/track/libraryLoader";
import { startLocale } from "@/shared/i18n/locale";
import "@/shared/styles/global.css";

const queryClient = new QueryClient();

followPollWith(libraryPollFollower);

await startLocale();

const logRenderError = (
	error: unknown,
	{ componentStack }: { componentStack?: string },
) => console.error(error, componentStack);

// React 19 logs a render error itself, and giving the root these replaces that log with this one.
createRoot(document.getElementById("root") as HTMLElement, {
	onCaughtError: logRenderError,
	onUncaughtError: logRenderError,
}).render(
	<StrictMode>
		<RootErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</RootErrorBoundary>
	</StrictMode>,
);
