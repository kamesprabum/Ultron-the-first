import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  JarvisMemory,
  SaveMemoryInput,
  GetMemoriesOptions,
  SearchMemoriesOptions,
  DeleteMemoryOptions,
} from "./types";

export const DEFAULT_USER_ID = "jarvis-local-user";

let supabaseClient: SupabaseClient | null = null;

function normalizeSupabaseUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (url.endsWith("/rest/v1/")) {
    url = url.slice(0, -"/rest/v1/".length);
  } else if (url.endsWith("/rest/v1")) {
    url = url.slice(0, -"/rest/v1".length);
  }
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  return url;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) {
    return supabaseClient;
  }

  const rawUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!rawUrl || !serviceKey) {
    return null;
  }

  const url = normalizeSupabaseUrl(rawUrl);

  try {
    supabaseClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return supabaseClient;
  } catch (err) {
    console.error("[Memory] Error initializing Supabase client:", err instanceof Error ? err.message : "Unknown error");
    return null;
  }
}

/**
 * Filters out passwords, API keys, bearer tokens, and secrets from being stored.
 */
export function isSensitiveContent(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();

  // Keyword patterns for secrets
  const secretKeywords = [
    "password",
    "passwd",
    "api_key",
    "apikey",
    "secret_key",
    "private_key",
    "access_token",
    "oauth_token",
    "bearer ",
    "service_role",
    "session_id",
    "credit_card",
    "cvv",
    "ssn",
  ];

  if (secretKeywords.some((kw) => lower.includes(kw))) {
    return true;
  }

  // Token signatures (JWT, GitHub token, generic high entropy keys)
  if (/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/.test(text)) return true;
  if (/ghp_[a-zA-Z0-9]{20,}/.test(text)) return true;
  if (/sk-[a-zA-Z0-9]{20,}/.test(text)) return true;
  if (/AIza[0-9A-Za-z-_]{35}/.test(text)) return true;

  return false;
}

/**
 * Saves a high-confidence memory item for the user.
 */
