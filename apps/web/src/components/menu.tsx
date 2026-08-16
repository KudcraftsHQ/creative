/**
 * Right-click menus, and the icon buttons that sit beside them.
 *
 * Every action reachable from a context menu is also reachable another way — an
 * icon button on the row, or a control in the inspector. A menu that is the only
 * route to something is a menu that hides it: right-click is a shortcut for
 * people who know it is there, never the only door.
 *
 * Icon buttons carry a tooltip *and* an aria-label, because an icon alone is a
 * rebus. The tooltip is for the mouse, the label for everything else.
 */
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

export const TooltipProvider = TooltipPrimitive.Provider;

/** A square button that is only an icon. `label` is mandatory, not decoration. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }
>(({ label, danger, className, children, ...props }, ref) => (
  <TooltipPrimitive.Root delayDuration={400}>
    <TooltipPrimitive.Trigger asChild>
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white",
          "text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
          "disabled:pointer-events-none disabled:opacity-50",
          danger && "hover:border-red-200 hover:bg-red-50 hover:text-red-600",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={6}
        className="z-50 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-md"
      >
        {label}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
));
IconButton.displayName = "IconButton";

/* ── context menu ──────────────────────────────────────────────────────────── */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

export function ContextMenuContent({ children }: { children: ReactNode }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className="z-50 min-w-[11rem] overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-neutral-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        danger ? "text-red-600 data-[highlighted]:bg-red-50" : "text-neutral-700",
      )}
    >
      {icon ? <span className="opacity-60">{icon}</span> : null}
      {children}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator() {
  return <ContextMenuPrimitive.Separator className="my-1 h-px bg-neutral-100" />;
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return (
    <ContextMenuPrimitive.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
      {children}
    </ContextMenuPrimitive.Label>
  );
}

/** A nested menu — "Move to ▸" over a list of projects. */
export function ContextMenuSubMenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Sub>
      <ContextMenuPrimitive.SubTrigger
        className={cn(
          "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-700 outline-none",
          "data-[highlighted]:bg-neutral-100 data-[state=open]:bg-neutral-100",
        )}
      >
        {icon ? <span className="opacity-60">{icon}</span> : null}
        <span className="flex-1">{label}</span>
        <span className="text-neutral-400">›</span>
      </ContextMenuPrimitive.SubTrigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.SubContent
          className="z-50 min-w-[10rem] overflow-hidden rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
        >
          {children}
        </ContextMenuPrimitive.SubContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Sub>
  );
}
