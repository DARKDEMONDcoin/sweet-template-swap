/** فحص شامل لكل تطبيقات الوسيط: وجود الـ slug، ملفات الصلاحيات، والحسابات المربوطة. */
import { pipedreamConfig } from "@/lib/pipedream.server";
import { pipedreamApps } from "@/data/pipedream-apps";

const cfg = (await pipedreamConfig())!;
const tok = (await fetch("https://api.pipedream.com/v1/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  }),
}).then((r) => r.json())) as { access_token: string };

const H = { Authorization: `Bearer ${tok.access_token}`, "x-pd-environment": cfg.environment };

console.log("env", cfg.environment, "project", cfg.projectId);

for (const app of pipedreamApps) {
  const r = await fetch(`https://api.pipedream.com/v1/apps/${app.slug}`, { headers: H });
  const j = (await r.json().catch(() => ({}))) as any;
  const profiles = (j.data?.scope_profiles ?? []).map(
    (p: any) => `${p.name}[${(p.scopes ?? []).length}]`,
  );
  console.log(
    `${r.status === 200 ? "OK " : "MISS"} ${app.provider.padEnd(16)} ${app.slug.padEnd(26)} auth=${j.data?.auth_type ?? "-"} profiles=${profiles.join(",") || "-"}`,
  );
}

for (const ws of ["434b263e-2aa0-4fc6-9759-7cc2675d40e0", "39cb8b38-4cfc-4703-a264-610150fc9af6"]) {
  const r = await fetch(
    `https://api.pipedream.com/v1/connect/${cfg.projectId}/accounts?external_user_id=ws_${ws}`,
    { headers: H },
  );
  const j = (await r.json()) as any;
  console.log(
    `\nws ${ws}:`,
    (j.data ?? [])
      .map((a: any) => `${typeof a.app === "string" ? a.app : a.app?.name_slug}/${a.id}/healthy=${a.healthy}`)
      .join("\n  ") || "(none)",
  );
}
