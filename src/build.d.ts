/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;

/** Set only by `vite build --mode capacitor` via .env.capacitor — the native
 * bundle can't infer the backend origin from its own capacitor://localhost. */
interface ImportMetaEnv {
  readonly VITE_SERVER_ORIGIN?: string;
  readonly VITE_SERVER_BASE_PATH?: string;
}
