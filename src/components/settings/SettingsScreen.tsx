import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AccountSection } from "./sections/AccountSection";
import { AISection } from "./sections/AISection";
import { GeneralSection } from "./sections/GeneralSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { SubscribeSection } from "./sections/SubscribeSection";
import { TrayWidgetSection } from "./sections/TrayWidgetSection";
import { UpdatesSection } from "./sections/UpdatesSection";

export type SettingsSectionKey =
  | "general"
  | "account"
  | "subscribe"
  | "ai"
  | "integrations"
  | "notifications"
  | "tray"
  | "updates"
  | "about";

interface NavItem {
  key: SettingsSectionKey;
  label: string;
}
interface NavGroup {
  title?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    items: [
      { key: "general", label: "General" },
      { key: "account", label: "Account" },
      { key: "subscribe", label: "Subscribe" },
      { key: "ai", label: "AI" },
      { key: "integrations", label: "Integrations" },
      { key: "notifications", label: "Notifications" },
    ],
  },
  {
    title: "Desktop app",
    items: [
      { key: "tray", label: "Tray & Widget" },
      { key: "updates", label: "Updates" },
      { key: "about", label: "About" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSectionKey;
}

export function SettingsScreen({
  open,
  onClose,
  initialSection = "general",
}: Props) {
  const [active, setActive] = useState<SettingsSectionKey>(initialSection);

  useEffect(() => {
    if (open) setActive(initialSection);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="set-overlay" role="dialog" aria-modal="true">
      <div className="set-topbar">
        <button
          type="button"
          className="set-back"
          onClick={onClose}
          aria-label="Close settings"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 12L6 8l4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Settings
        </button>
      </div>
      <div className="set-grid">
        <nav className="set-nav" aria-label="Settings sections">
          {NAV.map((group, gi) => (
            <NavGroupBlock key={gi} title={group.title}>
              {group.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={
                    "set-nav-item" + (active === it.key ? " is-active" : "")
                  }
                  onClick={() => setActive(it.key)}
                >
                  {it.label}
                </button>
              ))}
            </NavGroupBlock>
          ))}
        </nav>
        <div className="set-content">
          <div className="set-content-inner">
            <SectionBody section={active} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NavGroupBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <>
      {title && <div className="set-nav-group-title">{title}</div>}
      {children}
    </>
  );
}

function SectionBody({ section }: { section: SettingsSectionKey }) {
  switch (section) {
    case "general":
      return <GeneralSection />;
    case "account":
      return <AccountSection />;
    case "subscribe":
      return <SubscribeSection />;
    case "ai":
      return <AISection />;
    case "integrations":
      return <IntegrationsSection />;
    case "notifications":
      return <NotificationsSection />;
    case "tray":
      return <TrayWidgetSection />;
    case "updates":
      return <UpdatesSection />;
    case "about":
      return <AboutSection />;
  }
}
