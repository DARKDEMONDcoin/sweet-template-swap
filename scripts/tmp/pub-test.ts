/** اختبار النشر الفعلي من نفس مسار المنتج. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { publishToPlatform } from "@/lib/pipedream-publish.server";

const ws = "434b263e-2aa0-4fc6-9759-7cc2675d40e0";
const provider = process.argv[2] ?? "facebook";
try {
  const r = await publishToPlatform(supabaseAdmin, {
    workspaceId: ws,
    provider,
    text: `اختبار نشر تلقائي من سهل ✅ ${new Date().toISOString()}`,
  });
  console.log("PUBLISHED", provider, JSON.stringify(r).slice(0, 600));
} catch (e) {
  console.log("FAILED", provider, (e as Error).message.slice(0, 600));
}
