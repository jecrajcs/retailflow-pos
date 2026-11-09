import { createAdapterFactory, type Where } from "better-auth/adapters";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type RestResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

interface RestQuery extends PromiseLike<RestResult> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): RestQuery;
  insert(values: Record<string, unknown>): RestQuery;
  update(values: Record<string, unknown>): RestQuery;
  delete(): RestQuery;
  eq(field: string, value: unknown): RestQuery;
  neq(field: string, value: unknown): RestQuery;
  lt(field: string, value: unknown): RestQuery;
  lte(field: string, value: unknown): RestQuery;
  gt(field: string, value: unknown): RestQuery;
  gte(field: string, value: unknown): RestQuery;
  in(field: string, values: unknown[]): RestQuery;
  is(field: string, value: null | boolean): RestQuery;
  not(field: string, operator: string, value: unknown): RestQuery;
  contains(field: string, value: unknown): RestQuery;
  like(field: string, pattern: string): RestQuery;
  ilike(field: string, pattern: string): RestQuery;
  or(filters: string): RestQuery;
  order(field: string, options: { ascending: boolean }): RestQuery;
  range(from: number, to: number): RestQuery;
  limit(count: number): RestQuery;
  maybeSingle(): RestQuery;
  single(): RestQuery;
}

type AdminDataApi = { from(table: string): RestQuery };

const allowedModels = new Set([
  "auth_users",
  "auth_accounts",
  "auth_sessions",
  "auth_verifications",
  "auth_rate_limits",
]);

function fail(error: RestResult["error"]): never {
  throw new Error(error?.message ?? "Authentication database operation failed.");
}

function postgrestValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null) return "null";
  if (typeof value === "string")
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return String(value);
}

function postgrestOperator(where: Where): string {
  const op = where.operator ?? "eq";
  if (op === "starts_with") return `like.${postgrestValue(`${String(where.value)}%`)}`;
  if (op === "ends_with") return `like.${postgrestValue(`%${String(where.value)}`)}`;
  if (op === "contains" && Array.isArray(where.value)) return `cs.${postgrestValue(where.value)}`;
  if (op === "in" || op === "not_in") {
    const values = Array.isArray(where.value) ? where.value : [where.value];
    return `${op === "in" ? "in" : "not.in"}.(${values.map(postgrestValue).join(",")})`;
  }
  if (where.mode === "insensitive" && typeof where.value === "string") {
    const operator = op === "eq" ? "ilike" : op === "ne" ? "not.ilike" : op;
    return `${operator}.${postgrestValue(where.value)}`;
  }
  return `${op}.${postgrestValue(where.value)}`;
}

function applyFilters(query: RestQuery, where: Where[] = []): RestQuery {
  let result = query;
  const orFilters: string[] = [];

  for (const condition of where) {
    const operator = condition.operator ?? "eq";
    if (condition.connector === "OR") {
      orFilters.push(`${condition.field}.${postgrestOperator(condition)}`);
      continue;
    }
    const value = condition.value instanceof Date ? condition.value.toISOString() : condition.value;
    if (value === null) {
      result =
        operator === "ne"
          ? result.not(condition.field, "is", null)
          : result.is(condition.field, null);
      continue;
    }
    if (operator === "eq")
      result =
        condition.mode === "insensitive"
          ? result.ilike(condition.field, String(value))
          : result.eq(condition.field, value);
    else if (operator === "ne") result = result.neq(condition.field, value);
    else if (operator === "lt") result = result.lt(condition.field, value);
    else if (operator === "lte") result = result.lte(condition.field, value);
    else if (operator === "gt") result = result.gt(condition.field, value);
    else if (operator === "gte") result = result.gte(condition.field, value);
    else if (operator === "in")
      result = result.in(condition.field, Array.isArray(value) ? value : [value]);
    else if (operator === "not_in")
      result = result.not(
        condition.field,
        "in",
        `(${(Array.isArray(value) ? value : [value]).map(postgrestValue).join(",")})`,
      );
    else if (operator === "contains") result = result.contains(condition.field, value);
    else if (operator === "starts_with") result = result.like(condition.field, `${String(value)}%`);
    else if (operator === "ends_with") result = result.like(condition.field, `%${String(value)}`);
  }
  if (orFilters.length) result = result.or(orFilters.join(","));
  return result;
}

