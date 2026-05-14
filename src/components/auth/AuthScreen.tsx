import { useState, type FormEvent, type ReactNode } from "react";
import { EyeIcon as Eye, EyeSlashIcon as EyeOff } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../state/AuthProvider";

type Mode = "signin" | "signup";

interface Testimonial {
  initials: string;
  name: string;
  handle: string;
  text: string;
  tint: "owner" | "editor" | "viewer" | "danger";
}

const TESTIMONIALS: Testimonial[] = [
  {
    initials: "SC",
    name: "Sarah Chen",
    handle: "@sarah.writes",
    text: "Finally a script tool that doesn't fight me. The graph view alone replaced three apps.",
    tint: "owner",
  },
  {
    initials: "MJ",
    name: "Marcus Johnson",
    handle: "@marcus.vn",
    text: "Branching dialogue that actually makes sense visually. My beta readers love the previews.",
    tint: "viewer",
  },
  {
    initials: "DM",
    name: "David Martinez",
    handle: "@davidcreates",
    text: "Photos, scenes, characters in one place. My VN went from notebook chaos to shippable in weeks.",
    tint: "editor",
  },
];

function GlassField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div className="auth-glass">{children}</div>
    </label>
  );
}

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    if (mode === "signin") {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else {
      const { error } = await signUp(
        email,
        password,
        name || email.split("@")[0],
      );
      if (error) setError(error);
      else setInfo(t("auth.signup_success"));
    }
    setBusy(false);
  };

  const switchMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setError(null);
    setInfo(null);
  };

  const heading = mode === "signin" ? t("auth.welcome_back") : t("auth.create_account");
  const subheading =
    mode === "signin" ? t("auth.signin_subtitle") : t("auth.signup_subtitle");

  return (
    <div className="auth-screen">
      <section className="auth-pane">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-brand">RenHub</div>
          <h1 className="auth-title auth-anim auth-d-1">{heading}</h1>
          <p className="auth-subtitle auth-anim auth-d-2">{subheading}</p>

          {mode === "signup" && (
            <div className="auth-anim auth-d-3">
              <GlassField label={t("auth.name")}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.name_placeholder")}
                  autoComplete="name"
                />
              </GlassField>
            </div>
          )}

          <div className="auth-anim auth-d-3">
            <GlassField label={t("auth.email")}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder={t("auth.email_placeholder")}
              />
            </GlassField>
          </div>

          <div className="auth-anim auth-d-4">
            <GlassField label={t("auth.password")}>
              <div className="auth-pass-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder={t("auth.password_placeholder")}
                />
                <button
                  type="button"
                  className="auth-pass-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={
                    showPassword ? t("auth.hide_password") : t("auth.show_password")
                  }
                >
                  {showPassword ? (
                    <EyeOff style={{ width: 16, height: 16 }} />
                  ) : (
                    <Eye style={{ width: 16, height: 16 }} />
                  )}
                </button>
              </div>
            </GlassField>
          </div>

          {mode === "signin" && (
            <div className="auth-row auth-anim auth-d-5">
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                />
                <span>{t("auth.keep_signed_in")}</span>
              </label>
              <button
                type="button"
                className="auth-link"
                onClick={() => setInfo(t("auth.reset_unconfigured"))}
              >
                {t("auth.reset_password")}
              </button>
            </div>
          )}

          {error && <div className="auth-error auth-anim">{error}</div>}
          {info && <div className="auth-info auth-anim">{info}</div>}

          <button
            type="submit"
            className="auth-submit auth-anim auth-d-6"
            disabled={busy}
          >
            {busy ? "…" : mode === "signin" ? t("auth.submit_sign_in") : t("auth.submit_sign_up")}
          </button>

          <p className="auth-foot auth-anim auth-d-7">
            {mode === "signin" ? (
              <>
                {t("auth.new_to_vnhelper")}{" "}
                <button
                  type="button"
                  className="auth-link"
                  onClick={switchMode}
                >
                  {t("auth.create_account")}
                </button>
              </>
            ) : (
              <>
                {t("auth.already_registered")}{" "}
                <button
                  type="button"
                  className="auth-link"
                  onClick={switchMode}
                >
                  {t("auth.tab_sign_in")}
                </button>
              </>
            )}
          </p>
        </form>
      </section>

      <aside className="auth-hero">
        <div className="auth-hero-art auth-slide" />
        <div className="auth-hero-grid" />
        <div className="auth-hero-glow" />

        <div className="auth-testimonials">
          <TestimonialCard t={TESTIMONIALS[0]} delay={10} />
          <TestimonialCard
            t={TESTIMONIALS[1]}
            delay={12}
            extraClass="auth-tm-xl"
          />
          <TestimonialCard
            t={TESTIMONIALS[2]}
            delay={14}
            extraClass="auth-tm-2xl"
          />
        </div>
      </aside>
    </div>
  );
}

function TestimonialCard({
  t,
  delay,
  extraClass,
}: {
  t: Testimonial;
  delay: number;
  extraClass?: string;
}) {
  return (
    <div
      className={`auth-tm auth-tm-anim auth-d-${delay}${
        extraClass ? ` ${extraClass}` : ""
      }`}
    >
      <div className={`auth-tm-avatar auth-tm-${t.tint}`}>{t.initials}</div>
      <div className="auth-tm-body">
        <div className="auth-tm-name">{t.name}</div>
        <div className="auth-tm-handle">{t.handle}</div>
        <p className="auth-tm-text">{t.text}</p>
      </div>
    </div>
  );
}
