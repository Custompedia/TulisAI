import { runtime, requiredSetting, ConfigurationError } from '../runtime';
import { entitlement, periodKey, type Entitlement } from '../usage/quota';
import { assertFeature } from '../usage/features';
import { RequestError } from '../http';
import { currentText, getDocument, replaceTextInDocument, saveDocument } from '../documents/service';
import { listLocks } from '../documents/locks';
import { createOpenRouterProvider, exceedsPreservation, isCondensed, OutputRejected, rejectionOf, snapsToSource, mergeWarnings, normalizeRuntime, placeholderTokens, requestOf, softWarnings, structuralErrors, PROMPT_VERSION, REASONING_EFFORT, validateAIResponse, validateGeneration, validateProtectedContent, validateLockedTerms, type AIResponse, type PromptId, type RuntimeInput, type ProviderResult } from './core';
import { sanitizeSuggestedTitle } from '@/lib/writing/title';
import { sanitizeInstruction } from '@/lib/writing/instruction';
import { AI_SCOPE_LIMIT, INLINE_LIMIT } from '@/lib/writing/settings';
import type { PlanLimits } from '@/lib/plans';
import {collapseBlankLines} from '@/lib/editor/document';
import {detectedCitations} from '@/lib/editor/protection';
import type { AnalyzeQualityInput, GenerateInput } from '@/lib/contracts';

const DAY = 86_400_000;
const model = () => runtime().OPENROUTER_MODEL?.trim() || 'openai/gpt-5.6-luna';
const outputText = (output: AIResponse, selectedAlternative?: number): string => {
  if (Array.isArray(output.alternatives)) {
    if (selectedAlternative === undefined || !output.alternatives[selectedAlternative]) throw new RequestError('INVALID_ALTERNATIVE', 'Choose an available alternative.');
    return String(output.alternatives[selectedAlternative].text);
  }
  return String(output.transformed_text ?? output.corrected_text ?? '');
};
// The monthly cap is characters, held in charge_characters so one covering-index SUM sees both in-flight and settled usage.
// billable=false still writes the row (observability, burst guard) but holds nothing: the user never pays for our own repair pass.
async function reserve(ownerId: string, key: string, promptId: string, characters: number, rights: Entitlement, billable = true) {
  // Admins bypass the monthly cap by comparing against a limit no ledger can reach; the 10-per-minute burst guard stays.
  const limit = rights.unlimited ? Number.MAX_SAFE_INTEGER : rights.characterLimit;
  const charge = billable ? characters : 0;
  const existing = await runtime().DB.prepare('SELECT id FROM usage_ledger WHERE owner_id=? AND idempotency_key=?').bind(ownerId, key).first();
  if (existing) throw new RequestError('IDEMPOTENCY_PENDING', 'This request was already attempted. Check its result before retrying.', 409);
  const id = crypto.randomUUID();
  try {
    const result = await runtime().DB.prepare("INSERT INTO usage_ledger (id,owner_id,idempotency_key,operation,status,period_key,request_id,created_at,prompt_id,source_characters,charge_characters) SELECT ?,?,?,?,'reserved',?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(charge_characters),0) FROM usage_ledger WHERE owner_id=? AND period_key=?) + ? <= ? AND (SELECT COUNT(1) FROM usage_ledger WHERE owner_id=? AND created_at>?) < 10")
      .bind(id, ownerId, key, promptId === 'P10_REPAIR' ? 'repair' : promptId === 'P09_QUALITY_EVALUATION' ? 'analyze' : 'generate', periodKey(), id, Date.now(), promptId, characters, charge, ownerId, periodKey(), charge, limit, ownerId, Date.now() - 60_000).run();
    if (result.meta.changes !== 1) throw new RequestError('QUOTA_EXCEEDED', 'Monthly character quota reached. Shorten the text or review your usage.', 429);
    return id;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    const raced = await runtime().DB.prepare('SELECT id FROM usage_ledger WHERE owner_id=? AND idempotency_key=?').bind(ownerId, key).first();
    if (raced) throw new RequestError('IDEMPOTENCY_PENDING', 'This request is already being processed.', 409);
    throw new RequestError('USAGE_UNAVAILABLE', 'Usage reservation could not be created.', 503);
  }
}
// A failed provider call releases its hold in the same statement that marks it failed, so nothing is charged for it.
async function completeUsage(id: string, result: ProviderResult, started: number) {
  await runtime().DB.prepare("UPDATE usage_ledger SET status=?,completed_at=?,provider_request_id=?,input_tokens=?,output_tokens=?,cost_usd=?,latency_ms=?,error_code=?,charge_characters=CASE WHEN ?=1 THEN charge_characters ELSE 0 END WHERE id=? AND status='reserved'")
    .bind(result.ok ? 'completed' : 'failed', Date.now(), result.usage?.providerRequestId ?? null, result.usage?.inputTokens ?? null, result.usage?.outputTokens ?? null, result.usage?.costUsd ?? null, Date.now() - started, result.ok ? null : result.error, result.ok ? 1 : 0, id).run();
}
// The provider call succeeded but the result was refused, so the hold is released and the reason recorded.
async function voidUsage(id: string, reason: string) {
  await runtime().DB.prepare('UPDATE usage_ledger SET charge_characters=0,error_code=? WHERE id=?').bind(reason.slice(0, 120), id).run().catch(() => undefined);
}
async function cleanExpired(ownerId: string) {
  await runtime().DB.prepare("UPDATE transformations SET source_text='',output_json='{}',runtime_json='{}',anchor_json=NULL,status='expired' WHERE id IN (SELECT id FROM transformations WHERE owner_id=? AND status IN ('preview','applied','discarded') AND expires_at<=? ORDER BY expires_at LIMIT 100)").bind(ownerId, Date.now()).run();
}
function requestedFormat(promptId: PromptId, controls: RuntimeInput): 'bullets'|'numbered_list'|'table'|undefined {
  if (promptId === 'P07_INLINE_ALTERNATIVES') return undefined;
  return ({poin:'bullets',bernomor:'numbered_list',tabel:'table'} as const)[String(controls.request?.format) as 'poin'|'bernomor'|'tabel'];
}
// Paraphrase runs share one per-tier budget whether the scope is a selection or the whole notebook; inline actions keep their own small cap.
export function scopeLimit(promptId: PromptId, anchored: boolean, limits: PlanLimits) {
  if (promptId === 'P07_INLINE_ALTERNATIVES') return INLINE_LIMIT;
  return Math.min(limits.runLimit, anchored ? limits.runLimit : AI_SCOPE_LIMIT);
}

