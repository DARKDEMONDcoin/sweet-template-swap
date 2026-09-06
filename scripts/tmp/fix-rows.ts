import { supabaseAdmin } from "@/integrations/supabase/client.server";
const { data, error } = await supabaseAdmin
  .from("pipedream_accounts")
  .select("workspace_id, provider, account_id, status, healthy, last_error");
console.log(error?.message ?? JSON.stringify(data, null, 1));
const { data: ints } = await supabaseAdmin
  .from("integrations")
  .select("workspace_id, provider, status, account")
  .neq("status", "disconnected");
console.log(JSON.stringify(ints));
