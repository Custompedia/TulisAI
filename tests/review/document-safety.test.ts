import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../../src/server/runtime', () => ({
  runtime: () => state.env,
  requiredSetting: (value: string) => value,
  ConfigurationError: class extends Error {},
}));

import { autosaveDocument, createDocument, getDocument, getVersion, listDocuments, listVersions, restoreVersion, saveDocument } from '../../src/server/documents/service';
import { documentText, replaceTextInDocument } from '../../src/server/documents/serialize';
import { generatePreview, applyPreview, discardPreview } from '../../src/server/ai/service';
import { runtimeControls, defaults } from '../../src/lib/writing/settings';
import { EditorDocumentSchema } from '../../src/lib/contracts';

let db: DatabaseSync;
let objects: Map<string, string>;
let objectReads: number;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } }; }
  async run() { return this.execute(); }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0000_initial.sql', 'utf8')); db.exec(readFileSync('migrations/0001_username_auth.sql', 'utf8')); db.exec(readFileSync('migrations/0002_workspace_metadata.sql', 'utf8')); db.exec(readFileSync('migrations/0003_notebook_appearance.sql', 'utf8')); db.exec(readFileSync('migrations/0005_user_role.sql', 'utf8')); db.exec(readFileSync('migrations/0006_admin_panel.sql', 'utf8')); db.exec(readFileSync('migrations/0007_usage_created_index.sql', 'utf8'));
  objects = new Map(); objectReads = 0;
  state.env = {
    DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    DOCUMENTS: {
      head: async (key: string) => objects.has(key) ? { key, size: objects.get(key)!.length } : null,
      put: async (key: string, value: string) => { objects.set(key, value); return { key }; },
      get: async (key: string) => { objectReads++; const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value, arrayBuffer: async () => new TextEncoder().encode(value).buffer }; },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    },
  };
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });
const content = (text: string) => EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const create = () => createDocument('owner-a', { title: 'Research', language: 'id', content: content('Sumber asli.') });

describe('review: persisted document safety with SQLite statements', () => {
  it('autosaves without adding versions and rejects stale writes', async () => {
    const doc = await create();
    await autosaveDocument('owner-a', doc.id, doc.revision, content('Draf pertama.'));
    expect((await listVersions('owner-a', doc.id)).items).toHaveLength(1);
    await expect(autosaveDocument('owner-a', doc.id, doc.revision, content('Draf basi.'))).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(documentText((await getDocument('owner-a', doc.id)).content)).toBe('Draf pertama.');
  });
  it('rejects access and modification by another owner', async () => {
    const doc = await create();
    await expect(getDocument('owner-b', doc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(autosaveDocument('owner-b', doc.id, 0, content('Intrusion'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await getDocument('owner-a', doc.id)).revision).toBe(0);
  });
  it('allows only one concurrent checkpoint for the same base revision', async () => {
    const doc = await create();
    const outcomes = await Promise.allSettled([
      saveDocument('owner-a', doc.id, 0, { content: content('Candidate A') }),
      saveDocument('owner-a', doc.id, 0, { content: content('Candidate B') }),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await listVersions('owner-a', doc.id)).items).toHaveLength(2);
  });
  it('restores as a new version and retains later history and original body', async () => {
    const doc = await create(); const original = (await listVersions('owner-a', doc.id)).items[0]!;
    const changed = await saveDocument('owner-a', doc.id, 0, { content: content('Versi baru.') });
    const restored = await restoreVersion('owner-a', doc.id, original.id, changed.revision);
    expect(documentText(restored.content)).toBe('Sumber asli.');
    expect(restored.revision).toBe(2);
    expect((await listVersions('owner-a', doc.id)).items).toHaveLength(3);
  });
  it('lists metadata without retrieving historical R2 bodies', async () => {
    await create(); const before = objectReads;
    const list = await listDocuments('owner-a');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty('content');
    expect(objectReads).toBe(before);
  });
});

describe('review: scoped editor replacement', () => {
  it('does not inject newlines between adjacent inline marks', () => {
    const doc = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pilih ' }, { type: 'text', text: 'istilah', marks: [{ type: 'bold' }] }, { type: 'text', text: ' ini.' }] }] });
    expect(documentText(doc)).toBe('Pilih istilah ini.');
  });
  it('replaces the second paragraph target without changing a formatted first paragraph', () => {
    const doc = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Judul', marks: [{ type: 'bold' }] }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Teks lama di sini.' }] }] });
    const source = documentText(doc); const from = source.indexOf('lama');
    const result = replaceTextInDocument(doc, from, from + 4, 'baru');
    expect(documentText(result)).toBe('Judul\nTeks baru di sini.');
    expect(result.content[0]).toEqual(doc.content[0]);
  });
});