function assertModel(model: string) {
  if (!allowedModels.has(model)) throw new Error(`Auth adapter rejected unknown model: ${model}`);
}

function rowList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
}

function createRestAdapter(client: AdminDataApi) {
  return createAdapterFactory({
    config: {
      adapterId: "retailflow-supabase-data-api",
      adapterName: "RetailFlow server-side Supabase Data API",
      supportsUUIDs: true,
      supportsJSON: true,
      supportsDates: true,
      supportsArrays: true,
      transaction: false,
      customIdGenerator: () => crypto.randomUUID(),
    },
    adapter: () => ({
      create: async <T extends Record<string, unknown>>({
        model,
        data,
      }: {
        model: string;
        data: T;
      }): Promise<T> => {
        assertModel(model);
        const result = await client.from(model).insert(data).select("*").single();
        if (result.error) fail(result.error);
        if (!result.data) throw new Error(`Auth adapter did not receive the created ${model} row.`);
        return result.data as T;
      },
      findOne: async <T>({
        model,
        where,
      }: {
        model: string;
        where: Where[];
      }): Promise<T | null> => {
        assertModel(model);
        const result = await applyFilters(client.from(model).select("*"), where)
          .limit(1)
          .maybeSingle();
        if (result.error) fail(result.error);
        return result.data as T | null;
      },
      findMany: async <T>({
        model,
        where,
        limit,
        sortBy,
        offset,
      }: {
        model: string;
        where?: Required<Where>[] | undefined;
        limit: number;
        sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
        offset?: number | undefined;
      }): Promise<T[]> => {
        assertModel(model);
        let query = applyFilters(client.from(model).select("*"), where);
        if (sortBy) query = query.order(sortBy.field, { ascending: sortBy.direction === "asc" });
        const start = Math.max(0, offset ?? 0);
        query = query.range(start, start + Math.max(1, limit) - 1);
        const result = await query;
        if (result.error) fail(result.error);
        return rowList(result.data) as T[];
      },
      count: async ({ model, where }) => {
        assertModel(model);
        const result = await applyFilters(
          client.from(model).select("id", { count: "exact", head: true }),
          where,
        );
        if (result.error) fail(result.error);
        return result.count ?? 0;
      },
      update: async <T>({
        model,
        where,
        update,
      }: {
        model: string;
        where: Where[];
        update: T;
      }): Promise<T | null> => {
        assertModel(model);
        if (!where.length) return null;
        const result = await applyFilters(
          client.from(model).update(Object.assign({}, update)).select("*"),
          where,
        )
          .limit(1)
          .maybeSingle();
        if (result.error) fail(result.error);
        return result.data as T | null;
      },
      updateMany: async ({ model, where, update }) => {
        assertModel(model);
        if (!where.length) return 0;
        const result = await applyFilters(
          client.from(model).update(Object.assign({}, update)).select("id"),
          where,
        );
        if (result.error) fail(result.error);
        return rowList(result.data).length;
      },
      delete: async ({ model, where }) => {
        assertModel(model);
        if (!where.length) return;
        const result = await applyFilters(client.from(model).delete(), where);
        if (result.error) fail(result.error);
      },
      deleteMany: async ({ model, where }) => {
        assertModel(model);
        if (!where.length) return 0;
        const result = await applyFilters(client.from(model).delete().select("id"), where);
        if (result.error) fail(result.error);
        return rowList(result.data).length;
      },
    }),
  });
}

export const retailFlowAuthAdapter = createRestAdapter(supabaseAdmin as unknown as AdminDataApi);
