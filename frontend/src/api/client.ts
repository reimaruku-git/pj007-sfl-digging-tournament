import { getAuthToken, handleUnauthorized } from "../auth/session";

const rawBase = import.meta.env.VITE_API_BASE || "";
const useDevProxy =
  import.meta.env.DEV && /^https:\/\/[^/]*execute-api\./.test(rawBase);
export const API_BASE = useDevProxy
  ? "/__api/"
  : rawBase.endsWith("/")
    ? rawBase
    : `${rawBase}/`;

export { getAuthToken, handleUnauthorized };

export type ApiResponse<T> = {
  response: Response;
  data: T | null;
};

export type ApiError = {
  error: string;
  message: string;
};

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const token = await getAuthToken();
  const method = String(options.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };
  // JSON Content-Type on GET forces a CORS preflight. Only send it when
  // there is a body (POST/PUT/PATCH) so public reads stay simple requests.
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  if (token) headers["Authorization"] = token;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) {
    await handleUnauthorized();
    return { response, data: null };
  }
  const text = await response.text();
  if (!text) return { response, data: null };
  try {
    return { response, data: JSON.parse(text) as T };
  } catch {
    return { response, data: null };
  }
}

export function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as ApiError).message;
    if (message) return message;
  }
  return fallback;
}
