/**
 * النشر الفعلي على المنصات الاجتماعية عبر إجراءات Pipedream الجاهزة.
 * يُستخدم من دالة الخادم (بطلب المستخدم) ومن الجدولة التلقائية بنفس المنطق.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { pipedreamApp } from "@/data/pipedream-apps";
import {
  pipedreamConfig,
  runAction,
  proxyRequest,
  missingConfigError,
  listAccounts,
  type PipedreamConfig,
} from "./pipedream.server";
import { assertMetaPublishScopes, pageTarget } from "./social-inbox.server";

type Admin = SupabaseClient<Database>;

export type PublishResult = {
  provider: string;
  accountId: string;
  result: unknown;
};

/**
 * معرّف الحساب المربوط: من قاعدتنا أولاً، وإن لم يوجد نسأل Pipedream مباشرة
 * (الربط قد يكون تم للتو أو لم تُشغَّل المزامنة) ونحفظ النتيجة — فلا يفشل النشر
 * بحجة «غير مربوط» بينما الحساب مربوط فعلاً لدى الوسيط.
 */
async function resolveAccountId(
  admin: Admin,
  config: PipedreamConfig,
  workspaceId: string,
  provider: string,
  appSlug?: string,
): Promise<string | null> {
  const { data: stored } = await admin
    .from("pipedream_accounts")
    .select("account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("status", "connected")
    .eq("healthy", true)
    .order("connected_at", { ascending: false })
    .limit(1);
  if (stored?.[0]?.account_id) return stored[0].account_id;
  if (!appSlug) return null;

  let live: Awaited<ReturnType<typeof listAccounts>> = [];
  try {
    live = await listAccounts(config, workspaceId, appSlug);
  } catch (error) {
    console.error("[publish] live account lookup failed", error);
    return null;
  }
  const account = live.find((a) => a.healthy !== false) ?? live[0];
  if (!account) return null;

  const { error: saveError } = await admin.from("pipedream_accounts").upsert(
    {
      workspace_id: workspaceId,
      provider,
      app_slug: appSlug,
      account_id: account.id,
      account_name: account.name ?? null,
      status: account.healthy === false ? "error" : "connected",
      healthy: account.healthy !== false,
    },
    { onConflict: "workspace_id,provider,account_id" },
  );
  if (saveError) throw new Error(`تعذّر حفظ الحساب المربوط: ${saveError.message}`);
  await admin
    .from("integrations")
    .update({ status: "connected", account: account.name ?? appSlug })
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);

  return account.id;
}

export async function publishToPlatform(
  admin: Admin,
  params: {
    workspaceId: string;
    provider: string;
    text: string;
    imageUrl?: string;
    videoUrl?: string;
  },
): Promise<PublishResult> {
  const app = pipedreamApp(params.provider);
  const metaProxy = params.provider === "instagram" || params.provider === "facebook";
  if (!metaProxy && (!app?.publishComponent || !app.accountProp)) {
    throw new Error(`النشر المباشر غير متاح بعد على ${app?.label ?? params.provider}.`);
  }

  const config = await pipedreamConfig();
  if (!config) throw missingConfigError();

  const accountId = await resolveAccountId(
    admin,
    config,
    params.workspaceId,
    params.provider,
    app?.slug,
  );
  if (!accountId)
    throw new Error(`${app?.label ?? params.provider} غير مربوط بعد — اربطه من صفحة التكاملات.`);
  const account = { account_id: accountId };

  // ميتا (إنستجرام/فيسبوك): ننشر عبر Graph API مباشرة من خلال وكيل Pipedream،
  // لأن الإجراءات الجاهزة لا تدعم النص الكامل مع الصورة على إنستجرام.
  if (metaProxy) {
    const result = await publishMeta(
      admin,
      config,
      params.workspaceId,
      account.account_id,
      params.provider as "instagram" | "facebook",
      params.text,
      params.imageUrl,
      params.videoUrl,
    );
    return { provider: params.provider, accountId: account.account_id, result };
  }
  if (!app?.publishComponent || !app.accountProp) {
    throw new Error(`النشر المباشر غير متاح بعد على ${params.provider}.`);
  }

  const props: Record<string, unknown> = {
    [app.accountProp]: { authProvisionId: account.account_id },
    ...textProps(params.provider, params.text),
  };
  if (params.videoUrl)
    throw new Error(
      `نشر الفيديو متاح حالياً على فيسبوك وإنستجرام فقط — على ${app.label} انشر نصاً أو صورة.`,
    );
  if (params.imageUrl) Object.assign(props, imageProps(params.provider, params.imageUrl));

  const result = await runAction(config, {
    workspaceId: params.workspaceId,
    componentId: app.publishComponent,
    configuredProps: props,
  });

  return { provider: params.provider, accountId: account.account_id, result };
}

const GRAPH = "https://graph.facebook.com/v21.0";

