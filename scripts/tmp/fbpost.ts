import { pipedreamConfig, proxyRequest } from "@/lib/pipedream.server";
const cfg = (await pipedreamConfig())!;
const ws = "434b263e-2aa0-4fc6-9759-7cc2675d40e0";
const id = "apn_wGhnpJ6";
const pages = await proxyRequest<any>(cfg, {
  workspaceId: ws,
  accountId: id,
  url: "https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token",
});
const page = pages.data[0];
const q = new URLSearchParams({
  message: `اختبار نشر من سهل ✅ ${new Date().toISOString()}`,
  access_token: page.access_token,
});
try {
  const r = await proxyRequest<any>(cfg, {
    workspaceId: ws,
    accountId: id,
    method: "POST",
    url: `https://graph.facebook.com/v21.0/${page.id}/feed?${q.toString()}`,
  });
  console.log("POSTED", JSON.stringify(r));
} catch (e) {
  console.log("ERR", (e as Error).message.slice(0, 500));
}
