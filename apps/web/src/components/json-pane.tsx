/**
 * The document, literally.
 *
 * The inspector is a set of controls over a subset of the schema; this is the whole
 * schema with nothing in front of it. It exists because the schema will always be
 * wider than the panel — new fields land in core first — and because the honest
 * answer to "what will the CLI see?" is to show it.
 *
 * Nothing is validated here beyond `JSON.parse`. The API runs the same zod schema
 * the renderer does and answers with a path and an expectation, so the error shown
 * under the pane is the real one rather than a guess made in the browser.
 */
import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui.tsx";
import type { CreativeDocument } from "@/lib/api.ts";
import { cn } from "@/lib/cn.ts";

const format = (doc: CreativeDocument) => JSON.stringify(doc, null, 2);

export function JsonPane({
  doc,
  onApply,
  saving,
  rejected,
}: {
  doc: CreativeDocument;
  onApply: (doc: CreativeDocument) => void;
  saving: boolean;
  /** What the API said when it refused the last document, if it did. */
  rejected?: string;
}) {
  const original = format(doc);
  const [draft, setDraft] = useState(original);
  const [malformed, setMalformed] = useState<string | null>(null);
  const dirty = draft !== original;

  const apply = () => {
    let parsed: CreativeDocument;
    try {
      parsed = JSON.parse(draft) as CreativeDocument;
    } catch (err) {
      setMalformed(err instanceof Error ? err.message : "That is not JSON");
      return;
    }
    setMalformed(null);
    onApply(parsed);
  };

  // A refusal is shown against the text that caused it, which is by definition text
  // that differs from the saved document — so it cannot be hidden while dirty, or it
  // would never be shown at all. The mutation clears its own error on the next try.
  const error = malformed ?? rejected;

  return (
    <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setMalformed(null);
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === "s")) {
            e.preventDefault();
            apply();
            return;
          }
          // Tab indents rather than leaving the field: this is a code editor for
          // as long as the caret is inside it.
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = el;
            const next = `${draft.slice(0, a)}  ${draft.slice(b)}`;
            setDraft(next);
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
          }
        }}
        className={cn(
          "min-h-0 flex-1 resize-none rounded-lg border bg-white p-3 font-mono text-xs leading-relaxed",
          "outline-none focus:ring-2 focus:ring-neutral-400",
          error ? "border-red-300" : "border-neutral-200",
        )}
        aria-label="The document as JSON"
      />

      {error ? (
        <pre className="max-h-32 shrink-0 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </pre>
      ) : null}

      <div className="flex shrink-0 items-center gap-2">
        <span className="flex-1 text-xs text-neutral-500">
          {rejected && !malformed
            ? "Refused — the design is still on its last good version"
            : dirty
              ? "Unsaved — ⌘↵ to apply"
              : "This is exactly what the CLI and the renderer read"}
        </span>
        {dirty ? (
          <Button variant="ghost" size="sm" onClick={() => { setDraft(original); setMalformed(null); }}>
            <RotateCcw className="h-3.5 w-3.5" />
            revert
          </Button>
        ) : null}
        <Button size="sm" disabled={!dirty || saving} onClick={apply}>
          <Check className="h-3.5 w-3.5" />
          {saving ? "applying…" : "apply"}
        </Button>
      </div>
    </div>
  );
}
