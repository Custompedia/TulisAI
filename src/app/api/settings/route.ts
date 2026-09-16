import { z } from "zod";
import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { runtime } from "@/server/runtime";

const Settings = z.object({
  interfaceLanguage: z.enum(["id", "en"]),
  writingLanguage: z.enum(["auto", "id", "en"]),
  defaultMode: z.enum(["P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL", "P05_CREATIVE", "P06_SIMPLIFY"]),
  primaryUseCase: z.enum(["academic", "professional", "general"]).default("general"),
  humanizerContext: z.enum(["academic", "professional", "general"]).default("general"),
  localDrafts: z.boolean().default(true),
});

type Row = { interface_language: "id" | "en"; writing_language: "auto" | "id" | "en"; default_mode: string; primary_use_case: string; humanizer_context: string; local_drafts: number; onboarded_at: number | null; updated_at: number };

async function get(userId: string) {
  const row = await runtime().DB.prepare("SELECT interface_language,writing_language,default_mode,primary_use_case,humanizer_context,local_drafts,onboarded_at,updated_at FROM user_preferences WHERE user_id=?").bind(userId).first<Row>();
  if (!row) return { interfaceLanguage: "id", writingLanguage: "auto", defaultMode: "P03_HUMANIZER", primaryUseCase: "general", humanizerContext: "general", localDrafts: true, onboarded: false, updatedAt: null };
  return { interfaceLanguage: row.interface_language, writingLanguage: row.writing_language, defaultMode: row.default_mode, primaryUseCase: row.primary_use_case, humanizerContext: row.humanizer_context, localDrafts: Boolean(row.local_drafts), onboarded: row.onboarded_at !== null, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function GET(request: Request) {
  try { const user = await requireUser(request); return jsonData(await get(user.id)); } catch (error) { return handleRouteError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request); idempotencyKey(request);
    const value = await readJson(request, Settings); const now = Date.now();
    await runtime().DB.prepare("INSERT INTO user_preferences (user_id,interface_language,writing_language,default_mode,primary_use_case,humanizer_context,local_drafts,onboarded_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET interface_language=excluded.interface_language,writing_language=excluded.writing_language,default_mode=excluded.default_mode,primary_use_case=excluded.primary_use_case,humanizer_context=excluded.humanizer_context,local_drafts=excluded.local_drafts,onboarded_at=COALESCE(user_preferences.onboarded_at,excluded.onboarded_at),updated_at=excluded.updated_at")
      .bind(user.id, value.interfaceLanguage, value.writingLanguage, value.defaultMode, value.primaryUseCase, value.humanizerContext, value.localDrafts ? 1 : 0, now, now).run();
    return jsonData(await get(user.id));
  } catch (error) { return handleRouteError(error); }
}
