/**
 * Sign in, and the way back to an OAuth authorization.
 *
 * `?next=` is how `creative login` gets through: the CLI opens
 * /oauth/authorize, the API bounces here when there is no session, and the
 * consent screen is where this sends the browser once there is one.
 */
import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { signIn, signUp } from "@/lib/auth-client.ts";
import { Button, Input, Spinner } from "@/components/ui.tsx";

export function Login({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === "sign-in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name || email.split("@")[0]! });

    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That did not work.");
      return;
    }

    // A full navigation, not a client route: `next` points at /oauth/authorize,
    // which the API renders itself and the router knows nothing about.
    if (next) window.location.href = next;
    else navigate("/");
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-lg font-semibold tracking-tight">creative</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {next
          ? "Sign in to authorize the CLI on this machine."
          : "Marketplace creatives as documents."}
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
        {mode === "sign-up" ? (
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        ) : null}
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          required
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <Button type="submit" disabled={busy} className="mt-1">
          {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-neutral-500">
        {mode === "sign-in" ? (
          <>
            No account?{" "}
            <Link className="text-neutral-900 underline" to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
              Create one
            </Link>
          </>
        ) : (
          <>
            Already have one?{" "}
            <Link className="text-neutral-900 underline" to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
