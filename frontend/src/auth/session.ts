let amplifyReady = false;

export function markAuthConfigured(): void {
  amplifyReady = true;
}

export function isAuthConfigured(): boolean {
  return amplifyReady;
}

export async function getAuthToken(forceRefresh = false): Promise<string | null> {
  if (!amplifyReady) return null;
  try {
    const { fetchAuthSession } = await import("aws-amplify/auth");
    const session = await fetchAuthSession({ forceRefresh });
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

function onAdminPath(): boolean {
  return window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
}

export async function handleUnauthorized(): Promise<void> {
  if (!onAdminPath()) return;
  if (!amplifyReady) return;
  try {
    const { signOut } = await import("aws-amplify/auth");
    await signOut();
  } catch {
    /* already signed out */
  }
}