export async function generatePreview(ownerId: string, key: string, input: GenerateInput) {
  if (runtime().AI_PUBLIC_ENABLED !== 'true') throw new ConfigurationError('AI is unavailable until provider privacy configuration is verified.');
  const apiKey = requiredSetting(runtime().OPENROUTER_API_KEY, 'OPENROUTER_API_KEY');
  await cleanExpired(ownerId);
  const existing = await runtime().DB.prepare('SELECT id,document_id,prompt_id,source_revision,source_text,output_json,status,expires_at FROM transformations WHERE owner_id=? AND idempotency_key=?').bind(ownerId, key)
    .first<{id:string;document_id:string;prompt_id:string;source_revision:number;source_text:string;output_json:string;status:string;expires_at:number}>();
  if (existing) {
    if (existing.document_id !== input.documentId || existing.prompt_id !== input.promptId || existing.source_revision !== input.expectedRevision || existing.source_text !== input.source.text) throw new RequestError('IDEMPOTENCY_CONFLICT', 'This request key belongs to another transformation.', 409);
    if (existing.status === 'preview' && existing.expires_at > Date.now()) return {id:existing.id, output:JSON.parse(existing.output_json), expiresAt:new Date(existing.expires_at).toISOString(), reused:true};
    throw new RequestError('PREVIEW_EXPIRED', 'This request has already finished or expired.', 410);
  }
  const rights = await entitlement(ownerId);
  // A free-form instruction is a paid, paragraph-scoped action: it needs an anchor, runs as a custom transform,
  // and never bypasses a guard. Everything below applies to it unchanged.
  const instruction = sanitizeInstruction(input.instruction);
  if (instruction) {
    assertFeature(rights, 'freeform_prompt');
    if (!input.source.anchor) throw new RequestError('INVALID_REQUEST', 'A free-form instruction needs a selected passage.');
    if (input.promptId !== 'P08_CUSTOM_TRANSFORM') throw new RequestError('INVALID_REQUEST', 'A free-form instruction runs as a custom transform.');
  }
  const limit = scopeLimit(input.promptId, Boolean(input.source.anchor), rights.limits);
  if (input.source.text.length > limit) throw new RequestError('SCOPE_TOO_LARGE', `Select at most ${limit} characters for this AI action.`, 422, {limit, length: input.source.text.length});
  const source = await currentText(ownerId, input.documentId);
  if (source.document.revision !== input.expectedRevision) throw new RequestError('REVISION_CONFLICT', 'The document changed before generation.', 409);
  const anchor = input.source.anchor;
  if (anchor && (anchor.from >= anchor.to || anchor.to > source.text.length)) throw new RequestError('SOURCE_MISMATCH', 'The selected source is invalid.', 409);
  if ((anchor ? source.text.slice(anchor.from, anchor.to) : source.text) !== input.source.text || !input.source.text.trim()) throw new RequestError('SOURCE_MISMATCH', 'The selected source no longer matches the saved document.', 409);
  if (input.promptId === 'P07_INLINE_ALTERNATIVES' && !anchor) throw new RequestError('INVALID_REQUEST', 'Inline alternatives require a selection.');
  if (input.runtime.language !== 'en' && input.runtime.language !== 'id') throw new RequestError('INVALID_REQUEST', 'Choose a supported writing language.');
  const locks = await listLocks(ownerId, input.documentId);
  if(input.promptId==='P07_INLINE_ALTERNATIVES'&&locks.some(lock=>lock.term===input.source.text))throw new RequestError('PROTECTED_SELECTION','A locked term cannot be replaced.',422);
  const citations = detectedCitations(input.source.text);
  // A dock instruction is free to change anything it asks for; only terms the author locked still bind it.
  const freeform = input.promptId === 'P08_CUSTOM_TRANSFORM';
  // A title is asked for only on the first run of a whole new notebook, and never for an inline selection.
  const wantsTitle = input.suggestTitle === true && !anchor && input.promptId !== 'P07_INLINE_ALTERNATIVES';
  const trusted: RuntimeInput = {...input.runtime, userInstruction:instruction, user_instruction:undefined, suggestTitle:wantsTitle || undefined, suggest_title:undefined, sourceText:input.source.text, selectedText:input.source.text, contextBefore:anchor ? source.text.slice(Math.max(0,anchor.from-300),anchor.from) : null, contextAfter:anchor ? source.text.slice(anchor.to,anchor.to+300) : null, protectedTerms:locks.map(lock=>lock.term).filter(term=>input.source.text.includes(term)), protectedCitations:freeform ? [] : [...new Set(citations)], language:input.runtime.language};
  let controls: RuntimeInput;
  try { controls = normalizeRuntime(input.promptId, trusted) as RuntimeInput; } catch { throw new RequestError('INVALID_REQUEST', 'The selected AI controls are invalid.'); }
  const provider = createOpenRouterProvider({apiKey,model:model(),privacyMode:'deny'});
  let mainUsageId = '';
  const call = async (promptId: PromptId, callKey: string, runtimeControls: RuntimeInput, repair=false, requiredTerms=trusted.protectedTerms) => {
    const usageId = await reserve(ownerId, callKey, promptId, input.source.text.length, rights, !repair);
    if (!repair && !mainUsageId) mainUsageId = usageId;
    const started = Date.now();
    const result = await provider.generate({promptId,runtime:runtimeControls,sourceText:input.source.text,requestId:usageId,protectedTerms:requiredTerms,protectedCitations:trusted.protectedCitations,...(repair?{repairAttempt:1}:{})});
    await completeUsage(usageId,result,started);
    if (!result.ok) throw new RequestError('AI_UNAVAILABLE', 'AI generation could not be completed safely. Your source is unchanged.', 502);
    return result.response;
  };
  // Set once the main hold has been released, so the catch-all below does not overwrite a specific reason.
  let released = false;
  const release = async (reason: string) => { if (mainUsageId && !released) { released = true; await voidUsage(mainUsageId, `rejected:${reason}`); } };
  const rejected = async (reason: string, error: RequestError) => { await release(reason); return error; };
  // Names the cause so the user is told what actually blocked the result instead of one message for every case.
  const REJECTION_CODES: Record<string, string> = { term: 'AI_LOCKED_TERM_REJECTED', number: 'AI_NUMBER_REJECTED', citation: 'AI_CITATION_REJECTED', placeholder: 'AI_PLACEHOLDER_REJECTED', style: 'STYLE_SAMPLE_COPIED', structure: 'AI_STRUCTURE_REJECTED' };
  const REJECTION_MESSAGES: Record<string, string> = {
    AI_LOCKED_TERM_REJECTED: 'AI output dropped a locked term. Your source is unchanged.',
    AI_NUMBER_REJECTED: 'AI output changed a number. Your source is unchanged.',
    AI_CITATION_REJECTED: 'AI output altered or invented a citation. Your source is unchanged.',
    AI_PLACEHOLDER_REJECTED: 'AI output dropped a placeholder. Your source is unchanged.',
    STYLE_SAMPLE_COPIED: 'The result copied the style sample. Your source is unchanged.',
    AI_STRUCTURE_REJECTED: 'AI output changed the text structure. Your source is unchanged.',
  };
  const refuse = async (error: unknown, fallbackReason: string) => {
    const reason = error instanceof Error ? error.message : fallbackReason;
    const typed = error instanceof OutputRejected ? error : null;
    const code = (typed && REJECTION_CODES[typed.cause]) ?? (/paragraph count|shorter than/.test(reason) ? 'AI_STRUCTURE_REJECTED' : 'AI_OUTPUT_REJECTED');
    const message = REJECTION_MESSAGES[code] ?? 'AI output did not pass safety checks. Your source is unchanged.';
    return rejected(reason, new RequestError(code, message, 422, typed?.token ? { token: typed.token } : undefined));
  };
  let output = await call(input.promptId,key,controls);
  try {
  // Taken before the schema-strict passes below drop it; an invalid or missing label just falls back to the local title.
  const suggestedTitle = wantsTitle ? sanitizeSuggestedTitle(output.suggested_title) : null;
  if (input.promptId === 'P07_INLINE_ALTERNATIVES') {
    try { output = validateGeneration(input.promptId,input.source.text,output,trusted); }
    catch (error) { throw await rejected(error instanceof Error ? error.message : 'p07', new RequestError('AI_OUTPUT_REJECTED', 'No safe set of alternatives was returned. Your source is unchanged.', 422)); }
  } else {
    output = validateAIResponse(input.promptId,output);
    // The flag is the model's verdict, so the saved source is what the preview shows.
    if (output.no_change_needed === true && snapsToSource(input.source.text,outputText(output))) output = {...output,transformed_text:input.source.text};
    const structure = structuralErrors(input.promptId,input.source.text,outputText(output),requestOf(input.promptId,controls));
    if (structure.length) throw await rejected(structure.join('; '), new RequestError('AI_STRUCTURE_REJECTED', 'AI output changed the text structure. Your source is unchanged.', 422));
    const placeholders = input.promptId === 'P04_PROFESSIONAL';
    const protection = freeform ? validateLockedTerms(input.source.text,outputText(output),trusted.protectedTerms??[]) : validateProtectedContent(input.source.text,outputText(output),trusted.protectedTerms??[],trusted.protectedCitations??[],true,placeholders,isCondensed(requestOf(input.promptId,controls)));
    if (!protection.valid) {
      const required = [...new Set([...(trusted.protectedTerms??[]),...(placeholders?placeholderTokens(input.source.text):[])])];
      const repairRuntime: RuntimeInput = {language:trusted.language,failedOutput:outputText(output),originalScope:input.source.text,requiredProtectedTerms:required,requiredProtectedCitations:trusted.protectedCitations};
      // If the repair pass cannot run or cannot be trusted, the honest answer is the violation that caused it,
      // not a generic provider error: that is what the user has to act on.
      const original = rejectionOf(protection.violations, protection.errors);
      let repaired: AIResponse;
      try { repaired = await call('P10_REPAIR',`${key}:repair`,repairRuntime,true,required); }
      catch { throw await refuse(original, 'repair unavailable'); }
      try {
        const checked = validateGeneration('P10_REPAIR',input.source.text,repaired,repairRuntime,1);
        output = {...output,transformed_text:checked.corrected_text};
      } catch (error) { throw await refuse(error instanceof OutputRejected ? error : original, 'repair failed'); }
    }
    try { output = validateGeneration(input.promptId,input.source.text,output,{...trusted,request:controls.request}); }
    catch (error) { throw await refuse(error, 'validation failed'); }
    const soft = output.no_change_needed === true || freeform ? [] : softWarnings(input.promptId,input.source.text,outputText(output),{language:controls.language,strength:controls.strength,request:requestOf(input.promptId,controls)});
    if (soft.length) output = {...output,warnings:mergeWarnings(output.warnings,soft)};
    if (input.promptId === 'P03_HUMANIZER') output = {...output,exceeds_preservation:exceedsPreservation(input.source.text,outputText(output),controls.preservation)};
  }
  if (suggestedTitle) output = {...output, suggested_title: suggestedTitle};
  const id=crypto.randomUUID();const expiry=Date.now()+DAY;
  await runtime().DB.prepare('INSERT INTO transformations (id,document_id,owner_id,prompt_id,prompt_version,model,source_revision,source_text,anchor_json,runtime_json,output_json,status,idempotency_key,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id,input.documentId,ownerId,input.promptId,PROMPT_VERSION,model(),input.expectedRevision,input.source.text,anchor?JSON.stringify(anchor):null,JSON.stringify({...controls,style_reference:undefined,style_reference_used:typeof controls.style_reference==='string'&&controls.style_reference.length>0,prompt_version:PROMPT_VERSION,reasoning_effort:REASONING_EFFORT[input.promptId]}),JSON.stringify(output),'preview',key,expiry,Date.now()).run();
  return {id,output,expiresAt:new Date(expiry).toISOString(),reused:false};
  } catch (error) {
    // Anything that fails past the provider call — a failed repair, a schema surprise, a storage error — leaves the user with no usable output.
    await release(error instanceof RequestError ? error.code : 'pipeline failed');
    throw error;
  }
}

export async function applyPreview(ownerId: string, previewId: string, expectedRevision: number, selectedAlternative?: number) {
  await cleanExpired(ownerId);
  const preview = await runtime().DB.prepare('SELECT document_id,prompt_id,source_revision,source_text,anchor_json,runtime_json,output_json,status,expires_at,applied_at FROM transformations WHERE id=? AND owner_id=?').bind(previewId,ownerId)
    .first<{document_id:string;prompt_id:PromptId;source_revision:number;source_text:string;anchor_json:string|null;runtime_json:string;output_json:string;status:string;expires_at:number;applied_at:number|null}>();
  if (!preview) throw new RequestError('NOT_FOUND','Preview not found.',404);
  if (preview.applied_at) return getDocument(ownerId,preview.document_id);
  if (preview.status!=='preview'||preview.expires_at<=Date.now()) throw new RequestError('PREVIEW_EXPIRED','This preview has expired.',410);
  if (preview.source_revision!==expectedRevision) throw new RequestError('REVISION_CONFLICT','The document changed before this preview could be applied.',409);
  const document=await currentText(ownerId,preview.document_id);
  if (document.document.revision!==expectedRevision) throw new RequestError('REVISION_CONFLICT','The document changed before this preview could be applied.',409);
  const anchor=preview.anchor_json?JSON.parse(preview.anchor_json) as {from:number;to:number}:undefined;
  if ((anchor?document.text.slice(anchor.from,anchor.to):document.text)!==preview.source_text) throw new RequestError('SOURCE_MISMATCH','The source text changed.',409);
  const output=JSON.parse(preview.output_json) as AIResponse;const controls=JSON.parse(preview.runtime_json) as RuntimeInput;
  const locks=await listLocks(ownerId,preview.document_id);
  const fresh: RuntimeInput={...controls,protectedTerms:locks.map(lock=>lock.term).filter(term=>preview.source_text.includes(term))};
  // A lock added after the preview was made can invalidate it, so the reason names the term rather than staying generic.
  try {validateGeneration(preview.prompt_id,preview.source_text,output,fresh);}
  catch (error) {
    const typed = error instanceof OutputRejected ? error : null;
    const code = typed?.cause === 'term' ? 'AI_LOCKED_TERM_REJECTED' : typed?.cause === 'number' ? 'AI_NUMBER_REJECTED' : typed?.cause === 'citation' ? 'AI_CITATION_REJECTED' : 'AI_OUTPUT_REJECTED';
    throw new RequestError(code,'This preview no longer meets protected-content requirements.',422, typed?.token ? {token:typed.token} : undefined);
  }
  // A dock instruction over several paragraphs gets its lines back as paragraphs, not as line breaks inside one.
  const content=replaceTextInDocument(document.document.content,anchor?.from??0,anchor?.to??document.text.length,collapseBlankLines(outputText(output,selectedAlternative)),preview.prompt_id==='P08_CUSTOM_TRANSFORM'&&preview.source_text.includes('\n')?'paragraph':requestedFormat(preview.prompt_id,controls));
  return saveDocument(ownerId,preview.document_id,expectedRevision,{content},'ai_apply',null,{previewId,expectedLockIds:locks.map(lock=>lock.id),promptId:preview.prompt_id,scopeType:anchor?'selection':'document'});
}
export async function discardPreview(ownerId:string,previewId:string) {
  const result=await runtime().DB.prepare("UPDATE transformations SET status='discarded',source_text='',output_json='{}',runtime_json='{}',anchor_json=NULL WHERE id=? AND owner_id=? AND status='preview' AND applied_at IS NULL").bind(previewId,ownerId).run();
  if (result.meta.changes!==1) throw new RequestError('NOT_FOUND','Active preview not found.',404);
}

type QualityValue = 'rendah'|'sedang'|'tinggi'|'tidak_berlaku';
export type QualityResult = { dimensions: Record<'clarity'|'academic_fit'|'naturalness'|'formality', { value: QualityValue; reason: string }>; warnings: string[]; analyzedRevision: number };

// P09 is on demand only; the analysed text is never persisted.
export async function analyzeQuality(ownerId: string, key: string, input: AnalyzeQualityInput): Promise<QualityResult> {
  if (runtime().AI_PUBLIC_ENABLED !== 'true') throw new ConfigurationError('AI is unavailable until provider privacy configuration is verified.');
  const apiKey = requiredSetting(runtime().OPENROUTER_API_KEY, 'OPENROUTER_API_KEY');
  const source = await currentText(ownerId, input.documentId);
  if (source.document.revision !== input.expectedRevision) throw new RequestError('REVISION_CONFLICT', 'The document changed before analysis.', 409);
  const anchor = input.source.anchor;
  if (anchor && (anchor.from >= anchor.to || anchor.to > source.text.length)) throw new RequestError('SOURCE_MISMATCH', 'The selected source is invalid.', 409);
  if ((anchor ? source.text.slice(anchor.from, anchor.to) : source.text) !== input.source.text || !input.source.text.trim()) throw new RequestError('SOURCE_MISMATCH', 'The selected source no longer matches the saved document.', 409);
  const rights = await entitlement(ownerId);
  const usageId = await reserve(ownerId, key, 'P09_QUALITY_EVALUATION', input.source.text.length, rights);
  const started = Date.now();
  const provider = createOpenRouterProvider({ apiKey, model: model(), privacyMode: 'deny' });
  const result = await provider.generate({ promptId: 'P09_QUALITY_EVALUATION', runtime: { language: input.language, mode: input.context }, sourceText: input.source.text, requestId: usageId });
  await completeUsage(usageId, result, started);
  if (!result.ok) throw new RequestError('AI_UNAVAILABLE', 'Writing analysis could not be completed. Your text is unchanged.', 502);
  const dimensions = result.response as QualityResult['dimensions'];
  if (input.context !== 'academic') dimensions.academic_fit = { value: 'tidak_berlaku', reason: '' };
  return { dimensions, warnings: [], analyzedRevision: input.expectedRevision };
}
