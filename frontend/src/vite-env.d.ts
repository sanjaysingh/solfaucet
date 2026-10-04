/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAUCET_API_URL: string;
  readonly VITE_TURNSTILE_SITE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
}

interface TurnstileApi {
  render: (
    container: string | HTMLElement,
    options: TurnstileRenderOptions,
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

interface Window {
  turnstile?: TurnstileApi;
}
