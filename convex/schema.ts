import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  users: defineTable({ name:v.string(), email:v.string(), createdAt:v.number(), updatedAt:v.number() }).index("by_email",["email"]),
  conversations: defineTable({ userId:v.id("users"), title:v.string(), createdAt:v.number(), updatedAt:v.number() }).index("by_user",["userId"]),
  messages: defineTable({ conversationId:v.id("conversations"), role:v.union(v.literal("user"),v.literal("assistant"),v.literal("tool")), content:v.string(), timestamp:v.number(), toolCalls:v.optional(v.string()) }).index("by_conversation",["conversationId"]),
  memories: defineTable({ userId:v.id("users"), content:v.string(), category:v.string(), importance:v.number(), source:v.string(), createdAt:v.number(), updatedAt:v.number() }).index("by_user",["userId"]).index("by_category",["category"]),
  tasks: defineTable({ userId:v.id("users"), title:v.string(), description:v.optional(v.string()), status:v.union(v.literal("open"),v.literal("completed")), priority:v.union(v.literal("low"),v.literal("medium"),v.literal("high")), dueDate:v.optional(v.number()), createdAt:v.number(), updatedAt:v.number() }).index("by_user",["userId"]).index("by_status",["status"]),
  activities: defineTable({ userId:v.id("users"), type:v.string(), description:v.string(), status:v.string(), metadata:v.optional(v.string()), createdAt:v.number() }).index("by_user",["userId"]),
  integrations: defineTable({ userId:v.id("users"), provider:v.string(), status:v.string(), metadata:v.optional(v.string()), createdAt:v.number(), updatedAt:v.number() }).index("by_user",["userId"]),
  toolExecutions: defineTable({ userId:v.id("users"), toolName:v.string(), arguments:v.string(), result:v.optional(v.string()), status:v.string(), createdAt:v.number(), completedAt:v.optional(v.number()) }).index("by_user",["userId"]),
});
