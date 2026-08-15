import { fetchAuthSession, signOut } from "aws-amplify/auth";

export async function getAuthToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function handleUnauthorized(): Promise<void> {
  try {
    await signOut();
  } catch {
    /* already signed out */
  }
  if (window.location.pathname !== "/admin") {
    window.location.href = "/admin";
  }
}
