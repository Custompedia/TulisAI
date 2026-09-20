import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", { id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(), emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false), image: text("image"), username: text("username"), role: text("role").notNull().default("user"), banned: integer("banned", { mode: "boolean" }).notNull().default(false), banReason: text("ban_reason"), banExpires: integer("ban_expires", { mode: "timestamp_ms" }), tier: text("tier").notNull().default("free"), aiLimitOverride: integer("ai_limit_override"), aiCharacterLimitOverride: integer("ai_character_limit_override"), adminNote: text("admin_note"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull() }, (t) => [uniqueIndex("user_username_unique").on(t.username)]);
export const sessions = sqliteTable("session", { id: text("id").primaryKey(), expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), token: text("token").notNull().unique(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(), ipAddress: text("ip_address"), userAgent: text("user_agent"), impersonatedBy: text("impersonated_by"), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }) }, (t) => [index("session_user_idx").on(t.userId)]);
export const accounts = sqliteTable("account", { id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }), refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }), scope: text("scope"), password: text("password"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull() }, (t) => [index("account_user_idx").on(t.userId)]);
export const verifications = sqliteTable("verification", { id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }), updatedAt: integer("updated_at", { mode: "timestamp_ms" }) }, (t) => [index("verification_identifier_idx").on(t.identifier)]);
export const rateLimit = sqliteTable("rate_limit", { id: text("id").primaryKey(), key: text("key").notNull().unique(), count: integer("count").notNull(), lastRequest: integer("last_request").notNull() }, (t) => [index("rate_limit_last_request_idx").on(t.lastRequest)]);
export const externalIdentityLinks = sqliteTable("external_identity_link", {
  id: text("id").primaryKey(), provider: text("provider").notNull(), issuer: text("issuer").notNull(), subject: text("subject").notNull(),
  organizationId: text("organization_id"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), profileEmail: text("profile_email"), profileName: text("profile_name"),
  linkMethod: text("link_method").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  lastAuthenticatedAt: integer("last_authenticated_at", { mode: "timestamp_ms" }),
}, (t) => [uniqueIndex("external_identity_link_issuer_subject_unique").on(t.issuer, t.subject), uniqueIndex("external_identity_link_provider_user_unique").on(t.provider, t.userId), index("external_identity_link_user_idx").on(t.userId)]);
export const user = users;
export const session = sessions;
export const account = accounts;
export const verification = verifications;
export const externalIdentityLink = externalIdentityLinks;

export const mklEntitlementProjections = sqliteTable("mkl_entitlement_projection", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  identityLinkId: text("identity_link_id").notNull().unique().references(() => externalIdentityLinks.id, { onDelete: "cascade" }),
  issuer: text("issuer").notNull(), subject: text("subject").notNull(), organizationId: text("organization_id").notNull(),
  applicationClientId: text("application_client_id").notNull(), applicationAppKey: text("application_app_key").notNull(), catalogItemId: text("catalog_item_id").notNull(),
  scopeRevision: integer("scope_revision").notNull(), authorityPayloadHash: text("authority_payload_hash").notNull(),
  entitlementId: text("entitlement_id"), status: text("status"), planCode: text("plan_code"), planVersion: text("plan_version"),
  periodStart: text("period_start"), periodEnd: text("period_end"), accessDeadline: text("access_deadline"), commercialKind: text("commercial_kind"), entitlementCreatedAt: text("entitlement_created_at"),
  serverTime: text("server_time").notNull(), verifiedAt: integer("verified_at", { mode: "timestamp_ms" }).notNull(), freshUntil: integer("fresh_until", { mode: "timestamp_ms" }).notNull(),
  invalidatedAt: integer("invalidated_at", { mode: "timestamp_ms" }), invalidationReason: text("invalidation_reason"), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("mkl_projection_identity_unique").on(t.issuer, t.subject, t.organizationId), index("mkl_entitlement_projection_freshness_idx").on(t.freshUntil, t.userId)]);

