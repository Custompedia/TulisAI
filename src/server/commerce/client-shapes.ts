// Compile-time pins, no runtime code. Browser code never imports server
// modules, so it keeps its own copies of these response shapes
// (src/lib/client/commerce.ts, src/components/app/AppShell.tsx). `pnpm
// typecheck` fails here the moment a copy drifts from what the server sends.
import type * as Client from "@/lib/client/commerce";
import type { AccessInfo, WalletInfo } from "@/components/app/AppShell";
import type { AccessSummary } from "../usage/quota";
import type { WalletSummary } from "../usage/wallet";
import type { CatalogProduct, CommerceCatalog, OfferState } from "./catalog";
import type { PublicPurchaseIntent, RecoveryOutcome } from "./intents";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export type ClientShapesPinned = [
  Assert<Equal<OfferState, Client.OfferState>>,
  Assert<Equal<CatalogProduct, Client.CatalogProduct>>,
  Assert<Equal<CommerceCatalog, Client.CommerceCatalog>>,
  Assert<Equal<PublicPurchaseIntent, Client.PurchaseIntent>>,
  Assert<Equal<RecoveryOutcome, Client.RecoveryOutcome>>,
  // The interface reads a subset of these, so the server's full shape must satisfy it.
  Assert<AccessSummary extends AccessInfo ? true : false>,
  Assert<WalletSummary extends WalletInfo ? true : false>,
];
