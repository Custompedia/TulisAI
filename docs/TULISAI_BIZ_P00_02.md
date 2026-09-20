# TulisAI — Subscription, Identity, Entitlement, Usage & Commerce Contract

**Contract ID:** TULISAI-BIZ-P00-02

**Status:** APPROVED — OWNER DECISIONS LOCKED 2026-09-19

**B0 status:** COMPLETE — contract/reconciliation gate only

**Approval basis:** Explicit owner approval and OD-1 through OD-13 supplied on 2026-09-19.

**Track:** B0 only — contract and current-source reconciliation

**Audit date:** 2026-09-19

**Repository:** Custompedia/TulisAI

**Audited baseline:** `37879d4c63835b1c3f9e2a0f4062c6ffc155dd63`

**Starting branch / remote tracking HEAD:** `main` / same SHA; starting tree clean

**Working branch:** `codex/tulisai-b0-contract`

This contract incorporates the owner's explicit B0 approval and all thirteen locked decisions. B0 is complete as a contract/reconciliation gate only. B1–B9 remain later work: this approval does not certify Sandbox or Production readiness or claim payment integration. MKL and Mari Rekap source were not modified or audited here. No approved MKL wire contract was supplied: all cross-repository requirements below are semantic requirements, not endpoint names, issuer values, token schemas, JWT claims, or OAuth routes.

## Implementation status addendum — 20 September 2026

This addendum records implementation completed after the B0 audit without rewriting that audit's historical evidence or approved contract. The original `CURRENT`, `MATCH`, `PARTIAL`, `MISSING`, and `CONFLICT` labels below remain observations of the source at the audited B0 baseline. They are intentionally preserved and must not be read as a fresh audit of the current `main` branch.

- **B0:** COMPLETE — approved contract/reconciliation gate; OD-1 through OD-13 remain unchanged and locked.
- **B1:** COMPLETE / MERGED — generic MKL application identity and OIDC/SSO contract merged in MKL.
- **B2:** COMPLETE / MERGED — TulisAI identity bridge merged through PR #2, `feat(auth): add MKL identity bridge`.
- **B2 merge commit:** `5f835c5a87faa96183c1904dad8b11a40c8e51e8`.
- **Current source status:** the identity bridge now exists in TulisAI `main`; it provides Continue with MKL and explicit account linking using issuer + subject as external identity authority.
- **B3:** NEXT — entitlement projection and capability resolution.
- **B4–B9:** NOT STARTED.

B2 did **not** project entitlements, change commercial tier authority, implement character wallets, implement checkout or commerce, commission TulisAI, apply a remote migration, or deploy anything. B2 source completeness is not production commissioning readiness.

## Reading this contract

| Label | Meaning |
| --- | --- |
| LOCKED | Owner-decided behavior from the B0 request; implementation cannot silently change it. |
| CURRENT | Behavior independently observed in the audited TulisAI source. |
| TARGET | Approved implementation requirements for later phases; not a claim of current behavior. |
| MATCH | The stated, bounded part matches LOCKED behavior. |
| PARTIAL | Primitives exist, but the complete required behavior does not. |
| MISSING | No implementation was found for the required behavior in audited source. |
| CONFLICT | Current behavior contradicts the locked target. |
| DEPENDENCY ON MKL | Requires generic MKL B1 and/or B5 agreement and implementation. |
| TULISAI-LOCAL | Can be implemented in TulisAI after B0 approval, subject to stated dependencies. |
| DEFERRED | Explicitly later or outside launch. |
| OWNER DECISION LOCKED | OD-1 through OD-13 are resolved by explicit owner approval on 2026-09-19. |
| DELEGATED TECHNICAL PARAMETER | Approved principle with an exact technical detail assigned to a named later phase; not an unresolved B0 business decision. |

Source references use repository-relative file paths and named symbols so they remain useful if lines move. Source and existing tests are evidence; historical test claims in `docs/verification.md` are not fresh test results. Absence findings cover tracked application/configuration/migration/test/documentation text, not remote deployment state or production data.

## A. Product and package matrix

**LOCKED:** TulisAI is first-party SaaS #2 under MKL. Prices below are approved catalogue prices in IDR; MKL owns the actual offer, sold price, purchased period, and commercial records. A local catalogue is not proof of payment. Paid plans have a one-calendar-month entitlement term (OD-12). MKL calculates `period_start` and `period_end`; TulisAI consumes those verified facts. Paid allowance follows that verified period, never an inferred UTC calendar-month reset after integration.

| Plan | Price | Included AI characters | CURRENT generation run cap | LOCKED capabilities | Top-up eligibility | Downgrade / expiry |
| --- | ---: | --- | ---: | --- | --- | --- |
| Free | Rp0 | 3,000 once per account | 1,000 | All six core writing modes; manual editor remains usable after AI allowance is exhausted | No | No paid capabilities; content remains readable, manually editable, saveable and portable |
| Plus | Rp49,000 | 25,000 per verified entitlement period | 2,000 | Free capabilities plus Saved Skills / Styles | Yes, while paid active | At paid expiry use Free capabilities; no new trial grant; purchased lots freeze; content retained |
| Pro | Rp179,000 | 100,000 per verified entitlement period | 5,000 | Everything in Plus plus Advanced Document Workspace and DOCX import/export | Yes, while paid active | Same expiry rule; narrow existing-content portability exception in I; Advanced Workspace and DOCX import do not survive expiry |
| Max | Rp499,000 | 350,000 per verified entitlement period | 5,000 | Everything in Pro plus selection/section free-form AI Mode, persistent custom instructions/personalization, writing sample/style reference, composition with existing Skills / Styles | Yes, while paid active | Same expiry rule; Max runtime features disabled without deleting stored user data |

Free and Plus have no normal DOCX entitlement, no Advanced Workspace and no AI Mode. Pro has no AI Mode or Max-only personalization/sample entitlement. **DEFERRED:** PDF is not a launch entitlement; the export route accepts only DOCX and production readiness for PDF is not established.

**CURRENT / MATCH (catalogue only):** `src/lib/plans.ts` (`TIERS`, `PLAN_LIMITS`, `TOP_UPS`, `requiredTierFor`) defines exactly the prices, quantities and six existing feature identifiers. `src/lib/writing/settings.ts` (`Mode`, `promptFor`) supplies standard, academic, humanize, professional, creative and simplify. `tests/review/plan-catalogue.test.ts` encodes these values.

Run limits above are observed operational limits, not new owner-approved benefits. `scopeLimit()` in `src/server/ai/service.ts` applies them to generation; inline alternatives are capped at 600. P09 analysis instead has a 20,000-character request-schema limit and does not use that generation run cap (`src/lib/contracts.ts`, `analyzeQuality`). Do not claim every AI operation shares the plan run cap. CURRENT request safeguards are Free 100 (configurable), Plus 500, Pro 2,000, Max 3,000 per UTC month; internal repair is excluded from this monthly count, but all attempts can count toward the 10/minute burst guard. These safeguards are separate from commercial character charging.

**CURRENT / PARTIAL:** Free defaults to 3,000 account-wide charged characters, but `AI_FREE_CHARACTER_ALLOWANCE` and `user.ai_character_limit_override` can alter it. A character override makes a Free account refilling rather than once-only. Paid limits use `periodKey()` = UTC `YYYY-MM`. Admin role bypasses allowance/request caps and resolves all features with the maximum run cap. These exceptions are not customer plan entitlements.

**Legacy Team / MATCH:** `asTier('team')` maps to `pro`; `TIERS` and commercial UI exclude Team, and admin input schemas only accept the four current tiers. `src/server/admin/service.ts` also counts Team in the Pro summary. Keep this compatibility mapping for local legacy rows and preserve their provenance; do not offer Team for new sale. Unknown MKL plan codes must be rejected as unverified, not silently accepted through the local legacy fallback. Mapping a legacy row does not establish a paid MKL period; reconciliation of legacy grants requires OD-5.

