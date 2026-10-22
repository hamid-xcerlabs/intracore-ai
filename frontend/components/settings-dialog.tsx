"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";

// ── Types ──────────────────────────────────────────────────────────────────

export type SettingsSection =
  | "general"
  | "appearance"
  | "memory"
  | "data"
  | "about";

export interface SettingsState {
  fontSize: "small" | "medium" | "large";
  sendOnEnter: boolean;
  theme: "light" | "dark" | "system";
  sidebarDefault: "open" | "collapsed";
}

export const DEFAULT_SETTINGS: SettingsState = {
  fontSize: "medium",
  sendOnEnter: true,
  theme: "light",
  sidebarDefault: "open",
};

export const SETTINGS_KEY = "intracore.settings";

export function loadSettings(): SettingsState {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as SettingsState;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: SettingsState): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* noop */ }
}

// ── Nav item ───────────────────────────────────────────────────────────────

function NavItem({
  id,
  active,
  icon,
  label,
  onClick,
}: {
  id: SettingsSection;
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: (id: SettingsSection) => void;
}) {
  return (
    <button
      type="button"
      className={`ic-settings-nav-item${active ? " is-active" : ""}`}
      onClick={() => onClick(id)}
    >
      <span className="ic-settings-nav-icon">{icon}</span>
      {label}
    </button>
  );
}

// ── Row helpers ────────────────────────────────────────────────────────────

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="ic-setting-row">
      <div className="ic-setting-row-label">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="ic-setting-row-control">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`ic-toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ic-toggle-thumb" />
    </button>
  );
}

// ── General section ────────────────────────────────────────────────────────

export function GeneralSection({
  settings,
  onChange,
}: {
  settings: SettingsState;
  onChange: (patch: Partial<SettingsState>) => void;
}) {
  return (
    <div className="ic-settings-section-body">
      <SettingRow
        label="Font size"
        hint="Affects the chat message text size"
      >
        <div className="ic-segmented">
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              key={size}
              type="button"
              className={`ic-segmented-btn${settings.fontSize === size ? " is-active" : ""}`}
              onClick={() => onChange({ fontSize: size })}
            >
              {size.charAt(0).toUpperCase() + size.slice(1)}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Send on Enter"
        hint="Press Enter to send, Shift+Enter for new line"
      >
        <Toggle
          checked={settings.sendOnEnter}
          onChange={(v) => onChange({ sendOnEnter: v })}
        />
      </SettingRow>
    </div>
  );
}

// ── Appearance section ─────────────────────────────────────────────────────

export function AppearanceSection({
  settings,
  onChange,
}: {
  settings: SettingsState;
  onChange: (patch: Partial<SettingsState>) => void;
}) {
  const themes: { value: SettingsState["theme"]; label: string; icon: ReactNode }[] = [
    {
      value: "light",
      label: "Light",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      value: "dark",
      label: "Dark",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <path d="M17 11.5A7 7 0 1 1 8.5 3a5 5 0 0 0 8.5 8.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      value: "system",
      label: "System",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <rect x="2" y="3.5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M7 17h6M10 14.5v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="ic-settings-section-body">
      <SettingRow label="Theme" hint="Choose your preferred color scheme">
        <div className="ic-theme-picker">
          {themes.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`ic-theme-option${settings.theme === t.value ? " is-active" : ""}`}
              onClick={() => onChange({ theme: t.value })}
            >
              <span className="ic-theme-option-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Sidebar default"
        hint="How the sidebar appears when you open the app"
      >
        <div className="ic-segmented">
          {(["open", "collapsed"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`ic-segmented-btn${settings.sidebarDefault === v ? " is-active" : ""}`}
              onClick={() => onChange({ sidebarDefault: v })}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

// ── Main dialog ────────────────────────────────────────────────────────────

export function SettingsDialog({
  open,
  activeSection,
  onSectionChange,
  onClose,
  children,
}: {
  open: boolean;
  activeSection: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const NAV: { id: SettingsSection; label: string; icon: ReactNode }[] = [
    {
      id: "general",
      label: "General",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 2.5v15M2.5 10h15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 2"/>
        </svg>
      ),
    },
    {
      id: "memory",
      label: "Memory",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
          <rect x="2.5" y="5.5" width="15" height="9" rx="2" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M6 9.5h2M6 12h3M12 9.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "data",
      label: "Data & Privacy",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
          <path d="M10 2.5L3.5 5v5c0 3.6 2.8 6.9 6.5 7.5 3.7-.6 6.5-3.9 6.5-7.5V5L10 2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: "about",
      label: "About",
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 9v5M10 7v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="ic-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            ref={dialogRef}
            className="ic-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            {/* Left nav */}
            <nav className="ic-settings-nav">
              <div className="ic-settings-nav-title">Settings</div>
              {NAV.map((item) => (
                <NavItem
                  key={item.id}
                  id={item.id}
                  active={activeSection === item.id}
                  icon={item.icon}
                  label={item.label}
                  onClick={onSectionChange}
                />
              ))}
            </nav>

            {/* Right content */}
            <div className="ic-settings-content">
              <div className="ic-settings-content-header">
                <h2>{NAV.find((n) => n.id === activeSection)?.label}</h2>
                <button
                  type="button"
                  className="ic-settings-close"
                  aria-label="Close settings"
                  onClick={onClose}
                >
                  <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <div className="ic-settings-content-body">
                {children}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
