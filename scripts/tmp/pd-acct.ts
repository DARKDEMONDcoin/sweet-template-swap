/** تفاصيل حسابات فيسبوك المربوطة: سبب عدم صحّتها إن وُجد. */
import { pipedreamConfig } from "@/lib/pipedream.server";

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

for (const id of ["apn_wGhnpJ6", "apn_0Wh6WDB", "apn_yghaKmL"]) {
  const r = await fetch(`https://api.pipedream.com/v1/connect/${cfg.projectId}/accounts/${id}`, {
    headers: H,
  });
  console.log(id, r.status, (await r.text()).slice(0, 1200), "\n");
}