## B. Capability contract

Canonical names here are semantic contract vocabulary, not new API fields. Server enforcement must resolve verified entitlement facts and apply all relevant gates even when the client directly supplies runtime controls or saved preferences.

| Canonical capability | LOCKED availability | CURRENT source mapping | Reconciliation |
| --- | --- | --- | --- |
| Core writing | Free / Plus / Pro / Max, AI subject to allowance; manual work independent | `promptFor`, P01–P06; document read/save services | MATCH for six modes and manual-work primitives |
| Saved Skills / Styles | Plus+ creation and modification | `saved_styles`; `createStyle`, `updateStyle` in `src/server/writing/styles.ts` | MATCH for create/update gate; list/delete remain open; post-downgrade use must enforce locked OD-2 boundaries |
| Advanced Document Workspace | Pro+ | `advanced_notebook`; preference `advanced`; `checkedPreferences`; Workspace `paged` | PARTIAL: create rejects and autosave strips submitted advanced flag; UI gates paged mode. This is not granular enforcement of every rich-text/layout mutation |
| DOCX import | Pro+ | `docx_import`; `src/app/api/documents/import/route.ts` | MATCH for normal paid gate |
| DOCX export | Pro+ normal feature | `docx_export`; `src/app/api/documents/[id]/export/route.ts` | MATCH for normal gate; CONFLICT for expired-owner portability |
| AI Mode | Max only, selected passage/section | `freeform_prompt`; sanitized request `instruction`; P08 custom transform with anchor | MATCH for tier and selected-scope gate; charging has gaps in F |
| Persistent personalization / custom instructions | Max only | `Settings.extra`, `customized`, `runtimeControls().custom_request.extra_request`; normalized `request.additional_instruction`; notebook `preferences_json` and style `settings_json` | CONFLICT: no Max gate on these inputs; persistent free text/sample boundary locked in OD-1 |
| Writing sample / style reference | Max only | `Settings.sample` → `style_sample` → normalized `style_reference` | CONFLICT: normalization and generation do not require Max; saved styles can persist samples from Plus; direct runtime can supply sample below Max |
| Top-up purchase eligibility | Plus / Pro / Max active paid only | `purchase_topup` in `PLAN_LIMITS` | PARTIAL: catalogue flag only; purchase and fulfillment absent |

**CURRENT evidence:** `src/lib/writing/settings.ts` caps `extra` at 500 and `sample` at 1,000; `runtimeControls` emits sample when nonempty and custom request when `customized`. `src/lib/writing/styles.ts` normalizes complete snapshots, including both fields. `src/components/writing/StyleDialog.tsx` exposes “Instructions for the AI” and “Writing sample”; `WritingControls.tsx` exposes “Note for the AI”. `src/server/ai/core/index.ts` accepts aliases for additional instructions and style references without tier context. `generatePreview()` gates the separate free-form `instruction` but not `extra`/sample. `Workspace.tsx` persists writing settings in notebook metadata. This proves below-Max backend availability; it does not mean every Free UI has a standalone sample editor.

`writing_styles.description` is metadata describing when to use a skill; it is not an AI instruction and is not sent to the model (`tests/review/writing-skills-extras.test.ts`). `styleId` identifies the selected saved style; it is not an entitlement. `user_preferences` holds ordinary language/mode/use-case settings, not an account-wide free-text personalization field. Do not classify all preferences or the ordinary six-mode controls as Max-only.

**TARGET / TULISAI-LOCAL:** Gate premium runtime fields after normalization, on style creation/update and every generation entry; never rely on a UI lock or `styleId`. Preserve inactive stored data on downgrade, while excluding unauthorized premium fields from provider input. Saving unrelated manual content must still succeed. Max may compose AI Mode with existing Skills / Styles, subject to the same source scope, sample protections, wallet and runtime gates. Existing settings plumbing is only PARTIAL evidence for the complete composition contract.

**OWNER DECISION LOCKED OD-1:** Persistent free-text custom instructions/personalization and writing sample/style reference are Max-only. `Settings.extra` persisted in notebook preferences or style snapshots is a candidate persistent instruction field and must be enforced accordingly; sample runtime aliases must not bypass the Max gate. Ordinary structured controls of all six core writing modes remain core product controls. Do not classify ordinary settings as Max personalization. Free-form AI Mode remains Max-only. B3 maps all equivalent runtime aliases and persisted fields to these boundaries; this approval does not create a below-Max premium-field exception.

**OWNER DECISION LOCKED OD-2:** After downgrade, existing saved Styles/Skills remain visible and deletable for data ownership. Creating or modifying them remains Plus+. A downgraded account cannot bypass paid capability gates by applying premium saved settings to a new request. Existing nonpremium settings already embedded in owned documents are preserved. B3 must enforce these boundaries on each request while keeping stored user data intact.

## C. Identity contract

**LOCKED:** Existing TulisAI users may retain local sign-in and explicitly link MKL. “Continue with MKL” becomes the primary new-user path. Never auto-link by matching email. The external identity key is the verified pair **issuer + subject**. Local admin identity/access remains separate from customer MKL identity. Every linking action is explicit and auditable.

**CURRENT / MISSING (MKL bridge):** `src/server/auth/auth.ts` configures Better Auth with username/email-password, optional Google (only when both Google settings exist), password reset, email verification/change, database sessions, rate limiting and the admin plugin. `src/app/api/auth/[...all]/route.ts` delegates to this handler. `src/app/api/account/password/route.ts` permits an authenticated password setup flow. There is no MKL adapter/link record, issuer+subject uniqueness constraint, MKL verification configuration or Continue with MKL flow. The ordinary Better Auth `account` table is not evidence of an approved MKL identity bridge. Provider linking defaults must be explicitly reviewed in B2; this audit does not assert the current library defaults prohibit email linking.

**TARGET local identity invariants:** Keep the stable local `user.id` as content owner; linking does not move or duplicate documents. Require authenticated control of the local account, fresh verified control of the intended MKL identity, deliberate confirmation, anti-replay protection and an audit event. Uniquely associate issuer+subject with one local customer account. Conflicting links must stop for explicit recovery; email equality, an email change or an external role claim must never merge accounts or grant local admin.

**DEPENDENCY ON MKL B1 — required outputs, with protocol left open:**

- An approved generic application identity and trust-registration contract, including how TulisAI validates the origin, intended application, stable subject, proof freshness, replay resistance and key/trust rotation or revocation.
- The authoritative issuer+subject semantics and subject lifecycle, including deletion/recreation/reassignment guarantees; verified attributes are profile data, not linking keys.
- A supported user authentication handoff, explicit account-link proof, error/retry semantics and identity availability/revocation behavior. TulisAI must be able to distinguish successful authentication from cancelled, expired, invalid or replayed proof.
- A verified way to bind entitlement/purchase facts to the linked customer and registered application without trusting client-selected identity values. No endpoint, token format or claim spelling is prescribed here.

**TARGET / LOCKED OD-3 — unlink:** Require reauthentication and a verified alternative local sign-in method; show the impact and audit actor/time/old link/reason. Unlink does not cancel an MKL subscription/order, refund, reset Free allowance, transfer or reset top-up balance, or delete content. MKL-derived paid use fails closed and suspends locally until a valid identity link is restored or an approved recovery path reconciles it. Retain provenance/tombstone records so restoration cannot replay grants; historic document portability remains. B2/B3 define the recovery mechanics without changing these locked effects.

