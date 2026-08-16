import { createAuthClient } from "better-auth/react";

/** Same origin in production, proxied through Vite in dev — so no baseURL. */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
