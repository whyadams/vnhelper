import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
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
      else
        setInfo(
          "Account created. Check your inbox if email confirmation is required, then sign in.",
        );
    }
    setBusy(false);
  };

  const switchMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setError(null);
    setInfo(null);
  };

  const heading = mode === "signin" ? "Welcome back" : "Create account";
  const subheading =
    mode === "signin"
      ? "Sign in to continue working on your visual novel."
      : "Start drafting scripts, scenes, and story graphs in minutes.";

  return (
    <div className="auth-screen">
      <section className="auth-pane">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-brand">VnHelper</div>
          <h1 className="auth-title auth-anim auth-d-1">{heading}</h1>
          <p className="auth-subtitle auth-anim auth-d-2">{subheading}</p>

          {mode === "signup" && (
            <div className="auth-anim auth-d-3">
              <GlassField label="Name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </GlassField>
            </div>
          )}

          <div className="auth-anim auth-d-3">
            <GlassField label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </GlassField>
          </div>

          <div className="auth-anim auth-d-4">
            <GlassField label="Password">
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
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="auth-pass-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                >
                  {showPassword ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
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
                <span>Keep me signed in</span>
              </label>
              <button
                type="button"
                className="auth-link"
                onClick={() =>
                  setInfo(
                    "Password reset is not configured yet. Contact your workspace admin.",
                  )
                }
              >
                Reset password
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
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <p className="auth-foot auth-anim auth-d-7">
            {mode === "signin" ? (
              <>
                New to VnHelper?{" "}
                <button
                  type="button"
                  className="auth-link"
                  onClick={switchMode}
                >
                  Create account
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button
                  type="button"
                  className="auth-link"
                  onClick={switchMode}
                >
                  Sign in
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
