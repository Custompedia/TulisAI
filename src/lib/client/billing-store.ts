'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Tier, TopUp } from '@/lib/plans';
import { request } from './api';

type PaidTier = Exclude<Tier, 'free'>;
export type Order = {
  id: string; kind: 'plan' | 'topup'; plan: PaidTier | null; pack: TopUp['id'] | null; characters: number; amountIdr: number; mode: 'sandbox' | 'production';
  status: string; granted?: boolean; needsOperator?: boolean; payUrl: string | null; createdAt: string; expiresAt?: string; paidAt?: string | null;
};
export type Billing = { checkoutOpen: boolean; mode: 'sandbox' | 'production' | null; orders: Order[]; plan: { code: PaidTier; source: 'admin' | 'payment'; periodEnd: string; paidThrough: string } | null };

type State = { billing: Billing | null; loading: boolean; error: unknown };
const EMPTY: State = { billing: null, loading: true, error: null };
let state: State = EMPTY;
let inFlight: Promise<void> | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = (next: State) => { state = next; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// One shared GET /api/payments/orders: whether checkout is open, the running plan, and the last 20 orders.
export function loadBilling(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (loaded && !force) return Promise.resolve();
  emit({ ...state, loading: true, error: null });
  inFlight = request<Billing>('/api/payments/orders')
    .then((billing) => { loaded = true; emit({ billing, loading: false, error: null }); })
    .catch((error: unknown) => emit({ ...state, loading: false, error }))
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function replaceOrder(order: Order) {
  if (!state.billing) return;
  emit({ ...state, billing: { ...state.billing, orders: state.billing.orders.map((item) => (item.id === order.id ? { ...item, ...order } : item)) } });
}

export function resetBilling() { loaded = false; inFlight = null; emit(EMPTY); }

export function useBilling() {
  const value = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => { void loadBilling(); }, []);
  const reload = useCallback(() => loadBilling(true), []);
  return { ...value, reload };
}
