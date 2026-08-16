import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useSession } from "@/lib/auth-client.ts";
import { Library } from "@/routes/Library.tsx";
import { Editor } from "@/routes/Editor.tsx";
import { Assets } from "@/routes/Assets.tsx";
import { Login } from "@/routes/Login.tsx";
import { Spinner } from "@/components/ui.tsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Events invalidate what changed, so polling on focus is redundant work.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RequireSession({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!data?.user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login mode="sign-in" />} />
          <Route path="/signup" element={<Login mode="sign-up" />} />
          <Route
            path="/"
            element={
              <RequireSession>
                <Library />
              </RequireSession>
            }
          />
          <Route
            path="/assets"
            element={
              <RequireSession>
                <Assets />
              </RequireSession>
            }
          />
          <Route
            path="/d/:id"
            element={
              <RequireSession>
                <Editor />
              </RequireSession>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