**TARGET provider failure:** Do not create an identity/link from unverified data. Existing valid local sessions and supported local credentials continue according to local session/security rules. If MKL-only sign-in is unavailable, return a retryable failure; never bypass authentication or substitute email-based linking. Paid access follows D's cached-verification rules, independently of sign-in success.

**TARGET / LOCKED OD-4 — retained flows:** Continue with MKL is the primary self-service path for new customer accounts after integration. Existing local username/email/password and existing Google sign-in remain supported for existing-user sign-in and recovery. Keep password change/reset (subject to configured email), session sign-out/revocation and profile/email maintenance consistent with those existing-user flows. Never auto-link by email. Local admin identity/access remains separate. B2 defines the routing and recovery UX under this approved policy; no additional new-account registration policy is invented in B0.

## D. Entitlement projection contract

**CURRENT / CONFLICT with integrated authority:** `entitlement()` in `src/server/usage/quota.ts` reads `user.role`, `user.tier`, `ai_limit_override`, `ai_character_limit_override`; no verified commercial fact is involved. Local `user.tier` is the effective commercial tier today. The function name does not imply an MKL projection.

**TARGET minimum verified facts (semantic requirements):**

| Fact | Required validation/use |
| --- | --- |
| Entitlement identity | Stable authoritative identity for deduplication, renewal association and audit |
| Customer binding | Verified link to the intended issuer+subject and local owner; no email inference |
| Application/product identity | Exact approved TulisAI registration; never accept another application's entitlement |
| Plan code | Approved mapping to Free / Plus / Pro / Max; unknown code is not a paid grant |
| Plan version when supplied | Preserve and validate against supported semantics; unsupported supplied versions cannot silently map to the current catalogue |
| Status | Explicit authoritative interpretation of active, pending, cancelled-but-active, expired and revoked/error states; MKL defines vocabulary |
| `period_start`, `period_end` | Verified instants with start < end; B1/B3 must specify precise boundary semantics (start-inclusive/end-exclusive design); never derive from `YYYY-MM` |
| Cancellation/expiry state | Distinguish cancelled renewal with remaining paid access from expired/revoked access |
| Verification/source timestamp | Store authoritative source time plus local verification time and origin/provenance; detect stale/replayed facts |
| Ordering/revision evidence | MKL-provided means to reject out-of-order or contradictory updates; exact representation belongs to B1/B5 |

**TARGET / DEPENDENCY ON MKL:** A subscription or renewal creates at most one included grant for the unique verified entitlement period. Re-fetching, replaying a notification, signing in again or changing profile data cannot replenish it. Commercial plan/period facts must be jointly valid before capabilities or paid allowance become active. Revocation/corrections need an authoritative recovery process, not local guesswork.

**Fail closed:** Unknown, malformed, wrong-customer, wrong-application, contradictory, unsupported-version or stale facts cannot grant/extend paid capabilities, included allowance, top-up purchase eligibility or spendability. Preserve last verified evidence and audit the rejection; quarantine conflicts and refresh from authority. Do not choose the highest of overlapping plans or synthesize a new period. A future period does not activate early. Cancellation alone does not shorten a still-valid verified period.

**TARGET / LOCKED OD-6 — outage/recovery:** Cached paid access is never indefinite. A cached projection is usable only while its verified period is active, its defined freshness window has not expired, and no known revocation/conflict invalidates it. Never extend past `period_end`. Stale/unknown state disables paid operations and freezes purchased spending; it does not delete data or renew Free trial. Owner access/manual save/portability continues. Refresh retries must be bounded and idempotent, reconciling existing grants without duplication. Exact verification freshness TTL, clock skew, revocation guarantees and recovery objectives are delegated B1/B3 technical contract parameters and must be defined before B7. B0 deliberately supplies no numeric TTL.

**Admin/manual override reconciliation:** CURRENT `src/app/api/admin/users/route.ts` POST calls `setTier`; `src/app/api/admin/users/[id]/route.ts` PATCH permits tier and request/character overrides, then records an audit entry. `src/server/admin/service.ts` directly updates those fields; admin role implies unlimited use. **TARGET / LOCKED OD-5:** After MKL becomes commercial authority, admin routes must not manufacture customer commercial tiers or paid wallet balance. Tier becomes verified projection/cache (or is replaced by a projection table). If support/test access is retained, represent it separately as a noncommercial, audited, reasoned, expiring support/test grant; it must not impersonate a purchase or confer commercial purchase eligibility. Legacy Team stays compatibility-only → Pro and is never offered commercially. Legacy users require explicit migration/reconciliation, never silent conversion into paid MKL purchases. Keep local admin authorization separate and disable conflicting commercial overrides at cutover unless reconciled through this policy.

## E. Character wallet contract

**CURRENT / MISSING:** There is one `usage_ledger.charge_characters` aggregate, not two wallets. No purchased lot, verified fulfillment, reservation allocation, period grant or freeze/expiry model exists (`src/db/schema.ts`, all eleven migrations). Catalogue `TOP_UPS` and `purchase_topup` are not a wallet.

**LOCKED packs:** Rp19,000 → 15,000 characters; Rp49,000 → 45,000; Rp99,000 → 100,000. Only active paid Plus/Pro/Max may buy/use top-ups. Included allowance is consumed first, then purchased characters. Purchased characters expire 12 calendar months from the authoritative MKL purchase/fulfillment timestamp; generic MKL B5 owns the exact arithmetic (OD-12). They freeze without active paid entitlement, unfreeze when paid entitlement is active again, and never grant capabilities or change plan.

**TARGET internal model — design requirements, not a migration or MKL schema:**

1. **Free grant:** A distinct once-per-local-account grant with durable consumed/reserved accounting. Linking/unlinking, renewal and downgrade never reissue it. Paid usage must not be mistaken for Free-trial consumption; legacy aggregate cutover must follow locked OD-5 reconciliation.
2. **Included grant:** Owner, verified entitlement identity, application, plan/version, immutable period identity and verified start/end, original granted amount, reserved/settled totals, verification provenance and status. Uniqueness must prevent repeated grants for the same commercial period. No calendar rollover. Unused included allowance becomes unavailable at period end; paid included allowance never rolls over into a later entitlement period (LOCKED OD-7).
3. **Purchased lot:** Owner/customer binding, unique verified MKL fulfillment reference, purchase/order provenance, original amount, remaining amount, reserved amount, purchase timestamp, authoritative MKL purchase/fulfillment timestamp used for validity, MKL-calculated expiry timestamp, current spendability state and verification/audit references. Preserve sold-offer/version metadata when supplied by MKL. Local pack ID or browser success is insufficient provenance. Validity is 12 calendar months from the authoritative MKL purchase/fulfillment timestamp, using the generic B5 month-end/timezone rule. TulisAI stores the verified timestamps rather than separately computing expiry; local receipt, import or replay never starts a new validity term.
4. **Reservation/event:** Stable owner-scoped idempotency key, normalized request fingerprint, operation, source count, measurement version, maximum hold, reservation state, lease/deadline, verified entitlement snapshot/period, provider correlation and final result reference.
5. **Allocation:** Separate durable reservation-to-grant/lot records with reserved, settled and released quantities. One event can span included and multiple purchased lots. Record every allocation transition; aggregate `charge_characters` alone cannot reconstruct it.
6. **Audit:** Actor/source, event identity, causal reference, timestamp, prior/new state and reason for grants, holds, settlement, release, freeze, unfreeze, expiry, corrections and deduplication. Usage audit is not a financial ledger. Avoid storing raw writing/sample text as wallet audit material.

**Deterministic consumption:** For paid use, reserve from the active included entitlement-period grant first. Then consume unexpired purchased lots by earliest expiry, then purchase timestamp, then stable lot identity. Never consume expired or frozen lots. Free use consumes only the remaining once-only Free grant, never frozen purchased lots. No plan upgrade may be inferred from top-up availability.

