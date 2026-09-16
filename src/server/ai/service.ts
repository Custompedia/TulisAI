import { runtime, requiredSetting, ConfigurationError } from '../runtime';
import { entitlement, periodKey } from '../usage/quota';
import { RequestError } from '../http';
import { currentText, getDocument, replaceTextInDocument, saveDocument } from '../documents/service';
import { listLocks } from '../documents/locks';
import { createOpenRouterProvider, exceedsPreservation, mergeWarnings, normalizeRuntime, placeholderTokens, requestOf, softWarnings, structuralErrors, PROMPT_VERSION, REASONING_EFFORT, validateAIResponse, validateGeneration, validateProtectedContent, type AIResponse, type PromptId, type RuntimeInput, type ProviderResult } from './core';
import { AI_SCOPE_LIMIT, INLINE_LIMIT, SELECTION_LIMIT } from '@/lib/writing/settings';
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
async function reserve(ownerId: string, key: string, promptId: string, characters: number) {
  // Admins bypass the monthly cap by comparing against a limit no ledger can reach; the 10-per-minute burst guard stays.
  const rights = await entitlement(ownerId); const limit = rights.unlimited ? Number.MAX_SAFE_INTEGER : rights.requestLimit;
  const existing = await runtime().DB.prepare('SELECT id FROM usage_ledger WHERE owner_id=? AND idempotency_key=?').bind(ownerId, key).first();
  if (existing) throw new RequestError('IDEMPOTENCY_PENDING', 'This request was already attempted. Check its result before retrying.', 409);
  const id = crypto.randomUUID();
  try {
    const result = await runtime().DB.prepare("INSERT INTO usage_ledger (id,owner_id,idempotency_key,operation,status,period_key,request_id,created_at,prompt_id,source_characters) SELECT ?,?,?,?,'reserved',?,?,?,?,? WHERE (SELECT COUNT(1) FROM usage_ledger WHERE owner_id=? AND period_key=?) < ? AND (SELECT COUNT(1) FROM usage_ledger WHERE owner_id=? AND created_at>?) < 10")
      .bind(id, ownerId, key, promptId === 'P10_REPAIR' ? 'repair' : promptId === 'P09_QUALITY_EVALUATION' ? 'analyze' : 'generate', periodKey(), id, Date.now(), promptId, characters, ownerId, periodKey(), limit, ownerId, Date.now() - 60_000).run();
    if (result.meta.changes !== 1) throw new RequestError('QUOTA_EXCEEDED', 'AI request limit reached. Try later or review your monthly usage.', 429);
    return id;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    const raced = await runtime().DB.prepare('SELECT id FROM usage_ledger WHERE owner_id=? AND idempotency_key=?').bind(ownerId, key).first();
    if (raced) throw new RequestError('IDEMPOTENCY_PENDING', 'This request is already being processed.', 409);
    throw new RequestError('USAGE_UNAVAILABLE', 'Usage reservation could not be created.', 503);
  }
}
async function completeUsage(id: string, result: ProviderResult, started: number) {
  await runtime().DB.prepare("UPDATE usage_ledger SET status=?,completed_at=?,provider_request_id=?,input_tokens=?,output_tokens=?,latency_ms=?,error_code=? WHERE id=? AND status='reserved'")
    .bind(result.ok ? 'completed' : 'failed', Date.now(), result.usage?.providerRequestId ?? null, result.usage?.inputTokens ?? null, result.usage?.outputTokens ?? null, Date.now() - started, result.ok ? null : result.error, id).run();
}
async function cleanExpired(ownerId: string) {
  await runtime().DB.prepare("UPDATE transformations SET source_text='',output_json='{}',runtime_json='{}',anchor_json=NULL,status='expired' WHERE id IN (SELECT id FROM transformations WHERE owner_id=? AND status IN ('preview','applied','discarded') AND expires_at<=? ORDER BY expires_at LIMIT 100)").bind(ownerId, Date.now()).run();
}
function requestedFormat(promptId: PromptId, controls: RuntimeInput): 'bullets'|'numbered_list'|'table'|undefined {
  if (promptId === 'P07_INLINE_ALTERNATIVES') return undefined;
  return ({poin:'bullets',bernomor:'numbered_list',tabel:'table'} as const)[String(controls.request?.format) as 'poin'|'bernomor'|'tabel'];
}
export function scopeLimit(promptId: PromptId, anchored: boolean) { return promptId === 'P07_INLINE_ALTERNATIVES' ? INLINE_LIMIT : anchored ? SELECTION_LIMIT : AI_SCOPE_LIMIT; }

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
  const limit = scopeLimit(input.promptId, Boolean(input.source.anchor));
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
  const trusted: RuntimeInput = {...input.runtime, sourceText:input.source.text, selectedText:input.source.text, contextBefore:anchor ? source.text.slice(Math.max(0,anchor.from-300),anchor.from) : null, contextAfter:anchor ? source.text.slice(anchor.to,anchor.to+300) : null, protectedTerms:locks.map(lock=>lock.term).filter(term=>input.source.text.includes(term)), protectedCitations:[...new Set(citations)], language:input.runtime.language};
  let controls: RuntimeInput;
  try { controls = normalizeRuntime(input.promptId, trusted) as RuntimeInput; } catch { throw new RequestError('INVALID_REQUEST', 'The selected AI controls are invalid.'); }
  const provider = createOpenRouterProvider({apiKey,model:model(),privacyMode:'deny'});
  const call = async (promptId: PromptId, callKey: string, runtimeControls: RuntimeInput, repair=false, requiredTerms=trusted.protectedTerms) => {
    const usageId = await reserve(ownerId, callKey, promptId, input.source.text.length);
    const started = Date.now();
    const result = await provider.generate({promptId,runtime:runtimeControls,sourceText:input.source.text,requestId:usageId,protectedTerms:requiredTerms,protectedCitations:trusted.protectedCitations,...(repair?{repairAttempt:1}:{})});
    await completeUsage(usageId,result,started);
    if (!result.ok) throw new RequestError('AI_UNAVAILABLE', 'AI generation could not be completed safely. Your source is unchanged.', 502);
    return result.response;
  };
  let output = await call(input.promptId,key,controls);
  if (input.promptId === 'P07_INLINE_ALTERNATIVES') {
    try { output = validateGeneration(input.promptId,input.source.text,output,trusted); }
    catch { throw new RequestError('AI_OUTPUT_REJECTED', 'No safe set of alternatives was returned. Your source is unchanged.', 422); }
  } else {
    output = validateAIResponse(input.promptId,output);
    if (structuralErrors(input.promptId,input.source.text,outputText(output),controls).length) throw new RequestError('AI_OUTPUT_REJECTED', 'AI output changed the text structure. Your source is unchanged.', 422);
    const placeholders = input.promptId === 'P04_PROFESSIONAL';
    const protection = validateProtectedContent(input.source.text,outputText(output),trusted.protectedTerms??[],trusted.protectedCitations??[],true,placeholders);
    if (!protection.valid) {
      const required = [...new Set([...(trusted.protectedTerms??[]),...(placeholders?placeholderTokens(input.source.text):[])])];
      const repairRuntime: RuntimeInput = {language:trusted.language,failedOutput:outputText(output),originalScope:input.source.text,requiredProtectedTerms:required,requiredProtectedCitations:trusted.protectedCitations};
      const repaired = await call('P10_REPAIR',`${key}:repair`,repairRuntime,true,required);
      try {
        const checked = validateGeneration('P10_REPAIR',input.source.text,repaired,repairRuntime,1);
        output = {...output,transformed_text:checked.corrected_text};
      } catch { throw new RequestError('AI_OUTPUT_REJECTED', 'AI output could not be repaired safely. Your source is unchanged.', 422); }
    }
    try { output = validateGeneration(input.promptId,input.source.text,output,{...trusted,request:controls.request}); }
    catch { throw new RequestError('AI_OUTPUT_REJECTED', 'AI output did not pass safety checks. Your source is unchanged.', 422); }
    const soft = output.no_change_needed === true ? [] : softWarnings(input.promptId,input.source.text,outputText(output),{language:controls.language,strength:controls.strength,request:requestOf(input.promptId,controls)});
    if (soft.length) output = {...output,warnings:mergeWarnings(output.warnings,soft)};
    if (input.promptId === 'P03_HUMANIZER') output = {...output,exceeds_preservation:exceedsPreservation(input.source.text,outputText(output),controls.preservation)};
  }
  const id=crypto.randomUUID();const expiry=Date.now()+DAY;
  await runtime().DB.prepare('INSERT INTO transformations (id,document_id,owner_id,prompt_id,prompt_version,model,source_revision,source_text,anchor_json,runtime_json,output_json,status,idempotency_key,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id,input.documentId,ownerId,input.promptId,PROMPT_VERSION,model(),input.expectedRevision,input.source.text,anchor?JSON.stringify(anchor):null,JSON.stringify({...controls,style_reference:undefined,style_reference_used:typeof controls.style_reference==='string'&&controls.style_reference.length>0,prompt_version:PROMPT_VERSION,reasoning_effort:REASONING_EFFORT[input.promptId]}),JSON.stringify(output),'preview',key,expiry,Date.now()).run();
  return {id,output,expiresAt:new Date(expiry).toISOString(),reused:false};
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
  try {validateGeneration(preview.prompt_id,preview.source_text,output,fresh);} catch {throw new RequestError('AI_OUTPUT_REJECTED','This preview no longer meets protected-content requirements.',422);}
  const content=replaceTextInDocument(document.document.content,anchor?.from??0,anchor?.to??document.text.length,outputText(output,selectedAlternative),requestedFormat(preview.prompt_id,controls));
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
  const usageId = await reserve(ownerId, key, 'P09_QUALITY_EVALUATION', input.source.text.length);
  const started = Date.now();
  const provider = createOpenRouterProvider({ apiKey, model: model(), privacyMode: 'deny' });
  const result = await provider.generate({ promptId: 'P09_QUALITY_EVALUATION', runtime: { language: input.language, mode: input.context }, sourceText: input.source.text, requestId: usageId });
  await completeUsage(usageId, result, started);
  if (!result.ok) throw new RequestError('AI_UNAVAILABLE', 'Writing analysis could not be completed. Your text is unchanged.', 502);
  const dimensions = result.response as QualityResult['dimensions'];
  if (input.context !== 'academic') dimensions.academic_fit = { value: 'tidak_berlaku', reason: '' };
  return { dimensions, warnings: [], analyzedRevision: input.expectedRevision };
}