describe('review: actual AI pipeline with mocked provider transport',()=>{
  function enable(){state.env.AI_PUBLIC_ENABLED='true';state.env.OPENROUTER_API_KEY='test-key';state.env.AI_MONTHLY_REQUEST_LIMIT='100';}
  const response=(output:unknown)=>Response.json({id:'provider-test',choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:7}});
  const input=(doc:{id:string;revision:number},text='Sumber asli.')=>({documentId:doc.id,promptId:'P01_STANDARD_REWRITE' as const,source:{text},runtime:runtimeControls({...defaults,mode:'standard',language:'id'},'id'),expectedRevision:doc.revision});
  it('privacy gate makes zero provider calls',async()=>{
    const doc=await create();const transport=vi.fn();vi.stubGlobal('fetch',transport);
    await expect(generatePreview('owner-a','key',input(doc))).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
  });
  it('returns validated preview then atomically applies exactly once',async()=>{
    enable();const doc=await create();const transport=vi.fn(async()=>response({transformed_text:'Tulisan awal.',change_categories:['clarity'],warnings:[],no_change_needed:false}));vi.stubGlobal('fetch',transport);
    const preview=await generatePreview('owner-a','key',input(doc));
    expect(documentText((await getDocument('owner-a',doc.id)).content)).toBe('Sumber asli.');
    const reused=await generatePreview('owner-a','key',input(doc));expect(reused.id).toBe(preview.id);expect(transport).toHaveBeenCalledTimes(1);
    await applyPreview('owner-a',preview.id,0);await applyPreview('owner-a',preview.id,0);
    expect(documentText((await getDocument('owner-a',doc.id)).content)).toBe('Tulisan awal.');expect((await listVersions('owner-a',doc.id)).items).toHaveLength(2);
    expect(db.prepare('SELECT input_tokens FROM usage_ledger').get()).toMatchObject({input_tokens:12});
  });
  it('enforces the monthly cap for users and lifts it for admins',async()=>{
    enable();state.env.AI_MONTHLY_REQUEST_LIMIT='1';const doc=await create();
    const transport=vi.fn(async()=>response({transformed_text:'Tulisan awal.',change_categories:[],warnings:[],no_change_needed:false}));vi.stubGlobal('fetch',transport);
    await generatePreview('owner-a','first',input(doc));
    await expect(generatePreview('owner-a','second',input(doc))).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
    db.prepare("INSERT INTO user (id,name,email,username,role,created_at,updated_at) VALUES ('owner-a','Admin','admin@example.test','admin','admin',1,1)").run();
    const preview=await generatePreview('owner-a','third',input(doc));
    expect(preview.id).toBeTruthy();expect(transport).toHaveBeenCalledTimes(2);
  });
  it('prevents a concurrent idempotency key from spending twice',async()=>{
    enable();const doc=await create();let resolve:((response:Response)=>void)|undefined;
    const transport=vi.fn(()=>new Promise<Response>(done=>{resolve=done}));vi.stubGlobal('fetch',transport);
    const first=generatePreview('owner-a','same',input(doc));
    await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));
    await expect(generatePreview('owner-a','same',input(doc))).rejects.toMatchObject({code:'IDEMPOTENCY_PENDING'});
    resolve!(response({transformed_text:'Tulisan awal.',change_categories:[],warnings:[],no_change_needed:false}));await first;expect(transport).toHaveBeenCalledTimes(1);
  });
  it('repairs a single protected violation once then applies normalized output',async()=>{
    enable();const doc=await createDocument('owner-a',{title:'Numbers',language:'id',content:content('Kami memiliki 10 unit.')});
    const transport=vi.fn().mockResolvedValueOnce(response({transformed_text:'Kami memiliki unit.',change_categories:[],warnings:[],no_change_needed:false})).mockResolvedValueOnce(response({corrected_text:'Terdapat 10 unit milik kami.',unrepairable_spans:[]}));vi.stubGlobal('fetch',transport);
    const preview=await generatePreview('owner-a','repair',input(doc,'Kami memiliki 10 unit.'));
    expect(transport).toHaveBeenCalledTimes(2);expect(preview.output.transformed_text).toBe('Terdapat 10 unit milik kami.');
    await applyPreview('owner-a',preview.id,0);expect(documentText((await getDocument('owner-a',doc.id)).content)).toBe('Terdapat 10 unit milik kami.');
  });
  it('rejects unsafe P07 without a repair or document changes',async()=>{
    enable();const doc=await createDocument('owner-a',{title:'Numbers',language:'id',content:content('Ada 10 unit.')});
    const transport=vi.fn(async()=>response({alternatives:[{text:'Ada unit.',variation_level:'leksikal'},{text:'Unit tersedia.',variation_level:'struktur'},{text:'Terdapat unit.',variation_level:'register'}],warnings:[]}));vi.stubGlobal('fetch',transport);
    await expect(generatePreview('owner-a','inline',{...input(doc,'Ada 10 unit.'),promptId:'P07_INLINE_ALTERNATIVES',source:{text:'Ada 10 unit.',anchor:{from:0,to:12}},runtime:runtimeControls(defaults,'id','alternatives')})).rejects.toMatchObject({code:'AI_OUTPUT_REJECTED'});
    expect(transport).toHaveBeenCalledTimes(1);expect((await getDocument('owner-a',doc.id)).revision).toBe(0);
  });
  it('records v3 runtime metadata and flags P03 output above the preservation ceiling',async()=>{
    enable();const doc=await createDocument('owner-a',{title:'Human',language:'id',content:content('Kami menyiapkan laporan ini dengan teliti.')});
    const transport=vi.fn(async()=>response({transformed_text:'Laporan ini kami susun secara cermat.',change_categories:['struktur kalimat'],warnings:[],no_change_needed:false}));vi.stubGlobal('fetch',transport);
    const preview=await generatePreview('owner-a','human',{...input(doc,'Kami menyiapkan laporan ini dengan teliti.'),promptId:'P03_HUMANIZER',runtime:runtimeControls({...defaults,mode:'humanize',preservation:'conservative'},'id')});
    expect(preview.output).toMatchObject({transformed_text:'Laporan ini kami susun secara cermat.',exceeds_preservation:true});expect(preview.output).not.toHaveProperty('humanized_text');
    const body=JSON.parse((transport.mock.calls[0] as unknown as [string,{body:string}])[1].body);expect(body.reasoning).toEqual({effort:'low'});expect(body.messages[0].content).not.toContain('Kami menyiapkan');
    const row=db.prepare('SELECT prompt_version,runtime_json FROM transformations WHERE id=?').get(preview.id) as {prompt_version:string;runtime_json:string};
    expect(row.prompt_version).toBe('v4');expect(JSON.parse(row.runtime_json)).toMatchObject({prompt_version:'v4',reasoning_effort:'low',humanizer_context:'umum',preservation:'conservative'});
  });
  it('adds soft validator warnings without rejecting and rejects structural failures before any repair',async()=>{
    enable();const source='Tim kami menyelesaikan migrasi sistem pada bulan lalu. Semua layanan berjalan normal setelah pengujian selesai dilakukan.';
    const doc=await createDocument('owner-a',{title:'Soft',language:'id',content:content(source)});
    const merged='Tim kami menyelesaikan migrasi sistem pada bulan lalu dan semua layanan berjalan normal setelah pengujian selesai dilakukan.';
    const transport=vi.fn(async()=>response({transformed_text:merged,change_categories:[],warnings:['Catatan model.'],no_change_needed:false}));vi.stubGlobal('fetch',transport);
    const preview=await generatePreview('owner-a','soft',{...input(doc,source),runtime:runtimeControls({...defaults,mode:'standard',strength:'light'},'id')});
    expect(preview.output.warnings).toEqual(['Catatan model.','Jumlah kalimat berubah padahal kekuatan Ringan.']);expect(transport).toHaveBeenCalledTimes(1);
    const split=vi.fn(async()=>response({transformed_text:'Tim kami menyelesaikan migrasi sistem pada bulan lalu.\n\nSemua layanan berjalan normal setelah pengujian selesai dilakukan.',change_categories:[],warnings:[],no_change_needed:false}));vi.stubGlobal('fetch',split);
    await expect(generatePreview('owner-a','structure',{...input(doc,source),promptId:'P02_ACADEMIC',runtime:runtimeControls({...defaults,mode:'academic'},'id')})).rejects.toMatchObject({code:'AI_OUTPUT_REJECTED',status:422});
    expect(split).toHaveBeenCalledTimes(1);
  });
  it('rejects a dishonest no_change_needed flag with 422',async()=>{
    enable();const doc=await create();vi.stubGlobal('fetch',vi.fn(async()=>response({transformed_text:'Tulisan yang sepenuhnya berbeda.',change_categories:[],warnings:[],no_change_needed:true})));
    await expect(generatePreview('owner-a','honesty',input(doc))).rejects.toMatchObject({code:'AI_OUTPUT_REJECTED',status:422});
  });
  it('enforces inline, selection and document scope limits with 422 before any AI call',async()=>{
    enable();const transport=vi.fn();vi.stubGlobal('fetch',transport);
    const inline='a'.repeat(601);const selection='b'.repeat(5_001);const whole='c '.repeat(10_001);
    const doc=await createDocument('owner-a',{title:'Long',language:'id',content:content(inline)});
    await expect(generatePreview('owner-a','inline-limit',{...input(doc,inline),promptId:'P07_INLINE_ALTERNATIVES',source:{text:inline,anchor:{from:0,to:601}},runtime:runtimeControls(defaults,'id','shorter')})).rejects.toMatchObject({code:'SCOPE_TOO_LARGE',status:422,details:{limit:600}});
    await expect(generatePreview('owner-a','selection-limit',{...input(doc,selection),source:{text:selection,anchor:{from:0,to:5_001}}})).rejects.toMatchObject({code:'SCOPE_TOO_LARGE',status:422,details:{limit:5_000}});
    await expect(generatePreview('owner-a','document-limit',input(doc,whole))).rejects.toMatchObject({code:'SCOPE_TOO_LARGE',status:422,details:{limit:20_000}});
    expect(transport).not.toHaveBeenCalled();expect(db.prepare('SELECT COUNT(1) AS n FROM usage_ledger').get()).toMatchObject({n:0});
  });
  it('rejects stale Apply and discard never mutates the source',async()=>{
    enable();const doc=await create();vi.stubGlobal('fetch',vi.fn(async()=>response({transformed_text:'Tulisan awal.',change_categories:[],warnings:[],no_change_needed:false})));
    const preview=await generatePreview('owner-a','stale',input(doc));await autosaveDocument('owner-a',doc.id,0,content('Ketikan terbaru.'));
    await expect(applyPreview('owner-a',preview.id,0)).rejects.toMatchObject({code:'REVISION_CONFLICT'});await discardPreview('owner-a',preview.id);
    expect(documentText((await getDocument('owner-a',doc.id)).content)).toBe('Ketikan terbaru.');expect((await listVersions('owner-a',doc.id)).items).toHaveLength(1);
  });
  it('preserves typed source in history when applying to a document created empty',async()=>{
    enable();const doc=await createDocument('owner-a',{title:'Blank',language:'id',content:{type:'doc',content:[{type:'paragraph'}]}});
    const typed=await autosaveDocument('owner-a',doc.id,0,content('Kami menyiapkan tulisan.'));
    vi.stubGlobal('fetch',vi.fn(async()=>response({transformed_text:'Tulisan sedang kami siapkan.',change_categories:[],warnings:[],no_change_needed:false})));
    const preview=await generatePreview('owner-a','first-typed',input(typed,'Kami menyiapkan tulisan.'));await applyPreview('owner-a',preview.id,typed.revision);
    const versions=(await listVersions('owner-a',doc.id)).items;expect(versions).toHaveLength(3);
    const baseline=versions.find(version=>version.revision===typed.revision)!;expect(documentText((await getVersion('owner-a',doc.id,baseline.id)).content)).toBe('Kami menyiapkan tulisan.');
  });
  it('atomically rejects Apply when the expected lock set changed',async()=>{
    enable();const doc=await create();vi.stubGlobal('fetch',vi.fn(async()=>response({transformed_text:'Tulisan awal.',change_categories:[],warnings:[],no_change_needed:false})));
    const preview=await generatePreview('owner-a','lock-race',input(doc));
    db.prepare("INSERT INTO locked_terms (id,document_id,owner_id,term,created_at) VALUES ('new-lock',?,'owner-a','Sumber',1)").run(doc.id);
    await expect(saveDocument('owner-a',doc.id,0,{content:content('Tulisan awal.')},'ai_apply',null,{previewId:preview.id,expectedLockIds:[]})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    expect((await getDocument('owner-a',doc.id)).revision).toBe(0);expect((await listVersions('owner-a',doc.id)).items).toHaveLength(1);
    expect(db.prepare('SELECT status FROM transformations WHERE id=?').get(preview.id)).toMatchObject({status:'preview'});
  });
  it('rejects whitespace-only provider output without repair',async()=>{
    enable();const doc=await create();const transport=vi.fn(async()=>response({transformed_text:'   ',change_categories:[],warnings:[],no_change_needed:false}));vi.stubGlobal('fetch',transport);
    await expect(generatePreview('owner-a','empty-output',input(doc))).rejects.toMatchObject({code:'AI_UNAVAILABLE'});expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid controls before reserving or calling AI',async()=>{
    enable();const doc=await create();const transport=vi.fn();vi.stubGlobal('fetch',transport);
    await expect(generatePreview('owner-a','invalid',{...input(doc),runtime:{language:'id',strength:'invented'}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
    expect(transport).not.toHaveBeenCalled();expect(db.prepare('SELECT COUNT(1) AS n FROM usage_ledger').get()).toMatchObject({n:0});
  });
});