**Concurrency:** Validate entitlement freshness/period, calculate spendable balance, allocate holds and insert the unique event in one atomic database operation/transaction with conditional balance checks. Require nonnegative remaining balance and total held+settled not exceeding the original grant net of verified adjustments. Do not perform read-balance then unguarded write. Different requests race for the same balance safely; same-key retries must deduplicate. A failed allocation rolls back all partial holds before any provider call. Single-ledger SQL guards can inspire this design but are not sufficient for multi-lot allocation.

**Settlement/release:** Exactly one terminal outcome per reservation; compare-and-set state and allocations atomically. Successful charge uses F's formula, allocated in the original consumption order; release excess holds from the last allocations first. Generation failure before a usable validated preview is delivered releases every allocation and charges zero. Later Apply failure caused by post-preview user/document state does not refund successful generation (OD-10). If final charge exceeds the hold, do not silently clamp or create debt: obtain a guarded incremental hold before delivering the result or reject/release the result for zero customer charge. A bounded-output reservation strategy can also satisfy this requirement if enforced and tested. Owner-visible limits must be explicit.

**Expiry/freeze/unfreeze — LOCKED OD-8:** Freeze prevents new spending and never extends lot expiry. A frozen lot can expire. Reactivation unfreezes only unexpired balance after fresh paid verification. Included expiry never moves residual allowance into purchased lots. A request validly reserved before entitlement/lot expiry may settle against its original eligibility snapshot only within a bounded execution lease, without reallocating to a later renewal. Released amounts after expiry remain expired, not spendable. B4 must derive the exact lease duration from provider/runtime timeouts and test it before B7. Known revocation or security invalidation requires reconciliation; the lease does not override verified refund/reversal restrictions in OD-9.

**Idempotency/recovery:** Unique fulfillment grants prevent duplication across notifications, polling and manual refresh. Unique request keys bind to payload fingerprints; mismatched replays fail. Resume or return the existing result/state, never call the provider again for the same event. Keep idempotency tombstones independently of short-lived preview payloads. Abandoned reservations require a recovery worker/reconciler with lease fencing so a late provider response cannot both settle and race a release. No usable result due to system failure means zero final charge. **LOCKED OD-9:** On verified MKL top-up refund/reversal, revoke/freeze the affected lot’s remaining unspent balance, preserve provenance and audit, and never create negative customer character debt for already-consumed characters. Fraud/abuse/account restriction is a separate authority/action, not wallet debt. B5/B4 define verified event ordering and atomic reconciliation, including outstanding holds, while preserving these rules; TulisAI does not issue local refunds.

## F. AI charging contract and current mechanics

**LOCKED lifecycle:** reserve BEFORE provider operation → provider operation → settle or release. Normal AI charges source characters actually processed. AI Mode charges `MAX(source characters, final output characters)`. Provider/system failure and generation/output validation rejection before a usable preview is delivered charge zero. A successfully delivered, validated preview is a billable completed AI use; later Apply failure caused by revision conflict, new user locks, changed document state or other post-preview user state does not refund that generation (LOCKED OD-10). Automatic internal repair does not create a second customer charge. Generate Again is a new usage event.

| Scenario | CURRENT evidence | Classification and TARGET |
| --- | --- | --- |
| Normal generation / analysis | `reserve()` holds source `.length`; generation validates scope; P09 also reserves source length | MATCH for source-only basis, CONFLICT for UTF-16 measurement versus locked Unicode code points (OD-11); context/sample/instructions/provider tokens are not a second customer charge |
| Reserve before provider | `call()` and `analyzeQuality()` reserve before `provider.generate` | MATCH for sequencing; retain it |
| AI Mode | Holds `2 × source`; calls `settleUsage(MAX(source, final output))`; SQL uses `MIN(existing hold, charge)` | PARTIAL / CONFLICT: exact MAX only within hold and with successful settlement; longer valid output can be undercharged; swallowed settlement errors can leave the larger hold charged |
| Provider failure | Provider wrapper returns failed result; `completeUsage` atomically marks failed and zeros charge | MATCH for handled failures with successful DB update; not a crash/durability guarantee |
| Pre-call validation/safety rejection | Checks fail before reservation | MATCH: zero charge |
| Post-call output rejection / repair failure / preview storage failure | `release`/`voidUsage` zeros main charge; catch covers processing after the initial `call()` | PARTIAL: intended zero-charge behavior exists, but release errors are swallowed |
| System failure | Initial `call()` is outside post-call try/catch; `completeUsage` can throw after a hold; P09 has no full recovery wrapper | CONFLICT with unconditional zero-charge promise; durable reconciliation/release missing |
| Automatic repair | Separate `:repair` event, `billable=false`, zero characters; excluded from monthly request guard | MATCH for no second customer charge; provider cost remains observable; burst guard may still refuse repair |
| Generate Again | `Workspace.tsx` generation sends a `newKey()` each time | MATCH: new successful attempt is charged; discarded previous successful result is not automatically refunded |
| Abandoned reservation | Maintenance only purges preview payloads and orphan snapshots | MISSING: no usage-hold lease/reaper; do not confuse preview expiration with reservation release |
| Concurrent reservation | Conditional `INSERT ... SELECT` includes character/request/burst checks; unique owner+key | MATCH for current single-aggregate guard; PARTIAL for future dual-wallet concurrency |
| Replay | Live identical preview returns reused result; existing ledger key returns pending/conflict; transformed payload matching is partial | PARTIAL: avoids duplicate spend but is not a full durable request-fingerprint/outcome replay contract |
| Late Apply validation failure | `applyPreview()` may reject against newly added locks/revision; does not void original charge | MATCH for locked OD-10: successful validated preview is billable; later revision conflict, new user locks or other post-preview user state does not refund it. Pre-delivery generation/output rejection remains zero-charge |

Important exact behavior: `settleUsage()` and `voidUsage()` catch DB errors without surfacing/retrying them. `completeUsage()` marks provider success before later validation and preview persistence. Therefore `status='completed'` alone is not proof of a delivered billable result; a rejected output can be completed with zero charge plus an error code. No source guarantee caps all P08 output at twice source length (`src/server/ai/core/index.ts`, `validators.ts`); a general 200,000 output ceiling is not a 2× cap. Existing shorter/longer-output tests do not prove arbitrary expansion or injected storage-failure recovery.

**Character unit — LOCKED OD-11:** Future commercial character measurement uses Unicode code points, not JavaScript UTF-16 `.length`. CURRENT charging uses `.length`, while local editor metrics use code-point counts; current charging therefore conflicts with the approved target for characters outside the BMP. B4 introduces a versioned measurement contract shared by UI, reservation and settlement so historical usage is not retroactively reinterpreted. Do not mix measurement versions within a grant. Normal scope is the actual processed selected/source text; AI Mode final output is the validated final text after internal repair/normalization, not raw provider JSON.

**Mechanics to retain:** `usage_owner_idem_unique`, provider/request correlation, prompt ID, source count, timestamps, token/cost/latency/error telemetry; server ownership/scope validation; reserve-before-call; conditional SQL guarding; zero-billable repair; request/burst safeguards; replay of a retained preview. `cost_usd` is provider operational cost, not a payment ledger.

**Mechanics to extend/replace:** Commercial use of `period_key`; overload of `charge_characters` as both hold and settlement; missing allocation records; mutable rather than append-auditable outcome; incomplete fingerprint validation (runtime/instruction not all compared); lack of durable release/settle retries and abandoned-hold recovery. Keep aggregate columns as derived compatibility/reporting values only if consistent with allocation totals. Do not backfill historical zero charges from source count.

