// Goals & Production: the customer search over the revenue-by-customer
// rankings. Client-safe: it reaches neither forecast.ts nor the customer roster.

import type { CustomerRanking, CustomerRevenueRow } from "./customer-revenue";

/** The customers whose name or code holds the search (case-insensitive); all when it is blank. */
export function searchCustomers(ranking: CustomerRanking, query: string): CustomerRevenueRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return ranking.customers;
  return ranking.customers.filter((c) => `${c.customerCode ?? ""} ${c.customer ?? ""}`.toLowerCase().includes(q));
}