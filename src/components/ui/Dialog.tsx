import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ============================================================
// Types
// ============================================================

export interface PromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" turns the confirm button red; "primary" is the default. */
  variant?: "primary" | "danger";
}

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
}

export interface AlertOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
}

interface DialogApi {
  prompt: (opts: PromptOptions) => Promise<string | null>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
}

const DialogCtx = createContext<DialogApi | null>(null);

// Internal state shape — discriminated by `kind`.
type DialogState =
  | ({
      kind: "prompt";
      resolve: (v: string | null) => void;
    } & PromptOptions)
  | ({
      kind: "confirm";
      resolve: (v: boolean) => void;
    } & ConfirmOptions)
  | ({
      kind: "alert";
      resolve: () => void;
    } & AlertOptions);

// ============================================================
// Provider
// ============================================================

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DialogState[]>([]);

  const push = useCallback((state: DialogState) => {
    setStack((s) => [...s, state]);
  }, []);

  const popTop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          push({ kind: "prompt", resolve, ...opts });
        }),
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          push({ kind: "confirm", resolve, ...opts });
        }),
      alert: (opts) =>
        new Promise<void>((resolve) => {
          push({ kind: "alert", resolve, ...opts });
        }),
    }),
    [push],
  );

  const top = stack[stack.length - 1];

  return (
    <DialogCtx.Provider value={api}>
      {children}
      {top && (
        <DialogHost
          key={stack.length}
          state={top}
          onClose={popTop}
        />
      )}
    </DialogCtx.Provider>
  );
}

export function useDialog(): DialogApi {
  const v = useContext(DialogCtx);
  if (!v) {
    throw new Error("useDialog must be used within <DialogProvider>");
  }
  return v;
}

// ============================================================
// Host — renders the actual dialog
// ============================================================

function DialogHost({
  state,
  onClose,
}: {
  state: DialogState;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const [value, setValue] = useState(
    state.kind === "prompt" ? state.defaultValue ?? "" : "",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener("keydown", onKey);
    if (state.kind === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setTimeout(() => confirmBtnRef.current?.focus(), 30);
    }
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    if (state.kind === "prompt") state.resolve(null);
    else if (state.kind === "confirm") state.resolve(false);
    else state.resolve();
    onClose();
  };

  const confirm = () => {
    if (state.kind === "prompt") state.resolve(value);
    else if (state.kind === "confirm") state.resolve(true);
    else state.resolve();
    onClose();
  };

  const variant =
    "variant" in state && state.variant ? state.variant : "primary";
  const confirmLabel =
    state.kind === "alert"
      ? state.confirmLabel ?? "OK"
      : state.kind === "confirm"
        ? state.confirmLabel ??
          (variant === "danger" ? "Delete" : "Confirm")
        : (state as PromptOptions).confirmLabel ?? "OK";
  const cancelLabel =
    state.kind === "alert"
      ? null
      : state.kind === "confirm"
        ? state.cancelLabel ?? "Cancel"
        : (state as PromptOptions).cancelLabel ?? "Cancel";

  return (
    <div
      className="vn-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        className={
          "vn-dialog" +
          (variant === "danger" ? " is-danger" : "") +
          (state.kind === "alert" ? " is-alert" : "")
        }
      >
        {state.title && <div className="vn-dialog-title">{state.title}</div>}
        {state.message && (
          <div className="vn-dialog-message">{state.message}</div>
        )}
        {state.kind === "prompt" && (
          <input
            ref={inputRef}
            className="vn-dialog-input"
            placeholder={state.placeholder ?? ""}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirm();
              }
            }}
          />
        )}
        <div className="vn-dialog-actions">
          {cancelLabel && (
            <button
              ref={cancelBtnRef}
              type="button"
              className="hbtn"
              onClick={cancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={
              "hbtn " + (variant === "danger" ? "is-danger" : "is-primary")
            }
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
