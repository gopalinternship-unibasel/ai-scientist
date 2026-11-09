// Who is calling an edge function deployed with verify_jwt = false.
//
// embed-feedback and backfill-feedback-embeddings had no auth check at all
// (QA, 9 Nov 2026: both answered 200 to a caller holding only the public
// anon key, and embed-feedback did so for another user's feedback id).
// Their work is idempotent but each call costs embedding-model time, so
// they now identify the caller first:
//   - "service": the Authorization bearer is this project's service-role key
//     (scheduled jobs, scripts run by the operator);
//   - "user": a valid user JWT (with moderator/admin flag from user_roles);
//   - "anon": anything else (no header, the anon key, an invalid JWT).
// A JWT is only trusted after auth.getUser() validates it with the auth
// server; its claims are never read unverified.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface Caller {
  kind: "service" | "user" | "anon";
  userId: string | null;
  isModerator: boolean;
}

/** Constant-time string compare (for secrets). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

export async function identifyCaller(req: Request): Promise<Caller> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = bearer(req);
  if (!token) return { kind: "anon", userId: null, isModerator: false };
  if (serviceKey && constantTimeEqual(token, serviceKey)) return { kind: "service", userId: null, isModerator: true };
  if (token === anonKey) return { kind: "anon", userId: null, isModerator: false };

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data } = await userClient.auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return { kind: "anon", userId: null, isModerator: false };
  const { data: roles } = await userClient.from("user_roles").select("role").eq("user_id", userId);
  const isModerator = (roles ?? []).some((r: { role?: string }) => r.role === "moderator" || r.role === "admin");
  return { kind: "user", userId, isModerator };
}
