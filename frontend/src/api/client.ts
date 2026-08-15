import { getAuthToken, handleUnauthorized } from "../auth/session";

const rawBase = import.meta.env.VITE_API_BASE || "";
export const API_BASE = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;

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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
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
