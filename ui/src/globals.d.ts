// Injected by `vite.config.ts` when the dev server serves Jean rather than beefweb serving it from the player. Null in a build.
declare const __PLAYER_HOST__: string | null;

// The language codes with a translation in `public/locales/`, read at config time by `vite.config.ts`.
declare const __SHIPPED_LOCALES__: string[];
