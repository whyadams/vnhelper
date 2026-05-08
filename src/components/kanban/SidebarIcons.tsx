import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const filled = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  xmlns: "http://www.w3.org/2000/svg",
});

/* Iconex/Filled — Category 2 (4 rounded tiles, two short + two tall) */
export function CategoryFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <rect x="4" y="4" width="7" height="4" rx="2.5" />
      <rect x="4" y="11" width="7" height="9" rx="2.5" />
      <rect x="13" y="4" width="7" height="9" rx="2.5" />
      <rect x="13" y="16" width="7" height="4" rx="2.5" />
    </svg>
  );
}

/* Iconex/Filled — Calendar (filled body, two top tabs, dotted day marker) */
export function CalendarFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <path d="M8 2.5a.9.9 0 0 0-.9.9V4H6.5A3.5 3.5 0 0 0 3 7.5v11A3.5 3.5 0 0 0 6.5 22h11a3.5 3.5 0 0 0 3.5-3.5v-11A3.5 3.5 0 0 0 17.5 4H17v-.6a.9.9 0 1 0-1.8 0V4H8.8v-.6A.9.9 0 0 0 8 2.5Z" />
      <rect x="3" y="9" width="18" height="1.4" fill="currentColor" opacity="0" />
      <circle cx="8" cy="14" r="1.1" fill="#131416" />
      <circle cx="12" cy="14" r="1.1" fill="#131416" />
      <circle cx="16" cy="14" r="1.1" fill="#131416" />
      <circle cx="8" cy="17.5" r="1.1" fill="#131416" />
      <circle cx="12" cy="17.5" r="1.1" fill="#131416" />
    </svg>
  );
}

/* Iconex/Filled — Document 2 (page with folded corner, text lines as cutouts) */
export function DocumentFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 2.2v3.3A2.5 2.5 0 0 0 16.5 8h3.3c.13.49.2 1.02.2 1.6v8.9A3.5 3.5 0 0 1 16.5 22h-9A3.5 3.5 0 0 1 4 18.5v-13A3.5 3.5 0 0 1 7.5 2H12.4c.58 0 1.11.07 1.6.2Zm-6 11.05a.9.9 0 0 1 .9-.9h6.2a.9.9 0 1 1 0 1.8H8.9a.9.9 0 0 1-.9-.9Zm.9 3.1a.9.9 0 1 0 0 1.8h4.2a.9.9 0 1 0 0-1.8H8.9Z"
      />
      <path d="M15.8 2.55c.1.07.18.16.26.24l3.65 3.95c.07.07.13.16.18.25h-3.39A.7.7 0 0 1 15.8 6.3V2.55Z" />
    </svg>
  );
}

/* Iconex/Filled — Image (frame with mountain + sun cutout) */
export function ImageFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm.7 5.4a1.85 1.85 0 1 0 0 3.7 1.85 1.85 0 0 0 0-3.7Zm12.05 9.55-3.4-3.45a2.6 2.6 0 0 0-3.65 0L4.3 18.4A4.5 4.5 0 0 0 7.5 20h9a4.5 4.5 0 0 0 3.75-3.05Z"
      />
    </svg>
  );
}

/* Iconex/Filled — Users (two heads + body silhouette) */
export function UsersFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <circle cx="9" cy="7" r="3.6" />
      <circle cx="17.2" cy="8" r="2.6" />
      <path d="M9 12.5c-3.6 0-6.6 1.7-6.6 4.4 0 2 1.5 3.1 6.6 3.1s6.6-1.1 6.6-3.1c0-2.7-3-4.4-6.6-4.4Z" />
      <path d="M17.4 12.4c-.55 0-1.07.04-1.55.13 1.2.96 1.95 2.3 1.95 4.04 0 .8-.16 1.46-.45 2.02 2.96-.13 4.25-.97 4.25-2.32 0-1.91-1.95-3.87-4.2-3.87Z" />
    </svg>
  );
}

/* Iconex/Filled — Mail (envelope) */
export function MailFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <path d="M17 3.5H7A4.5 4.5 0 0 0 2.5 8v8a4.5 4.5 0 0 0 4.5 4.5h10a4.5 4.5 0 0 0 4.5-4.5V8A4.5 4.5 0 0 0 17 3.5Zm2.6 5.4-6.04 4.36a2.55 2.55 0 0 1-3.12 0L4.4 8.9a.95.95 0 1 1 1.12-1.54l6.04 4.37a.65.65 0 0 0 .88 0l6.04-4.37a.95.95 0 1 1 1.12 1.54Z" />
    </svg>
  );
}

/* Iconex/Filled — Bell (notification bell with clapper) */
export function BellFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <path d="M12 2.2a6.6 6.6 0 0 0-6.6 6.6v2.6c0 .55-.16 1.1-.46 1.56l-1.16 1.74A2.16 2.16 0 0 0 5.6 18h12.8a2.16 2.16 0 0 0 1.82-3.3l-1.16-1.74a2.83 2.83 0 0 1-.46-1.56V8.8A6.6 6.6 0 0 0 12 2.2Z" />
      <path d="M9.6 19.4a.6.6 0 0 0-.58.74A3 3 0 0 0 12 22.5a3 3 0 0 0 2.98-2.36.6.6 0 0 0-.58-.74H9.6Z" />
    </svg>
  );
}

/* Iconex/Filled — Share (3 nodes connected by 2 lines) */
export function ShareFilledIcon(p: IconProps) {
  return (
    <svg {...filled(p.size)} {...p}>
      <circle cx="18" cy="5" r="2.8" />
      <circle cx="18" cy="19" r="2.8" />
      <circle cx="6" cy="12" r="2.8" />
      <path
        d="M8.4 10.7 15.6 6.5a.9.9 0 1 1 .9 1.56l-7.2 4.2a.9.9 0 1 1-.9-1.56Zm0 2.6 7.2 4.2a.9.9 0 1 1-.9 1.56l-7.2-4.2a.9.9 0 1 1 .9-1.56Z"
      />
    </svg>
  );
}

/* Iconex/Filled — Settings (8-tooth gear with central round hole) */
export function SettingsFilledIcon(p: IconProps) {
  const size = p.size ?? 22;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...p}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.66 2.27a2.05 2.05 0 0 0-3.32 0l-.45.62a2.05 2.05 0 0 1-2.16.78l-.74-.2a2.05 2.05 0 0 0-2.55 2.55l.2.74a2.05 2.05 0 0 1-.78 2.16l-.62.45a2.05 2.05 0 0 0 0 3.32l.62.45a2.05 2.05 0 0 1 .78 2.16l-.2.74a2.05 2.05 0 0 0 2.55 2.55l.74-.2a2.05 2.05 0 0 1 2.16.78l.45.62a2.05 2.05 0 0 0 3.32 0l.45-.62a2.05 2.05 0 0 1 2.16-.78l.74.2a2.05 2.05 0 0 0 2.55-2.55l-.2-.74a2.05 2.05 0 0 1 .78-2.16l.62-.45a2.05 2.05 0 0 0 0-3.32l-.62-.45a2.05 2.05 0 0 1-.78-2.16l.2-.74a2.05 2.05 0 0 0-2.55-2.55l-.74.2a2.05 2.05 0 0 1-2.16-.78l-.45-.62ZM12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"
      />
    </svg>
  );
}
