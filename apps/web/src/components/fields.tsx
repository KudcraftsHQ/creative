/**
 * The controls the inspector is made of.
 *
 * Every one of them writes a field of the document schema and nothing else. There
 * is no view model in between: what a control sets is what `creative render` reads,
 * so a value typed here and a value typed into the JSON produce the same pixels.
 *
 * They commit on blur or on pointer-up rather than on every keystroke, because a
 * commit is a PATCH, a re-render on the server and a new preview. Live feedback
 * while dragging is local; the document changes once, when the hand lets go.
 */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 text-sm outline-none " +
  "placeholder:text-neutral-400 focus:ring-2 focus:ring-neutral-400";

/** A number that may legitimately be absent — blank means "the schema's default". */
export function NumberField({
  value,
  onCommit,
  placeholder,
  step,
}: {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  placeholder?: string;
  step?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      className={inputClass}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const next = e.target.value === "" ? undefined : Number(e.target.value);
        if (next !== value) onCommit(next);
      }}
    />
  );
}

export function TextField({
  value,
  onCommit,
  placeholder,
  className,
}: {
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      className={cn(inputClass, className)}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const next = e.target.value || undefined;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

export function SelectField<T extends string>({
  value,
  options,
  onCommit,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onCommit: (value: T) => void;
}) {
  return (
    <select
      className={cn(inputClass, "cursor-pointer")}
      value={value}
      onChange={(e) => onCommit(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A colour, as text beside a swatch.
 *
 * Typing wins and the swatch is the shortcut, because a colour in this schema is
 * often a variable — `@brand.yellow` — and a native colour input can neither show
 * one nor keep it.
 */
export function ColorField({
  value,
  onCommit,
  fallback = "#111111",
  placeholder = "none",
}: {
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
  fallback?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 gap-1">
      <TextField value={value} onCommit={onCommit} placeholder={placeholder} />
      <input
        type="color"
        aria-label="Pick a colour"
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-200 bg-white"
        value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback}
        onChange={(e) => onCommit(e.target.value)}
      />
    </div>
  );
}

/**
 * A slider that reads out while you drag and writes when you stop.
 *
 * Uncontrolled on purpose: the parent re-renders on every save, and a controlled
 * range fed from a round trip stutters under the thumb.
 */
export function SliderField({
  value,
  min,
  max,
  step = 1,
  onCommit,
  format = (v) => String(v),
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
  format?: (value: number) => string;
}) {
  const [live, setLive] = useState(value);
  const commit = (v: number) => {
    if (v !== value) onCommit(v);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        className="h-8 min-w-0 flex-1 cursor-pointer accent-neutral-900"
        onChange={(e) => setLive(Number(e.target.value))}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
      />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-neutral-500">
        {format(live)}
      </span>
    </div>
  );
}

/** A pressed/unpressed square. Used for the flips, italic, and anything else binary. */
export function Toggle({
  pressed,
  onPressedChange,
  label,
  children,
  className,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
        pressed
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** One of a small set, laid out in a row. */
export function Choice<T extends string>({
  value,
  options,
  onCommit,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onCommit: (value: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onCommit(o.value)}
          className={cn(
            "h-8 flex-1 rounded-lg border text-xs transition-colors",
            value === o.value
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 bg-white hover:bg-neutral-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A 3×3 grid of points in 0..1 — the anchor picker, and the focal picker.
 *
 * The nearest cell is lit rather than an exact match, so a focal point set to
 * `[0.42, 0.3]` from the CLI still shows where it roughly is instead of showing
 * nothing selected at all.
 */
export function Grid3({
  value,
  onCommit,
  labels,
}: {
  value: [number, number];
  onCommit: (value: [number, number]) => void;
  labels?: (x: number, y: number) => string;
}) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.17;
  return (
    <div className="grid grid-cols-3 gap-1">
      {[0, 0.5, 1].map((y) =>
        [0, 0.5, 1].map((x) => {
          const on = near(value[0], x) && near(value[1], y);
          return (
            <button
              key={`${x},${y}`}
              type="button"
              title={labels?.(x, y) ?? `${x}, ${y}`}
              onClick={() => onCommit([x, y])}
              className={cn(
                "flex h-7 items-center justify-center rounded border transition-colors",
                on ? "border-neutral-900 bg-neutral-900" : "border-neutral-200 bg-white hover:bg-neutral-100",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-white" : "bg-neutral-300")} />
            </button>
          );
        }),
      )}
    </div>
  );
}