**B4/B7 acceptance examples:** Two simultaneous holds cannot exceed spendable included+lot totals; fulfillment replay creates one lot; repair adds zero customer charge; a 100-source/250-final-output AI Mode result cannot silently settle to 200; an injected DB failure eventually releases an unusable operation; a stale worker cannot settle a lease already released; Generate Again is a fresh key; a replay with changed instruction is rejected; a month boundary does not reset a still-running MKL period. Also test Unicode code-point counting with supplementary characters, no debt on refund after partial consumption, and no refund for a successful preview followed by a user-state Apply conflict. These are future tests, not executed B0 results.

## G. Commerce boundary

**LOCKED authority:** MKL owns first-party application identity contract, offers, sold prices, orders, payments, financial ledger, invoices/refunds, subscription entitlement issuance, and top-up purchase/fulfillment authority. TulisAI owns product/writing UX, user-owned documents, AI execution, local usage metering, capability enforcement and the character-wallet projection derived from verified MKL facts.

TulisAI must never hold a Midtrans Server Key, integrate Midtrans directly, verify Midtrans callbacks, create an independent payment ledger, or become a second commercial source of truth. Generic MKL support must not contain a TulisAI-specific payment fork such as `if (product === "tulisai")`. Local provider-cost telemetry is permitted and distinct from customer financial records.

**CURRENT / MATCH boundary, MISSING integration:** No Midtrans integration was found. No MKL identity/entitlement/commerce implementation or checkout/purchase/fulfillment API exists in the audited TulisAI route inventory. `PlansDialog.tsx` shows catalogue prices and explicitly says payment is not live; pack rules are future policy. `user.tier` is admin-managed plumbing, not a paid subscription lifecycle.

**DEPENDENCY ON MKL B5 — generic capabilities required:**

| Need | Required semantics |
| --- | --- |
| Offer discovery | Verified product/application, eligible plan/pack, approved price/currency and applicable version/period terms; sold facts come from MKL |
| Checkout start | Authenticated customer/application binding and stable intent idempotency; enforce paid top-up eligibility, no early renewal/mid-period switching; no raw payment-provider integration in TulisAI |
| Order/purchase status | Authoritative pending/succeeded/failed/cancelled/expired interpretation and ownership; client return-page success cannot grant value |
| Entitlement refresh | Verified facts in D, ordered/replay-safe updates and reconciliation after missed notifications |
| Top-up fulfillment projection | Stable purchase/fulfillment identity, customer/product, grant quantity, purchase/expiry facts and final fulfillment authority; deduplicate against persisted provenance |
| Recovery | Status refresh after timeout, pending order reconciliation, missed/duplicate/out-of-order delivery, revocation/refund/correction handling |
| Idempotency | Same logical checkout/fulfillment intent cannot double-order/double-grant; changed-payload reuse rejected; retention/replay rules agreed |

No URL, protocol or token schema is defined here. B5 must work generically for first-party applications. TulisAI B6 must show pending/recoverable states honestly and refresh verified projections; successful browser navigation cannot write a tier or balance. **LOCKED OD-12:** Paid TulisAI plans use a one-calendar-month entitlement term; MKL owns calculation of `period_start`/`period_end`. Top-up validity is 12 calendar months from the authoritative MKL purchase/fulfillment timestamp. Exact month-end/timezone arithmetic belongs to one generic MKL B5 implementation, never a separate TulisAI calculation. A one-month entitlement term is not a UTC calendar-month quota reset.

## H. Subscription and wallet lifecycle

**LOCKED launch/V1:** One-calendar-month paid entitlement term calculated by MKL; manual renewal; no recurring debit, proration, mid-period plan switch, or early renewal unless explicitly designed later. Cancellation preserves paid capabilities through `period_end`. Expiry falls back to Free capabilities; no user content is deleted because of expiry. Purchase and renewal authorization belong to MKL.

| From | Verified trigger | To / effect |
| --- | --- | --- |
| FREE | Paid entitlement starts and is verified | PAID_ACTIVE; create included grant exactly once; unfreeze eligible unexpired lots |
| PAID_ACTIVE | Cancellation effective at period end | CANCELLED_ACTIVE_UNTIL_PERIOD_END; same capabilities and remaining wallets until verified end |
| PAID_ACTIVE or CANCELLED_ACTIVE_UNTIL_PERIOD_END | Verified period ends without replacement | EXPIRED; Free capabilities, historic portability, no new trial; freeze purchased balance |
| EXPIRED | Manual renewal verified after prior period ends | RENEWED transition → PAID_ACTIVE for new verified period; one new included grant; unfreeze unexpired lots |
| FREE / EXPIRED | Pending/failed payment or unverified return | No paid grant; retain content and existing noncommercial access |
| Any paid state | Stale/contradictory/invalid proof | Verification-suspended projection; paid use fails closed under D; not an invented cancellation/refund |

RENEWED is an auditable transition, not a permanently parallel subscription. Cancellation does not automatically schedule a charge. No future entitlement or client clock can activate access early. A later manually purchased plan can differ only under a new approved period after the old one has ended, without prorating or switching the active period.

| Wallet type/state | Transition |
| --- | --- |
| Included ACTIVE | Eligible only in its verified period; exhausted means no spendable allowance; period end → EXPIRED |
| Purchased ACTIVE | Can spend after included allowance while fresh paid entitlement is active |
| Purchased FROZEN | No paid active entitlement or verification suspended; retain balance and original expiry |
| Purchased FROZEN → ACTIVE | Fresh paid entitlement restored before lot expiry; no new grant, no expiry extension |
| Purchased ACTIVE/FROZEN → EXPIRED | MKL-calculated expiry reached (12 calendar months from authoritative purchase/fulfillment time); terminal spendability, preserve audit/provenance |

CURRENT has none of these commercial transitions; `user.tier` has no period/end/cancellation field. Free’s account-wide SUM also includes prior paid charged rows, so it cannot separately establish unused Free-trial balance after downgrade. **LOCKED OD-7:** Free 3,000 characters are once per local account. Downgrade never creates a new grant; a demonstrably unspent remainder of the original grant may remain available. Paid included allowance never rolls over into a later entitlement period. B3/B4 migration must preserve evidence and must not invent historical allocation.

## I. Data portability and the DOCX conflict

**LOCKED:** Existing user-owned content remains readable, manually editable, saveable and exportable after expiry/downgrade. Free does not gain ordinary paid DOCX access. Portability must not restore Advanced Workspace, paid AI, Pro editing capabilities, import or unrelated features.

**CURRENT / PARTIAL:** Owner-scoped `getDocument`, `saveDocument`, `autosaveDocument` and versions do not require paid access. Autosave strips a submitted unauthorized `advanced` flag instead of rejecting the content save. Workspace gates paged rendering. Existing structured content is accepted by the shared editor schema; the server does not enforce every formatting control separately. Preservation of existing formatting must not be confused with authorization to add new paid editing features.

**CURRENT / CONFLICT:** The only document file-export route first calls `requireFeature(user.id, 'docx_export')`. A downgraded Pro/Max owner fails this gate regardless of ownership/history. Current UI FAQ promises export after subscription end (`PlansDialog.tsx`), which the route does not fulfill. Clipboard copy is useful but is not proof of complete portable document export.

**Approved narrow exception — LOCKED OD-13:** An owner-owned document with trusted historical evidence of Pro/Max DOCX eligibility remains exportable to DOCX after downgrade/expiry, including subsequent manual edits to that owned document. Export the currently saved revision using stored structure/layout. This document-specific exception does not restore Advanced Workspace, DOCX import, paid AI, AI Mode, new premium editing controls or global Free DOCX entitlement. It does not authorize arbitrary upload conversion, new advanced-document creation or arbitrary page-layout overrides. Check ownership and trusted historic eligibility on every export; repeated downgrade/reactivation must not manufacture eligibility from a client timestamp.

