"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Иконка профиля в шапке: меню с настройками и подобными пунктами.
export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Клик вне меню закрывает его.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Профиль"
        className={`pressable w-8 h-8 rounded-full border flex items-center justify-center ${
          open ? "border-accent-bright text-accent-bright" : "border-border text-muted hover:text-white"
        }`}
      >
        <svg viewBox="0 0 20 20" className="w-4.5 h-4.5" fill="none" aria-hidden="true">
          <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.8 16.5c1.2-2.6 3.5-3.9 6.2-3.9s5 1.3 6.2 3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-10 card p-1 min-w-44 z-20 rise-in">
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="pressable w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-card-hover flex items-center gap-2.5"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Настройки
          </Link>
          <a
            href="https://github.com/Na1ker/Project"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="pressable w-full text-left px-3 py-2 rounded-lg text-sm text-muted hover:bg-card-hover hover:text-white flex items-center gap-2.5"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
              <path d="M8 .8a7.2 7.2 0 0 0-2.28 14.03c.36.07.5-.16.5-.35v-1.22c-2 .44-2.43-.97-2.43-.97-.33-.83-.8-1.05-.8-1.05-.65-.45.05-.44.05-.44.73.05 1.11.75 1.11.75.64 1.1 1.68.78 2.09.6.07-.47.25-.79.46-.97-1.6-.18-3.28-.8-3.28-3.56 0-.79.28-1.43.74-1.94-.07-.18-.32-.92.07-1.91 0 0 .6-.2 1.98.74a6.9 6.9 0 0 1 3.6 0c1.38-.94 1.98-.74 1.98-.74.4 1 .15 1.73.07 1.91.46.5.74 1.15.74 1.94 0 2.77-1.69 3.38-3.3 3.56.26.22.49.66.49 1.33v1.97c0 .19.13.42.5.35A7.2 7.2 0 0 0 8 .8Z" />
            </svg>
            GitHub проекта
          </a>
        </div>
      )}
    </div>
  );
}
