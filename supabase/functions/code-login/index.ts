import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WINDOW_MS = 10 * 60 * 1000;
const IP_LIMIT = 8;
const IDENTIFIER_LIMIT = 20;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(origin: string | null) {
  const allowed = !!origin &&
    (/^https:\/\/im-tarooo\.github\.io$/.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

  return {
    "Access-Control-Allow-Origin": allowed
      ? origin
      : "https://im-tarooo.github.io",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Metode tidak didukung." }, 405, origin);
  }

  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(
          { ok: false, error: "Permintaan tidak valid." },
          400,
          origin,
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "Permintaan tidak valid." }, 400, origin);
    }

    const code = normalizeCode(body.code);
    const token = typeof body.token === "string"
      ? body.token.trim().toLowerCase()
      : "";
    const isCode = code.length === 5;
    const isToken = /^[a-f0-9]{64}$/.test(token);

    if (!isCode && !isToken) {
      return json({ ok: false, error: "Kode akses tidak valid." }, 400, origin);
    }

    const ip = (req.headers.get("x-forwarded-for") ||
      req.headers.get("cf-connecting-ip") || "unknown")
      .split(",")[0]
      .trim() || "unknown";
    const identifier = await sha256(isCode ? `code:${code}` : `token:${token}`);
    const since = new Date(Date.now() - WINDOW_MS).toISOString();

    const [ipAttempts, identifierAttempts] = await Promise.all([
      admin
        .from("access_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .eq("success", false)
        .gte("attempted_at", since),
      admin
        .from("access_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("identifier", identifier)
        .eq("success", false)
        .gte("attempted_at", since),
    ]);

    if (ipAttempts.error || identifierAttempts.error) {
      console.error(
        "rate limit query failed",
        ipAttempts.error || identifierAttempts.error,
      );
      return json(
        { ok: false, error: "Gagal memeriksa batas percobaan." },
        500,
        origin,
      );
    }

    if (
      (ipAttempts.count || 0) >= IP_LIMIT ||
      (identifierAttempts.count || 0) >= IDENTIFIER_LIMIT
    ) {
      return json(
        {
          ok: false,
          error: "Terlalu banyak percobaan. Coba lagi dalam 10 menit.",
        },
        429,
        origin,
      );
    }

    const recordAttempt = async (success: boolean) => {
      await admin.from("access_login_attempts").insert({
        identifier,
        ip,
        success,
      });
    };

    const accessQuery = admin
      .from("household_access")
      .select("household_id, owner_user_id")
      .eq(isCode ? "code" : "token", isCode ? code : token)
      .maybeSingle();

    const accessResult = await accessQuery;
    if (accessResult.error) {
      console.error("access lookup failed", accessResult.error);
      return json({ ok: false, error: "Gagal memproses kode." }, 500, origin);
    }

    if (!accessResult.data) {
      await recordAttempt(false);
      return json({ ok: false, error: "Kode akses tidak valid." }, 401, origin);
    }

    const access = accessResult.data;

    const memberResult = await admin
      .from("household_members")
      .select("role")
      .eq("household_id", access.household_id)
      .eq("user_id", access.owner_user_id)
      .maybeSingle();

    if (
      memberResult.error ||
      !memberResult.data ||
      memberResult.data.role !== "owner"
    ) {
      await recordAttempt(false);
      return json({ ok: false, error: "Kode akses tidak aktif." }, 401, origin);
    }

    const ownerResult = await admin.auth.admin.getUserById(
      access.owner_user_id,
    );
    const email = ownerResult.data?.user?.email;

    if (ownerResult.error || !email) {
      await recordAttempt(false);
      return json(
        { ok: false, error: "Akun pemilik kode tidak ditemukan." },
        400,
        origin,
      );
    }

    const linkResult = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    const tokenHash = linkResult.data?.properties?.hashed_token;
    if (linkResult.error || !tokenHash) {
      console.error("generateLink failed", linkResult.error);
      await recordAttempt(false);
      return json(
        { ok: false, error: "Gagal membuat sesi login." },
        500,
        origin,
      );
    }

    await recordAttempt(true);

    await admin
      .from("access_login_attempts")
      .delete()
      .lt(
        "attempted_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      );

    return json(
      {
        ok: true,
        token_hash: tokenHash,
        household_id: access.household_id,
      },
      200,
      origin,
    );
  } catch (error) {
    console.error("code-login error", error);
    return json(
      { ok: false, error: "Terjadi kesalahan pada server." },
      500,
      origin,
    );
  }
});