For owned documents that never had DOCX eligibility, retain a baseline portable export path in nonpremium format(s). Exact UX/format is delegated to B3/B6 without granting DOCX entitlement. This is a TARGET requirement, not an existing endpoint or implementation. Legacy documents lacking sufficient provenance require an audited migration/fallback policy; never trust client timestamps or arbitrary client claims.

No commercial expiry date may delete content or silently flatten its existing structure during save. Existing advanced layout may be preserved for faithful export while paid editing controls stay locked. Legacy document eligibility needs trusted historical evidence and an audited migration/fallback policy under locked OD-5/OD-13; current `created_at`, `preferences.advanced` or a client claim alone is not proof of a paid period. The required provenance does not exist today. Do not use absence of legacy provenance as an excuse to permanently deny portability; route unresolved cases through an auditable approved fallback.

## J. Current-source reconciliation and independently verified findings

| # | Finding tested against source | Result | Exact evidence / qualification | Delivery owner |
| --- | --- | --- | --- | --- |
| 1 | Free / Plus / Pro / Max catalogue exists | MATCH | `src/lib/plans.ts`: `TIERS`, `PLAN_LIMITS`; `tests/review/plan-catalogue.test.ts` | TULISAI-LOCAL |
| 2 | Prices / included amounts match locked values | MATCH for constants; PARTIAL effective behavior | Same catalogue; `src/server/usage/quota.ts`: overrides and calendar period differ | TULISAI-LOCAL + MKL B1/B5 |
| 3 | Paid server gates exist | MATCH for named gates; PARTIAL complete boundaries | `src/server/usage/features.ts`, `src/server/writing/styles.ts`, `src/server/documents/service.ts`, import/export routes, `generatePreview` | TULISAI-LOCAL B3 |
| 4 | AI Mode charges MAX(source, output) | PARTIAL / CONFLICT outside held amount | `src/server/ai/service.ts`: 2× hold and `settleUsage` MIN clamp; core validation does not enforce a matching hard ratio | TULISAI-LOCAL B4 |
| 5 | Failed/rejected results release charge | PARTIAL | `completeUsage`, `voidUsage`, `release`; normal paths exist, DB/crash recovery incomplete | TULISAI-LOCAL B4 |
| 6 | Team maps to Pro | MATCH | `asTier`, admin `summary`, catalogue and entitlement tests; Team not a sellable tier | TULISAI-LOCAL compatibility |
| 7 | Top-up catalogue exists; lifecycle absent | PARTIAL catalogue, MISSING lifecycle | `TOP_UPS`, `TOP_UP_VALIDITY_MONTHS`; no purchase route/lot schema | MKL B5 + TulisAI B4/B6 |
| 8 | MKL identity bridge absent | MISSING | `src/server/auth/auth.ts`, auth route, `src/db/schema.ts`, route/search inventory | MKL B1 → B2 |
| 9 | MKL entitlement projection absent | MISSING | `src/server/usage/quota.ts`: local user row; no entitlement table/migration | MKL B1/B5 → B3 |
| 10 | MKL commerce absent | MISSING | `src/app/api` inventory, runtime/config and source searches | MKL B5 → B6 |
| 11 | Paid quota uses calendar YYYY-MM | CONFLICT with integrated target | `periodKey`, `usageSummary`, reserve guards; admin queries/UI labels | B3/B4/B6 |
| 12 | No separate included / purchased wallet | MISSING | `src/db/schema.ts`: `usageLedger`; migrations 0000–0010 | B4 |
| 13 | Plans UI states payment inactive | MATCH | `src/components/app/PlansDialog.tsx`: notice/button/top-up activation label | B6 later |
| 14 | Max personalization boundaries incomplete | CONFLICT | `settings.ts`, `styles.ts`, runtime normalization and `generatePreview`; `extra`/sample accepted below Max | B3, OD-1 |
| 15 | DOCX gate conflicts with downgrade portability | CONFLICT | `src/app/api/documents/[id]/export/route.ts`; `PlansDialog.tsx` expiry FAQ | B3/B6, OD-13 |
| 16 | No direct Midtrans integration | MATCH boundary | Case-insensitive repository text search; runtime/env/config/API inventories | Maintain MKL authority |
| 17 | No final P00-02 artifact existed at baseline | MISSING at baseline | `docs`/tracked file inventory and contract-ID search; this file now records the approved contract; implementation gaps remain | B0 contract gate complete |

Additional reconciliation:

- **CONFLICT:** Direct admin tier/character override mutation remains authoritative (`src/server/admin/service.ts`, admin users routes); requires explicit cutover design, not relabeling as a projection.
- **PARTIAL:** Read/manual save ownership protection exists; portability and granular premium editing boundaries are incomplete (`src/server/documents/service.ts`, `Workspace.tsx`). Existing Skills remain listable/deletable, while post-downgrade requests must enforce locked OD-2 capability boundaries.
- **CONFLICT:** Commercial metering uses UTF-16 `.length` instead of the approved Unicode code points; B4 must version the new metric without rewriting historical charges (`src/server/ai/service.ts`, `src/lib/editor/metrics.ts`).
- **MISSING:** Subscription cancellation/expiry/renewal and commercial stale-state recovery; abandoned usage reservation recovery; durable lot/allocation provenance.
- **CONFLICT / UI ahead of implementation:** Expiry FAQ promises export; AI failure FAQ promises zero charge without complete durable recovery; AI Mode FAQ claims exact MAX without the hold caveat. Renewal/freeze/expiry language describes intended policy, not implemented lifecycle, despite the honest payment-unavailable notice. Max-specific `extra`/sample marketing was removed, correctly avoiding a false enforced distinction, but that does not satisfy the locked target.
- **CONFLICT / documentation drift:** `worker-configuration.d.ts` still declares `AI_MONTHLY_CHARACTER_LIMIT`, while `src/server/runtime.ts` and `wrangler.jsonc` use `AI_FREE_CHARACTER_ALLOWANCE`. README's migration comment says 0000–0002 although eleven migrations exist. Historical task/verification sections describe superseded limits and features; use source for CURRENT and this owner request for LOCKED.
- **DEFERRED:** PDF launch entitlement, recurring debit, proration, mid-period switching and early renewal. No evidence here promotes them to launch scope.

**Calendar assumptions to change:** `quota.ts` period generation/character sums, `ai/service.ts` hold scope/insert/refusal diagnosis, entitlement-period request safeguards as approved, `admin/service.ts` per-user quota joins/summaries, `PlansDialog.tsx` and `components/admin/*` quota labels, usage API consumers, and tests that encode calendar resets. Keep calendar-month operational cost/traffic reports when explicitly labeled as analytics; they must not reset commercial allowance. `period_key` may remain a reporting dimension alongside a new verified period key.

## K. Implementation dependency graph

| Track | Status | Scope | Prerequisites / exit evidence |
| --- | --- | --- | --- |
| B0 | COMPLETE | PRD / contract reconciliation | Contract gate complete: explicit owner approval and OD-1–OD-13 incorporated on 2026-09-19 |
| B1 | COMPLETE / MERGED | Generic MKL application identity/contract support | Approved B0 requirements; approved identity/trust/customer/application semantics usable by multiple apps |
| B2 | COMPLETE / MERGED | TulisAI identity bridge | B0 approval + B1 stable contract; explicit linking/no email merge/admin isolation and recovery tests; merged through TulisAI PR #2 |
| B3 | NEXT | Entitlement/capability projection | B0 approval + B1 verified fact contract + B2 identity binding; consume B5 authoritative issuance for commercial end-to-end validation |
| B4 | NOT STARTED | Character wallets | B0 approval + B3 period/capability semantics; B5 fulfillment/correction contract for actual purchased lots |
| B5 | NOT STARTED | Generic MKL app-commerce support | B0 approved commercial requirements + B1 application/customer binding; can progress alongside B2/B3/local B4 design |
| B6 | NOT STARTED | TulisAI commercial frontend | B2/B3/B4 usable interfaces + B5 approved commerce; truthful offers, pending states, refresh/recovery |
| B7 | NOT STARTED | Joint QA | B1–B6 integrated; identity, entitlement, wallets, portability, replay/concurrency/failure and legacy acceptance evidence |
| B8 | NOT STARTED | Sandbox | B0–B7 complete and approved for real Sandbox acceptance; obey L |
| B9 | NOT STARTED | Production | Successful B8, production readiness/release approvals and operational recovery evidence |