export const mklPurchaseIntents = sqliteTable("mkl_purchase_intents", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  identityLinkId: text("identity_link_id").notNull().references(() => externalIdentityLinks.id, { onDelete: "restrict" }), organizationId: text("organization_id").notNull(),
  purchaseKind: text("purchase_kind").notNull(), planCode: text("plan_code").notNull(), planVersion: text("plan_version").notNull(), offerId: text("offer_id").notNull(),
  offerContractJson: text("offer_contract_json").notNull(), offerContractHash: text("offer_contract_hash").notNull(), clientRequestKeyHash: text("client_request_key_hash").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(), mklIdempotencyKey: text("mkl_idempotency_key").notNull().unique(), buyerPhone: text("buyer_phone").notNull(), returnUri: text("return_uri").notNull(),
  mklOrderId: text("mkl_order_id").unique(), mklOrderNumber: text("mkl_order_number"), checkoutUrl: text("checkout_url"), orderStatus: text("order_status"), status: text("status").notNull(),
  fulfillmentId: text("fulfillment_id").unique(), lotId: text("lot_id"), purchaseRevision: integer("purchase_revision").notNull().default(0), purchasePayloadHash: text("purchase_payload_hash"),
  authorizationAttempts: integer("authorization_attempts").notNull().default(0), recoveryAttempts: integer("recovery_attempts").notNull().default(0), lastErrorCode: text("last_error_code"), terminalReason: text("terminal_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(), orderBoundAt: integer("order_bound_at", { mode: "timestamp_ms" }),
  reconciledAt: integer("reconciled_at", { mode: "timestamp_ms" }), terminalAt: integer("terminal_at", { mode: "timestamp_ms" }),
}, (t) => [uniqueIndex("mkl_purchase_owner_request_unique").on(t.ownerId, t.clientRequestKeyHash), index("mkl_purchase_owner_created_idx").on(t.ownerId, t.createdAt, t.id), index("mkl_purchase_recovery_idx").on(t.status, t.updatedAt, t.id)]);

export const capabilityGrants = sqliteTable("capability_grants", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), authority: text("authority").notNull(),
  capabilitiesJson: text("capabilities_json").notNull(), reason: text("reason").notNull(), issuedBy: text("issued_by").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), revokedAt: integer("revoked_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("capability_grants_user_active_idx").on(t.userId, t.expiresAt, t.revokedAt)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), title: text("title").notNull(), language: text("language").notNull(), preferencesJson: text("preferences_json").notNull().default("{}"), revision: integer("revision").notNull().default(0), bodyJson: text("body_json"), bodyR2Key: text("body_r2_key"), storageMode: text("storage_mode").notNull().default("d1"), originalVersionId: text("original_version_id"), color: text("color"), icon: text("icon"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
}, (t) => [index("documents_owner_updated_idx").on(t.ownerId, t.updatedAt, t.id)]);

export const documentPortabilityEvidence = sqliteTable("document_portability_evidence", {
  documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), authority: text("authority").notNull(), projectionRevision: integer("projection_revision"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("document_portability_owner_idx").on(t.ownerId, t.documentId)]);

export const pendingDocxImportEvidence = sqliteTable("pending_docx_import_evidence", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), contentHash: text("content_hash").notNull(),
  authority: text("authority").notNull(), projectionRevision: integer("projection_revision"), expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("pending_docx_import_owner_idx").on(t.ownerId, t.expiresAt)]);

export const writingStyles = sqliteTable("writing_styles", { id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(), color: text("color"), icon: text("icon"), settingsJson: text("settings_json").notNull().default("{}"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull() }, (t) => [uniqueIndex("styles_owner_name_unique").on(t.ownerId, t.name), index("styles_owner_created_idx").on(t.ownerId, t.createdAt, t.id)]);

export const documentVersions = sqliteTable("document_versions", {
  id: text("id").primaryKey(), documentId: text("document_id").notNull(), ownerId: text("owner_id").notNull(), kind: text("kind").notNull(), revision: integer("revision").notNull(), label: text("label"), snapshotR2Key: text("snapshot_r2_key").notNull(), snapshotHash: text("snapshot_hash").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), promptId: text("prompt_id"), scopeType: text("scope_type")
}, (t) => [index("versions_document_created_idx").on(t.documentId, t.createdAt, t.id), index("versions_owner_created_idx").on(t.ownerId, t.createdAt)]);