/** نشر على إنستجرام (حاوية ثم نشر) أو على صفحة فيسبوك — عبر وكيل Pipedream. */
async function publishMeta(
  admin: Admin,
  config: PipedreamConfig,
  workspaceId: string,
  accountId: string,
  provider: "instagram" | "facebook",
  text: string,
  imageUrl?: string,
  videoUrl?: string,
): Promise<unknown> {
  // نتحقق أولاً أن الربط يملك صلاحية النشر — وإلا نشرح السبب والحل بوضوح.
  await assertMetaPublishScopes(config, workspaceId, accountId, provider);
  const { data: link } = await admin
    .from("pipedream_accounts")
    .select("page_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("account_id", accountId)
    .limit(1);
  const page = await pageTarget(config, workspaceId, accountId, link?.[0]?.page_id ?? undefined);
  if (!page)
    throw new Error(
      "تعذّر تحديد الصفحة المرتبطة بحسابك على ميتا — تأكد أنك مسؤول عن الصفحة ثم أعد الربط.",
    );
  if (!link?.[0]?.page_id) {
    const { error: pageSaveError } = await admin
      .from("pipedream_accounts")
      .update({ page_id: page.id, instagram_business_id: page.igId ?? null })
      .eq("workspace_id", workspaceId)
      .eq("provider", provider)
      .eq("account_id", accountId);
    if (pageSaveError)
      console.error("[publish] failed to persist Meta page selection", pageSaveError);
  }

  if (provider === "facebook") {
    // فيديو من جهاز المستخدم: يُرفع إلى الصفحة عبر رابطه العام.
    if (videoUrl) {
      return proxyRequest<unknown>(config, {
        workspaceId,
        accountId,
        method: "POST",
        url: `https://graph-video.facebook.com/v21.0/${page.id}/videos?${new URLSearchParams({
          file_url: videoUrl,
          description: text,
          access_token: page.token,
        }).toString()}`,
      });
    }
    // مع صورة: نرفعها كصورة حقيقية على /photos (لا كمعاينة رابط في /feed).
    if (imageUrl) {
      return proxyRequest<unknown>(config, {
        workspaceId,
        accountId,
        method: "POST",
        url: `${GRAPH}/${page.id}/photos?${new URLSearchParams({
          url: imageUrl,
          caption: text,
          published: "true",
          access_token: page.token,
        }).toString()}`,
      });
    }
    return proxyRequest<unknown>(config, {
      workspaceId,
      accountId,
      method: "POST",
      url: `${GRAPH}/${page.id}/feed?${new URLSearchParams({
        message: text,
        access_token: page.token,
      }).toString()}`,
    });
  }

  if (!page.igId) throw new Error("لا يوجد حساب إنستجرام احترافي مرتبط بالصفحة.");
  if (!imageUrl && !videoUrl) throw new Error("إنستجرام يتطلب صورة أو فيديو مع المنشور.");

  const container = await proxyRequest<{ id?: string }>(config, {
    workspaceId,
    accountId,
    method: "POST",
    url: `${GRAPH}/${page.igId}/media?${new URLSearchParams({
      ...(videoUrl ? { media_type: "REELS", video_url: videoUrl } : { image_url: imageUrl! }),
      caption: text,
      access_token: page.token,
    }).toString()}`,
  });
  if (!container.id) throw new Error("تعذّر تجهيز منشور إنستجرام.");

  // الفيديو (Reels) يحتاج وقتاً للمعالجة قبل النشر — ننتظر الجاهزية حتى ٩٠ ثانية.
  if (videoUrl) {
    for (let i = 0; i < 18; i += 1) {
      await new Promise((r) => setTimeout(r, 5_000));
      const st = await proxyRequest<{ status_code?: string }>(config, {
        workspaceId,
        accountId,
        url: `${GRAPH}/${container.id}?fields=status_code&access_token=${page.token}`,
      });
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR")
        throw new Error("إنستجرام رفض الفيديو — استخدم MP4 عمودياً (9:16) أقل من ٩٠ ثانية.");
    }
  }

  return proxyRequest<unknown>(config, {
    workspaceId,
    accountId,
    method: "POST",
    url: `${GRAPH}/${page.igId}/media_publish?${new URLSearchParams({
      creation_id: container.id,
      access_token: page.token,
    }).toString()}`,
  });
}

/** اسم حقل النص يختلف بين إجراءات كل منصة. */
function textProps(provider: string, text: string): Record<string, string> {
  switch (provider) {
    case "x":
      return { text: text.slice(0, 280) };
    case "linkedin":
      return { text };
    case "slack":
      return { text };
    case "gmail":
      return { body: text };
    case "pinterest":
      return { title: text.split("\n")[0]!.slice(0, 90), description: text.slice(0, 480) };
    default:
      return { text };
  }
}

function imageProps(provider: string, imageUrl: string): Record<string, string> {
  switch (provider) {
    case "pinterest":
      return { imageUrl, mediaSource: imageUrl };
    default:
      return { imageUrl };
  }
}
