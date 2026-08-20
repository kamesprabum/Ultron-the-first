export type MemoryCategory =
  | "fact"
  | "preference"
  | "instruction"
  | "contact"
  | "project"
  | "general";

export type MemorySource = "text" | "voice" | "manual";

export interface JarvisMemory {
  id: string;
  userId: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
}

export interface SaveMemoryInput {
  userId?: string;
  content: string;
  category?: MemoryCategory;
  importance?: number;
  source?: MemorySource;
}

export interface GetMemoriesOptions {
  userId?: string;
  category?: MemoryCategory;
  limit?: number;
}

export interface SearchMemoriesOptions {
  userId?: string;
  query: string;
  limit?: number;
}

export interface DeleteMemoryOptions {
  userId?: string;
  query: string;
}