export const lockedTerms = sqliteTable("locked_terms", { id: text("id").primaryKey(), documentId: text("document_id").notNull(), ownerId: text("owner_id").notNull(), term: text("term").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull() }, (t) => [uniqueIndex("locks_document_term_unique").on(t.documentId, t.term), index("locks_document_idx").on(t.documentId, t.id)]);
export const transformations = sqliteTable("transformations", { id: text("id").primaryKey(), documentId: text("document_id").notNull(), ownerId: text("owner_id").notNull(), promptId: text("prompt_id").notNull(), promptVersion: text("prompt_version").notNull(), model: text("model").notNull(), sourceRevision: integer("source_revision").notNull(), sourceText: text("source_text").notNull(), anchorJson: text("anchor_json"), runtimeJson: text("runtime_json").notNull(), outputJson: text("output_json").notNull(), status: text("status").notNull(), idempotencyKey: text("idempotency_key").notNull(), expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), appliedAt: integer("applied_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull() }, (t) => [uniqueIndex("transforms_owner_idem_unique").on(t.ownerId, t.idempotencyKey), index("transforms_document_created_idx").on(t.documentId, t.createdAt, t.id)]);
export const usageLedger = sqliteTable("usage_ledger", { id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), operation: text("operation").notNull(), status: text("status").notNull(), periodKey: text("period_key").notNull(), requestId: text("request_id").notNull(), providerRequestId: text("provider_request_id"), promptId: text("prompt_id"), sourceCharacters: integer("source_characters"), chargeCharacters: integer("charge_characters").notNull().default(0), inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"), latencyMs: integer("latency_ms"), costUsd: real("cost_usd"), errorCode: text("error_code"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp_ms" }) }, (t) => [uniqueIndex("usage_owner_idem_unique").on(t.ownerId, t.idempotencyKey), index("usage_owner_period_idx").on(t.ownerId, t.periodKey, t.status), index("usage_owner_period_charge_idx").on(t.ownerId, t.periodKey, t.chargeCharacters)]);

