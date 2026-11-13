import { supabase } from "@/integrations/supabase/client";

export class RetailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RetailApiError";
  }
}

export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof RetailApiError) {
    if (error.status === 0)
      return "Could not reach DailyPlazaa. Check your connection and try again.";
    if (error.status === 401) return "Your staff session has ended. Sign in again to continue.";
    if (error.status === 429) return "Too many attempts. Wait a moment, then try again.";
    if (error.status === 503) return error.message || fallback;
    if (error.status >= 500) return fallback;
    return error.message || fallback;
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" ||
      /failed to fetch|fetch failed|networkerror|econn(?:refused|reset|timeout)/i.test(
        error.message,
      ))
  )
    return "Could not reach DailyPlazaa. Check your connection and try again.";
  return fallback;
}

export async function retailApi<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const { json, ...requestInit } = init;
  if (!headers.has("Authorization")) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  let body = requestInit.body;
  if ("json" in init) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }
  const options: RequestInit = {
    ...requestInit,
    headers,
    credentials: "same-origin",
  };
  if (body !== undefined) options.body = body;
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new RetailApiError(
      "Could not reach DailyPlazaa. Check your connection and try again.",
      0,
    );
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    throw new RetailApiError(
      message || `DailyPlazaa request failed (${response.status}).`,
      response.status,
    );
  }
  if (payload === null) throw new RetailApiError("DailyPlazaa returned an invalid response.", 500);
  return payload as T;
}