Dependency shape: B0 → B1 → B2 → B3 → B4; B1 → B5; B3/B4/B5 → B6; all integration paths → B7 → B8 → B9. B3/B4 implementation can be developed against approved contracts with local fixtures while B5 progresses, but no purchased-wallet completion is claimed before verified B5 fulfillment is integrated.

**Later-phase TULISAI-LOCAL parallel opportunities under approved B0:** premium-field gate reconciliation, document portability design/implementation under OD-13, isolated local wallet/allocation tests under approved period/fulfillment semantics, legacy/admin migration planning, and truthful commercial UI preparation. B2 requires B1's protocol before real authentication wiring; B3/B4 must not fabricate MKL facts. Local fixtures do not establish production trust. No B2/B3/B4/B6 code is part of B0.

## L. Sandbox convergence — nonblocking Track A

**LOCKED:** TulisAI MAY join the same Sandbox acceptance window as Mari Rekap only if B0–B7 are complete before Track A starts its real Sandbox acceptance. If TulisAI is not ready, Mari Rekap proceeds without waiting and TulisAI enters B8 later. Track B must never delay Track A (MKL + Mari Rekap). B0 approval or a local test pass alone does not meet B0–B7 completion. Do not move Track A's schedule to accommodate this dependency graph.

## M. Migration implications and inventory

No migrations are created or applied to D1 in B0. The existing SQL was inspected and applied only to an in-memory Node SQLite database; all eleven scripts succeeded.

| Existing migration | Observed purpose |
| --- | --- |
| `migrations/0000_initial.sql` | Local auth/accounts, user preferences, documents/versions/locks, transformations, usage ledger, maintenance state |
| `migrations/0001_username_auth.sql` | Username unique index and auth rate-limit table |
| `migrations/0002_workspace_metadata.sql` | Onboarding/use-case preferences; version prompt/scope metadata |
| `migrations/0003_notebook_appearance.sql` | Document color/icon |
| `migrations/0004_writing_styles.sql` | Owner-scoped style snapshots and unique names |
| `migrations/0005_user_role.sql` | Local user role |
| `migrations/0006_admin_panel.sql` | Bans, tier, request override, admin note, impersonation metadata and admin audit |
| `migrations/0007_usage_created_index.sql` | Usage chronological index |
| `migrations/0008_style_description.sql` | Style description metadata |
| `migrations/0009_usage_cost.sql` | Provider `cost_usd` telemetry |
| `migrations/0010_character_quota.sql` | Charge characters, covering owner/period/charge index and character override; intentionally no historic charge backfill |

| Classification | Required implication |
| --- | --- |
| Existing schema reusable | Stable user/content ownership, local auth sessions/credentials, document/version storage, style snapshots, usage identity/provider telemetry, audit foundation |
| Field becomes projection/cache rather than authority | `user.tier` and derived feature/limit state for MKL-linked commerce; `period_key` can remain analytics only; current quota override is not a commercial grant |
| Additive migration required | External issuer+subject links with uniqueness and auditable lifecycle; verified entitlements/period grants; purchased lots/fulfillment dedupe; reservations/allocations/state transitions/leases; request fingerprints; verification/order evidence and portability eligibility |
| Compatibility handling required | Team → Pro local alias; existing Better Auth sign-in; saved content/style structures; `usage_ledger` aggregates/readers; legacy generated env declarations; local admin isolation |
| Legacy data migration potentially required | Existing manual tiers/overrides, account trial usage, old `period_key` rows, documents qualifying for portability and premium `extra`/sample snapshots; owner-approved evidence-based mapping, never fabricated MKL purchases |

`src/db/schema.ts` is not the complete migrated database description: SQL creates `user_preferences` and `maintenance_state`; migration 0008 adds `writing_styles.description`, which the current Drizzle style definition omits even though the service uses it. Future migration work must compare actual migration history/schema, not generate replacements blindly from this partial declaration. Preserve the deliberate zero-charge historical treatment in 0010. Existing ledger provenance has request/provider/prompt/time/source/charge totals but **does not identify included grants or purchased lots**; additional allocation records are mandatory for dual-wallet reconciliation.

## N. Owner decision register and delegated technical parameters

All OD-1 through OD-13 are **OWNER DECISION LOCKED — approved 2026-09-19**. The register and main sections express the same approved rules. No unresolved B0 owner decision remains. CURRENT conflicts remain implementation work; contract approval does not change source behavior.

| Decision | Approved rule | Later implementation responsibility |
| --- | --- | --- |
| OD-1 | Persistent free-text personalization/custom instructions, sample/style reference and free-form AI Mode are Max-only; ordinary structured six-mode controls remain core | B3 field/alias enforcement |
| OD-2 | Existing saved Styles/Skills remain visible/deletable after downgrade; create/modify requires Plus+; new requests cannot apply premium settings to bypass gates; embedded nonpremium document settings remain | B3 capability enforcement |
| OD-3 | Reauthenticate and verify alternate local sign-in before unlink; no subscription/order cancellation, refund, Free reset, top-up transfer/reset or content deletion; MKL-derived use suspends until restored link/reconciled recovery | B2/B3 link and recovery mechanics |
| OD-4 | Continue with MKL is the primary new-customer self-service path; existing local credentials and existing Google sign-in/recovery remain; no email auto-link; local admin identity separate | B2 routing and recovery |
| OD-5 | Team stays compatibility-only → Pro; admin cannot manufacture commercial tiers/paid balances; retained support/test grants must be separate, noncommercial, audited, reasoned and expiring; explicit legacy reconciliation, no fabricated purchases | B3/B4 migration and admin cutover |
| OD-6 | Cached paid access is never indefinite | B1/B3 define exact freshness TTL, clock skew, revocation guarantees and recovery objectives before B7; no numeric B0 TTL |
| OD-7 | Free 3,000 once per local account; no new downgrade grant; demonstrably unspent original remainder may remain; paid included allowance never rolls over | B4 grant/allocation accounting |
| OD-8 | Valid pre-expiry reservations may settle against original eligibility only within a bounded execution lease; freeze never extends lot expiry | B4 derives lease duration from provider/runtime timeouts and tests it before B7 |
| OD-9 | Verified refund/reversal revokes/freezes affected unspent lot balance, never creates debt for consumed characters, and preserves provenance/audit; fraud/abuse restrictions are separate actions | B5/B4 verified event and hold reconciliation |
| OD-10 | Delivered validated preview is billable; later Apply failure due to revision conflict, new locks or changed post-preview user/document state does not refund; pre-delivery generation/output validation failure charges zero | B4/B7 lifecycle tests |
| OD-11 | Commercial characters use Unicode code points; no future UTF-16 meter or retroactive reinterpretation of history | B4 versioned measurement contract, B6 consistent display |
| OD-12 | Paid term is one calendar month calculated by MKL; top-ups last 12 calendar months from authoritative MKL purchase/fulfillment time; arithmetic is generic MKL responsibility | B5 month-end/timezone and authoritative timestamp semantics; TulisAI consumes verified periods/expiry |
| OD-13 | Trusted historically Pro/Max-eligible owned documents retain DOCX export with subsequent manual edits; no paid capability restoration; insufficient legacy evidence requires audited migration/fallback; never-eligible content retains nonpremium portability | B3/B6 exact baseline export UX/formats and migration/fallback implementation |

