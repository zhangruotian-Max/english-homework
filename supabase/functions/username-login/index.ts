const allowedOrigin = "https://zhangruotian-max.github.io";

function responseHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (origin === allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin)
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== allowedOrigin) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!projectUrl || !serviceRoleKey || !anonKey) {
    console.error("Username login function is missing Supabase environment variables.");
    return jsonResponse({ error: "Login service is not configured." }, 500, origin);
  }

  let credentials: { username?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return jsonResponse({ error: "用户名或密码错误。" }, 401, origin);
  }
  if (!credentials || typeof credentials !== "object") {
    return jsonResponse({ error: "用户名或密码错误。" }, 401, origin);
  }

  const username = typeof credentials.username === "string"
    ? credentials.username.trim().toLowerCase()
    : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || password.length < 6 || password.length > 128) {
    return jsonResponse({ error: "用户名或密码错误。" }, 401, origin);
  }

  try {
    const usernameQuery = new URLSearchParams({
      select: "user_id",
      username: `eq.${username}`,
      limit: "1"
    });
    const usernameResponse = await fetch(
      `${projectUrl}/rest/v1/login_usernames?${usernameQuery}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
    if (!usernameResponse.ok) {
      console.error("Username lookup failed:", usernameResponse.status);
      return jsonResponse({ error: "登录服务暂时不可用，请稍后重试。" }, 500, origin);
    }

    const matches = await usernameResponse.json();
    if (!Array.isArray(matches) || typeof matches[0]?.user_id !== "string") {
      return jsonResponse({ error: "用户名或密码错误。" }, 401, origin);
    }

    const userResponse = await fetch(
      `${projectUrl}/auth/v1/admin/users/${encodeURIComponent(matches[0].user_id)}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
    if (!userResponse.ok) {
      console.error("Username account lookup failed:", userResponse.status);
      return jsonResponse({ error: "登录服务暂时不可用，请稍后重试。" }, 500, origin);
    }

    const userResult = await userResponse.json();
    const email = userResult.user?.email || userResult.email;
    if (typeof email !== "string") {
      return jsonResponse({ error: "用户名或密码错误。" }, 401, origin);
    }

    const signInResponse = await fetch(`${projectUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    const signInResult = await signInResponse.json().catch(() => null);
    if (!signInResponse.ok || typeof signInResult?.access_token !== "string" ||
      typeof signInResult?.refresh_token !== "string") {
      return jsonResponse({ error: "用户名或密码错误。" }, 401, origin);
    }

    return jsonResponse({
      access_token: signInResult.access_token,
      refresh_token: signInResult.refresh_token,
      expires_in: signInResult.expires_in,
      expires_at: signInResult.expires_at,
      token_type: signInResult.token_type
    }, 200, origin);
  } catch (error) {
    console.error("Username login request failed:", error);
    return jsonResponse({ error: "登录服务暂时不可用，请稍后重试。" }, 500, origin);
  }
});
