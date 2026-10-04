import { useEffect, useRef } from "react";

type Props = {
  siteKey: string;
  onToken: (token: string) => void;
  onExpire: () => void;
  resetSignal: number;
};

export function Turnstile({ siteKey, onToken, onExpire, resetSignal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onExpireRef = useRef(onExpire);
  onTokenRef.current = onToken;
  onExpireRef.current = onExpire;

  useEffect(() => {
    let cancelled = false;
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-turnstile]",
    );

    const render = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current != null) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      containerRef.current.innerHTML = "";
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onExpireRef.current(),
        "error-callback": () => onExpireRef.current(),
        theme: "light",
      });
    };

    if (!script) {
      script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.turnstile = "true";
      script.onload = () => render();
      document.head.appendChild(script);
    } else if (window.turnstile) {
      render();
    } else {
      script.addEventListener("load", render, { once: true });
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current != null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current != null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  if (!siteKey) {
    return (
      <p className="hint warn">
        Turnstile site key is not configured (`VITE_TURNSTILE_SITE_KEY`).
      </p>
    );
  }

  return <div className="turnstile" ref={containerRef} />;
}