export const characterWalletAccounts = sqliteTable("character_wallet_account", {
  ownerId: text("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }), freeGrantState: text("free_grant_state").notNull(),
  legacyReason: text("legacy_reason"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const characterGrants = sqliteTable("character_grants", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), kind: text("kind").notNull(),
  identityLinkId: text("identity_link_id").references(() => externalIdentityLinks.id, { onDelete: "restrict" }), entitlementId: text("entitlement_id"),
  applicationAppKey: text("application_app_key"), catalogItemId: text("catalog_item_id"), planCode: text("plan_code"), planVersion: text("plan_version"),
  periodStart: text("period_start"), periodEnd: text("period_end"), periodStartMs: integer("period_start_ms"), periodEndMs: integer("period_end_ms"),
  authorityRevision: integer("authority_revision"), authorityPayloadHash: text("authority_payload_hash"), originalAmount: integer("original_amount").notNull(),
  reservedAmount: integer("reserved_amount").notNull().default(0), settledAmount: integer("settled_amount").notNull().default(0), state: text("state").notNull(),
  measurementVersion: text("measurement_version").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("character_grants_spend_idx").on(t.ownerId, t.kind, t.state, t.periodEnd)]);
export const characterPurchasedLots = sqliteTable("character_purchased_lots", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  identityLinkId: text("identity_link_id").notNull().references(() => externalIdentityLinks.id, { onDelete: "restrict" }), fulfillmentId: text("fulfillment_id").notNull(),
  customerBindingHash: text("customer_binding_hash").notNull(), applicationAppKey: text("application_app_key").notNull(), catalogItemId: text("catalog_item_id").notNull(),
  offerId: text("offer_id"), offerVersion: text("offer_version"), originalAmount: integer("original_amount").notNull(), reservedAmount: integer("reserved_amount").notNull().default(0),
  settledAmount: integer("settled_amount").notNull().default(0), fulfilledAt: text("fulfilled_at").notNull(), expiresAt: text("expires_at").notNull(),
  fulfilledAtMs: integer("fulfilled_at_ms").notNull(), expiresAtMs: integer("expires_at_ms").notNull(), verificationRevision: text("verification_revision").notNull(),
  verificationPayloadHash: text("verification_payload_hash").notNull(), state: text("state").notNull(), reversalState: text("reversal_state").notNull().default("none"),
  measurementVersion: text("measurement_version").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("character_lots_fulfillment_unique").on(t.applicationAppKey, t.fulfillmentId), index("character_purchased_lots_spend_idx").on(t.ownerId, t.applicationAppKey, t.state, t.expiresAtMs, t.fulfilledAtMs, t.id)]);
export const characterReservations = sqliteTable("character_reservations", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(), operation: text("operation").notNull(), sourceCharacters: integer("source_characters").notNull(),
  measurementVersion: text("measurement_version").notNull(), currentHold: integer("current_hold").notNull().default(0), settledAmount: integer("settled_amount").notNull().default(0),
  state: text("state").notNull(), leaseDeadline: integer("lease_deadline", { mode: "timestamp_ms" }).notNull(), fencingToken: integer("fencing_token").notNull().default(1), mode: text("mode").notNull(),
  applicationAppKey: text("application_app_key"), entitlementId: text("entitlement_id"), entitlementPeriodStart: text("entitlement_period_start"), entitlementPeriodEnd: text("entitlement_period_end"), authorityRevision: integer("authority_revision"),
  eligibilitySnapshotJson: text("eligibility_snapshot_json").notNull(),
  providerRequestId: text("provider_request_id"), resultReference: text("result_reference"), failureReason: text("failure_reason"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(), settledAt: integer("settled_at", { mode: "timestamp_ms" }), releasedAt: integer("released_at", { mode: "timestamp_ms" }),
}, (t) => [uniqueIndex("character_reservations_owner_idem_unique").on(t.ownerId, t.idempotencyKey), index("character_reservations_reaper_idx").on(t.state, t.leaseDeadline, t.id)]);
export const characterAllocations = sqliteTable("character_allocations", {
  id: text("id").primaryKey(), reservationId: text("reservation_id").notNull().references(() => characterReservations.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), sourceKind: text("source_kind").notNull(), sourceId: text("source_id").notNull(), ordinal: integer("ordinal").notNull(),
  reservedAmount: integer("reserved_amount").notNull(), settledAmount: integer("settled_amount").notNull().default(0), releasedAmount: integer("released_amount").notNull().default(0),
  measurementVersion: text("measurement_version").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("character_allocations_reservation_ordinal_unique").on(t.reservationId, t.ordinal), uniqueIndex("character_allocations_reservation_source_unique").on(t.reservationId, t.sourceKind, t.sourceId), index("character_allocations_source_idx").on(t.sourceKind, t.sourceId, t.reservationId)]);
export const characterWalletEvents = sqliteTable("character_wallet_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), eventType: text("event_type").notNull(),
  reservationId: text("reservation_id").references(() => characterReservations.id, { onDelete: "restrict" }), grantId: text("grant_id").references(() => characterGrants.id, { onDelete: "restrict" }),
  lotId: text("lot_id").references(() => characterPurchasedLots.id, { onDelete: "restrict" }), quantity: integer("quantity"), causalReference: text("causal_reference"),
  metadataJson: text("metadata_json").notNull().default("{}"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("character_wallet_events_owner_idx").on(t.ownerId, t.createdAt, t.id)]);
export const characterLotCorrections = sqliteTable("character_lot_corrections", {
  id: text("id").primaryKey(), lotId: text("lot_id").notNull().references(() => characterPurchasedLots.id, { onDelete: "restrict" }), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  correctionId: text("correction_id").notNull(), correctionRevision: integer("correction_revision").notNull(), kind: text("kind").notNull(), verificationPayloadHash: text("verification_payload_hash").notNull(),
  reasonCode: text("reason_code").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("character_lot_corrections_identity_unique").on(t.lotId, t.correctionId), uniqueIndex("character_lot_corrections_revision_unique").on(t.lotId, t.correctionRevision)]);

export const adminAuditLog = sqliteTable("admin_audit_log", { id: text("id").primaryKey(), actorId: text("actor_id").notNull(), targetUserId: text("target_user_id"), action: text("action").notNull(), detailsJson: text("details_json").notNull().default("{}"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull() }, (t) => [index("audit_created_idx").on(t.createdAt, t.id), index("audit_target_created_idx").on(t.targetUserId, t.createdAt, t.id)]);