export async function saveMemory(
  input: SaveMemoryInput
): Promise<{ success: boolean; memory?: JarvisMemory; error?: string; skipped?: boolean }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Supabase memory is not configured." };
  }

  const cleanContent = input.content.trim();
  if (!cleanContent) {
    return { success: false, error: "Memory content cannot be empty." };
  }

  if (isSensitiveContent(cleanContent)) {
    console.warn("[Memory] Blocked attempt to persist sensitive content/credentials.");
    return {
      success: false,
      skipped: true,
      error: "Sensitive information or credentials cannot be stored in memory.",
    };
  }

  const userId = input.userId || DEFAULT_USER_ID;
  const category = input.category || "general";
  const importance = Math.min(Math.max(input.importance || 3, 1), 5);
  const source = input.source || "text";

  try {
    const { data, error } = await client
      .from("jarvis_memories")
      .insert({
        user_id: userId,
        category,
        content: cleanContent,
        importance,
        source,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === "42P01" || error.message.includes("schema cache") || error.message.includes("not find")) {
        console.warn("[Memory] jarvis_memories table not found in Supabase. Run supabase/schema.sql in Supabase SQL editor.");
        return {
          success: false,
          error: "Memory table not yet created in Supabase. Please execute schema.sql.",
        };
      }
      console.error("[Memory] Error inserting memory:", error.message);
      return { success: false, error: error.message };
    }

    const memory: JarvisMemory = {
      id: data.id,
      userId: data.user_id,
      category: data.category,
      content: data.content,
      importance: data.importance,
      source: data.source,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    return { success: true, memory };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown database error";
    console.error("[Memory] Exception in saveMemory:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Retrieves memories for a user, ordered by importance and recency.
 */
export async function getMemories(
  options: GetMemoriesOptions = {}
): Promise<JarvisMemory[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const userId = options.userId || DEFAULT_USER_ID;
  const limit = options.limit || 20;

  try {
    let query = client
      .from("jarvis_memories")
      .select("*")
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (options.category) {
      query = query.eq("category", options.category);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === "42P01" || error.message.includes("schema cache") || error.message.includes("not find")) {
        console.warn("[Memory] jarvis_memories table not found in Supabase. Run supabase/schema.sql in Supabase SQL editor.");
        return [];
      }
      console.error("[Memory] Error fetching memories:", error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      category: row.category,
      content: row.content,
      importance: row.importance,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    console.error("[Memory] Exception in getMemories:", err instanceof Error ? err.message : "Unknown error");
    return [];
  }
}

/**
 * Searches memories matching keywords or phrases.
 */
export async function searchMemories(
  options: SearchMemoriesOptions
): Promise<JarvisMemory[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const userId = options.userId || DEFAULT_USER_ID;
  const cleanQuery = options.query.trim();
  if (!cleanQuery) {
    return getMemories({ userId, limit: options.limit });
  }

  try {
    const { data, error } = await client
      .from("jarvis_memories")
      .select("*")
      .eq("user_id", userId)
      .ilike("content", `%${cleanQuery}%`)
      .order("importance", { ascending: false })
      .limit(options.limit || 10);

    if (error) {
      console.error("[Memory] Error searching memories:", error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      category: row.category,
      content: row.content,
      importance: row.importance,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    console.error("[Memory] Exception in searchMemories:", err instanceof Error ? err.message : "Unknown error");
    return [];
  }
}

/**
 * Deletes memories that match a topic or phrase.
 */
export async function deleteMatchingMemory(
  options: DeleteMemoryOptions
): Promise<{ success: boolean; deletedCount: number; deletedItems?: string[]; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, deletedCount: 0, error: "Supabase memory is not configured." };
  }

  const userId = options.userId || DEFAULT_USER_ID;
  const cleanQuery = options.query.trim();
  if (!cleanQuery) {
    return { success: false, deletedCount: 0, error: "Query cannot be empty." };
  }

  try {
    // 1. Find matching rows first to get their IDs and descriptions
    const { data: matched, error: searchError } = await client
      .from("jarvis_memories")
      .select("id, content")
      .eq("user_id", userId)
      .ilike("content", `%${cleanQuery}%`);

    if (searchError) {
      return { success: false, deletedCount: 0, error: searchError.message };
    }

    if (!matched || matched.length === 0) {
      return { success: true, deletedCount: 0, deletedItems: [] };
    }

    const idsToDelete = matched.map((m) => m.id);
    const { error: deleteError } = await client
      .from("jarvis_memories")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      return { success: false, deletedCount: 0, error: deleteError.message };
    }

    return {
      success: true,
      deletedCount: idsToDelete.length,
      deletedItems: matched.map((m) => m.content),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, deletedCount: 0, error: msg };
  }
}

/**
 * Deletes all memories for a user (called only after explicit confirmation).
 */
export async function deleteAllMemories(
  userId: string = DEFAULT_USER_ID
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, deletedCount: 0, error: "Supabase memory is not configured." };
  }

  try {
    const { data: existing, error: countErr } = await client
      .from("jarvis_memories")
      .select("id")
      .eq("user_id", userId);

    if (countErr) {
      return { success: false, deletedCount: 0, error: countErr.message };
    }

    const count = existing?.length || 0;
    if (count === 0) {
      return { success: true, deletedCount: 0 };
    }

    const { error: delErr } = await client
      .from("jarvis_memories")
      .delete()
      .eq("user_id", userId);

    if (delErr) {
      return { success: false, deletedCount: 0, error: delErr.message };
    }

    return { success: true, deletedCount: count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, deletedCount: 0, error: msg };
  }
}

/**
 * Formats memory items into a structured block suitable for system prompt injection.
 */
export function formatMemoriesForContext(memories: JarvisMemory[]): string {
  if (!memories || memories.length === 0) {
    return "";
  }

  const lines = memories.map((m) => `- [${m.category}] ${m.content}`);
  return `[PERSISTENT MEMORY / USER CONTEXT]\n${lines.join("\n")}`;
}
