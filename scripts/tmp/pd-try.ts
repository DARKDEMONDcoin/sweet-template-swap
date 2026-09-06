/** اختبار حيّ: هل يعمل حساب فيسبوك «غير الصحيح» فعلاً عبر الوكيل؟ */
import { pipedreamConfig, proxyRequest } from "@/lib/pipedream.server";

const cfg = (await pipedreamConfig())!;
const ws = "434b263e-2aa0-4fc6-9759-7cc2675d40e0";
for (const id of ["apn_wGhnpJ6", "apn_0Wh6WDB", "apn_yghaKmL"]) {
  try {
    const r = await proxyRequest<any>(cfg, {
      workspaceId: ws,
      accountId: id,
      url: "https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account",
    });
    console.log(id, "OK", JSON.stringify(r).slice(0, 400));
  } catch (e) {
    console.log(id, "FAIL", (e as Error).message.slice(0, 300));
  }
}
