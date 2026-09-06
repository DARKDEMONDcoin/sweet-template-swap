import { pipedreamConfig, proxyRequest } from "@/lib/pipedream.server";
const cfg = (await pipedreamConfig())!;
const ws = "434b263e-2aa0-4fc6-9759-7cc2675d40e0";
for (const id of ["apn_wGhnpJ6", "apn_0Wh6WDB", "apn_yghaKmL"]) {
  const r = await proxyRequest<any>(cfg, {
    workspaceId: ws,
    accountId: id,
    url: "https://graph.facebook.com/v21.0/me/permissions",
  }).catch((e) => ({ err: (e as Error).message }));
  console.log(id, JSON.stringify(r).slice(0, 600));
}
