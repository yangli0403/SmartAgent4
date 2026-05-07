CREATE TYPE "public"."conversation_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."kind" AS ENUM('episodic', 'semantic', 'persona');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('fact', 'behavior', 'preference', 'emotion');--> statement-breakpoint
CREATE TYPE "public"."proactive_service" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('success', 'error', 'timeout');--> statement-breakpoint
CREATE TABLE "behavior_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"patternType" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"confidence" double precision DEFAULT 0.7 NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	"lastObserved" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(200) DEFAULT '新会话' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"sessionId" integer,
	"role" "conversation_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"kind" "kind" DEFAULT 'semantic' NOT NULL,
	"type" "memory_type" NOT NULL,
	"content" text NOT NULL,
	"importance" double precision DEFAULT 0.5 NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL,
	"accessCount" integer DEFAULT 0 NOT NULL,
	"clusterId" integer,
	"embedding" jsonb,
	"validFrom" timestamp,
	"validUntil" timestamp,
	"tags" jsonb,
	"source" varchar(64),
	"versionGroup" varchar(100),
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastAccessedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"summary" text NOT NULL,
	"memberCount" integer DEFAULT 0 NOT NULL,
	"avgImportance" double precision DEFAULT 0.5 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"characterId" varchar(100) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"patchContent" text NOT NULL,
	"reasoning" text,
	"previousSnapshot" text,
	"currentSnapshot" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_utility_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"toolName" varchar(200) NOT NULL,
	"serverId" varchar(200),
	"status" "tool_call_status" NOT NULL,
	"executionTimeMs" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"sessionId" varchar(200),
	"userId" varchar(200),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"personality" varchar(50) DEFAULT 'professional' NOT NULL,
	"responseStyle" varchar(50) DEFAULT 'balanced' NOT NULL,
	"proactiveService" "proactive_service" DEFAULT 'enabled' NOT NULL,
	"notificationPreference" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "behavior_patterns" ADD CONSTRAINT "behavior_patterns_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sessionId_chat_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_clusters" ADD CONSTRAINT "memory_clusters_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bp_user_id_idx" ON "behavior_patterns" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "bp_pattern_type_idx" ON "behavior_patterns" USING btree ("patternType");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "chat_sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "conv_user_id_idx" ON "conversations" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "conv_session_id_idx" ON "conversations" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "conv_created_at_idx" ON "conversations" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "mem_user_id_idx" ON "memories" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "mem_kind_idx" ON "memories" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "mem_type_idx" ON "memories" USING btree ("type");--> statement-breakpoint
CREATE INDEX "mem_importance_idx" ON "memories" USING btree ("importance");--> statement-breakpoint
CREATE INDEX "mem_last_accessed_idx" ON "memories" USING btree ("lastAccessedAt");--> statement-breakpoint
CREATE INDEX "mem_version_group_idx" ON "memories" USING btree ("versionGroup");--> statement-breakpoint
CREATE INDEX "cluster_user_id_idx" ON "memory_clusters" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "pv_character_id_idx" ON "prompt_versions" USING btree ("characterId");--> statement-breakpoint
CREATE INDEX "pv_version_idx" ON "prompt_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "pv_active_idx" ON "prompt_versions" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "tul_tool_name_idx" ON "tool_utility_logs" USING btree ("toolName");--> statement-breakpoint
CREATE INDEX "tul_status_idx" ON "tool_utility_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tul_created_at_idx" ON "tool_utility_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "user_pref_user_id_idx" ON "user_preferences" USING btree ("userId");