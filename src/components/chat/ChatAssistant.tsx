"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrainCircuit, Maximize2, MessageCircle, Minimize2, X } from "lucide-react";
import { ChatPanel } from "@/src/components/chat/ChatPanel";

/** Routes where a floating widget would get in the way. */
const hiddenOn = ["/login", "/register"];

export function ChatAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    document.body.classList.toggle("chat-assistant-maximized", open && maximized);
    return () => document.body.classList.remove("chat-assistant-maximized");
  }, [maximized, open]);

  if (hiddenOn.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return null;

  return (
    <>
      <button
        type="button"
        className={open ? "chat-launcher is-open" : "chat-launcher"}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "بستن دستیار" : "دستیار هوشمند"}
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
      </button>

      {open ? (
        <div
          className={maximized ? "chat-dock is-maximized" : "chat-dock"}
          role="dialog"
          aria-modal={maximized}
          aria-label="هوش‌یار؛ دستیار محلی امنیت و شبکه"
        >
          <header className="chat-dock-head">
            <span className="chat-dock-avatar">
              <BrainCircuit size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>هوش‌یار</strong>
              <small>مدل محلی دوربین، شبکه و امنیت</small>
            </div>
            <div className="chat-dock-actions">
              <button
                type="button"
                className="chat-dock-expand"
                onClick={() => setMaximized((value) => !value)}
                aria-label={maximized ? "بازگرداندن اندازه پنجره" : "بزرگ‌نمایی دستیار"}
                title={maximized ? "بازگرداندن اندازه پنجره" : "بزرگ‌نمایی دستیار"}
              >
                {maximized ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setMaximized(false);
                }}
                aria-label="بستن"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </header>
          <ChatPanel variant="floating" />
        </div>
      ) : null}
    </>
  );
}