**Delegated details, not B0 approval blockers:** B1/B3 must specify verification freshness TTL, clock skew, revocation/recovery guarantees and precise validity-boundary semantics before B7. B4 must specify and test the execution lease before B7 and introduce the versioned Unicode code-point measurement contract without rewriting historical usage. B5 must implement one generic month-end/timezone rule and authoritative purchase/fulfillment timestamp semantics; TulisAI must not independently calculate commercial dates. B3/B6 finalize baseline nonpremium export UX/formats and the audited legacy portability fallback. B2/B3 define link restoration/recovery mechanics; B5/B4 define ordered, atomic refund/reversal reconciliation. These details must obey the locked decisions and the existing dependency graph.

Answers to the 16 requested questions:

1. Persistent instruction candidates are `Settings.extra` with `customized`, persisted in notebook preferences/style snapshots; runtime additional instruction aliases are accepted. No separate account-wide free-text field exists. Locked OD-1 makes persistent free text and sample/style reference Max-only; B3 maps aliases without treating ordinary structured settings as premium.
2. Writing sample is `Settings.sample`, runtime `style_sample`/`style_reference`; style description is metadata only.
3. Yes: both are accepted below Max on backend paths; Plus can persist them in styles. Free direct runtime/preferences are not Max-gated.
4. Approved owner-only DOCX export for trusted historically eligible owned documents, including subsequent manual edits, without restoring Pro editing/import/AI or global Free DOCX; locked OD-13 also requires nonpremium portability for never-eligible content.
5. Quota/hold aggregation, paid request safeguards, per-user admin quota reporting and UI month-reset claims need separation from verified periods; operational month reports may remain.
6. Retain usage idempotency uniqueness, pre-provider reservation, guarded SQL, correlation/telemetry, repair-zero-charge and ownership checks; add durable terminal outcomes/recovery.
7. Add period grants, purchased lots, explicit allocations, expiry/freeze state and atomic multi-balance settlement; a SUM of `charge_characters` cannot implement this.
8. Yes, `asTier('team') → pro` is already compatibility-only; no Team sale. Historical MKL period legitimacy still needs reconciliation.
9. Existing local username/email/password and existing Google sign-in/recovery remain supported; Continue with MKL is the primary self-service path for new customers. No email auto-link; local admin identity stays separate (locked OD-4).
10. `user.tier`, with admin role and quota overrides affecting effective access.
11. Tier/effective entitlement state must become verified projection/cache; overrides cannot remain an alternative commercial authority.
12. Yes: expiry export and unconditional failure/MAX-charging promises exceed complete implementation; lifecycle/top-up prose is future policy behind payment-unavailable UI.
13. Yes: admin user create and PATCH routes call `setTier`/`updateUser`, and can grant quota overrides.
14. Remove admin commercial mutation authority at integration cutover; any retained support/test access must be a separate noncommercial, audited, reasoned, expiring grant (locked OD-5).
15. Valid local content access continues; only fresh, unexpired, noncontradictory cached verification can sustain paid operations; otherwise fail closed and reconcile idempotently (OD-6).
16. No: usage ledger lacks wallet/grant/lot allocation provenance; additional allocation records are required.

## O. Historical audit evidence and docs-only approval validation

**Inspected:** README, task and verification history; `src/lib/plans.ts`; all usage services; AI service and relevant core normalization/provider/validation paths; Better Auth config and catch-all auth handler; account password flow; DB schema; writing settings/style mappings; PlansDialog; Workspace generation, persistence and feature gates; writing controls/StyleDialog; document service and DOCX import/export routes; settings route; admin service/create/update routes and tier/usage UI; contracts; storage maintenance and worker scheduling; runtime and environment declarations; `wrangler.jsonc`; all 0000–0010 migrations; package/vitest configuration; plan-catalogue, entitlement, document-safety, rejection-codes, writing-skills-extras tests and relevant test-case inventories. Repository API/file inventory and full text search covered the broader commercial/auth surface. Source files were not changed.

**Repository-wide searches:** Explicit-root case-insensitive `rg` searched MKL, Midtrans, subscription, billing, checkout, payment, top-up, topup, entitlement, tier, plan, period_key, GOOGLE, Better Auth, DOCX, sample, extra, custom instruction, personalization, wallet and usage_ledger. The initial broad application/documentation search excluded the lockfile and generated art JSON to keep results readable. A final whole-tree text search included those files and hidden files, excluding only Git internals and the then-new draft (304 files searched). MKL matches were verification prose and incidental lockfile integrity-hash substrings, not integration code; no Midtrans implementation or baseline P00-02 artifact matched. Dedicated searches plus schema/config/route inventories underpin these absence findings. Search results do not establish external-system behavior.

The following table records the earlier B0 source-audit run; it is historical evidence, not a fresh application test run for this approval task.

| Validation | Historical B0 audit result |
| --- | --- |
| Baseline and branch | Clean `main`, local and origin/main both expected SHA; local `codex/tulisai-b0-contract` created before editing |
| Targeted existing Vitest suites | NOT RUN: no repository `node_modules`; `pnpm exec vitest run ...` failed before Vitest with EPERM while pnpm attempted automatic dependency setup. No successful install/upgrade; no retry permitting installation |
| Target suite selection | `tests/review/plan-catalogue.test.ts`, `entitlements.test.ts`, `document-safety.test.ts`, `rejection-codes.test.ts`, `writing-skills-extras.test.ts`, `admin-service.test.ts`, `tests/ai/instruction.test.ts` |
| In-memory migration verification | PASS: all eleven SQL migrations applied to Node `DatabaseSync(':memory:')`; inspected resulting tables and usage columns; no D1/R2 access |
| Source search / schema / route inventory | PASS as static audit, with absence scope qualified above |
| Document consistency / diff checks | PASS: sections A–O reviewed, 37 exact file references resolve, git diff --check clean, and the full new-file no-index diff reviewed with no whitespace diagnostics; only this document appears in Git status. The ordinary path diff is empty while the new file is untracked; no-index comparison was used to inspect its contents. These checks do not constitute application test passage |
| Paid-provider / browser / Sandbox / deployment checks | Not performed; outside B0 authorization |

Existing `docs/verification.md` claims 600 tests passed in a prior task. This is historical evidence only. The earlier B0 audit left the draft uncommitted because its targeted Vitest run could not start. The owner's subsequent explicit approval instruction authorizes a docs-only commit after document validation and supersedes that earlier test prerequisite. Application Vitest is not required for this documentation-only approval commit; no application tests, dependency installation or source changes are part of this finalization.

**Docs-only approval validation:** Verify Git status, ensure only `docs/TULISAI_BIZ_P00_02.md` changes, run `git diff --check` and staged whitespace checks, review the complete new-file diff, resolve all referenced repository paths, and compare OD-1–OD-13 with the main sections. No source, configuration or migration change is permitted. The task report records the validation result and local commit SHA.

**Approval outcome:** APPROVED — OWNER DECISIONS LOCKED 2026-09-19. **B0 COMPLETE** as a contract/reconciliation gate only. **READY FOR B1/B2 PLANNING: YES**, with B2 implementation dependent on the approved B1 technical contract. B1–B9 are not marked complete; this is not Sandbox/Production readiness or payment integration. No B1/B2/B3/B4/B5/B6 implementation is authorized by this finalization task. Track B must never delay Track A.
