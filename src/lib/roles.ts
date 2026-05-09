export type Role = "owner" | "editor" | "viewer" | "translator";

export function canEdit(role: Role | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function canManageMembers(role: Role | null | undefined): boolean {
  return role === "owner";
}

export function isTranslator(role: Role | null | undefined): boolean {
  return role === "translator";
}

export const TRANSLATOR_ALLOWED_NAV = [
  "task",
  "calendar",
  "translations",
] as const;

export function canSeeNav(role: Role | null | undefined, nav: string): boolean {
  if (role === "translator") {
    return (TRANSLATOR_ALLOWED_NAV as readonly string[]).includes(nav);
  }
  return true;
}
