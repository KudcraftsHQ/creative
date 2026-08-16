/**
 * The handful of primitives this app actually uses.
 *
 * Deliberately small. shadcn's generator drops forty files in; this app has two
 * screens and needs a button, a field and a spinner, so those are what it has.
 */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn.ts";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors " +
    "disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-neutral-400 focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-neutral-900 text-white hover:bg-neutral-700",
        secondary: "bg-white text-neutral-900 border border-neutral-200 hover:bg-neutral-100",
        ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
        danger: "bg-red-600 text-white hover:bg-red-700",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm",
        "placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-neutral-400",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900",
        className,
      )}
      aria-label="loading"
    />
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-24 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-neutral-500">{hint}</p> : null}
    </div>
  );
}
