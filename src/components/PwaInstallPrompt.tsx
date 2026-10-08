"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share2, X } from "lucide-react";
import Image from "next/image";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wasDismissed() {
  try { return sessionStorage.getItem("pwa-install-dismissed") === "1"; }
  catch { return false; }
}

function iosHelpSnapshot() {
  if (isStandalone() || wasDismissed()) return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function subscribeDisplayMode(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

const serverSnapshot = () => false;

export function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const showIosHelp = useSyncExternalStore(subscribeDisplayMode, iosHelpSnapshot, serverSnapshot);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    if (isStandalone() || wasDismissed()) return;

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  function dismiss() {
    try { sessionStorage.setItem("pwa-install-dismissed", "1"); } catch { /* Storage may be disabled. */ }
    setDismissed(true);
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  if (dismissed || installed || (!installPrompt && !showIosHelp)) return null;

  return (
    <aside className="pwa-install-prompt" role="status" aria-label="نصب همیار دوربین">
      <button className="pwa-install-close" type="button" onClick={dismiss} aria-label="بستن">
        <X size={17} aria-hidden="true" />
      </button>
      <Image src="/icons/icon-192.png" alt="" width={48} height={48} />
      <div>
        <strong>نصب اپلیکیشن همیار دوربین</strong>
        {showIosHelp ? (
          <p>
            در Safari دکمه <Share2 size={15} aria-hidden="true" /> اشتراک‌گذاری را بزنید و سپس
            <b> Add to Home Screen </b> را انتخاب کنید.
          </p>
        ) : (
          <p>برای دسترسی سریع‌تر، همیار دوربین را روی دستگاه خود نصب کنید.</p>
        )}
      </div>
      {installPrompt ? (
        <button className="pwa-install-action" type="button" onClick={install}>
          <Download size={16} aria-hidden="true" />
          نصب
        </button>
      ) : null}
    </aside>
  );
}
