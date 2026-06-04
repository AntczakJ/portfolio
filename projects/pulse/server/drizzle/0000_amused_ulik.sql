CREATE TYPE "public"."alert_channel_type" AS ENUM('webhook', 'email');--> statement-breakpoint
CREATE TYPE "public"."alert_delivery_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."alert_transition" AS ENUM('open', 'close');--> statement-breakpoint
CREATE TYPE "public"."check_error" AS ENUM('timeout', 'dns', 'connection_refused', 'tls', 'ssrf_blocked', 'http_error', 'keyword_missing', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."monitor_method" AS ENUM('GET', 'HEAD');--> statement-breakpoint
CREATE TYPE "public"."monitor_status" AS ENUM('up', 'degraded', 'down');--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "alert_channel_type" NOT NULL,
	"target" text NOT NULL,
	"secret" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"alert_channel_id" uuid NOT NULL,
	"transition" "alert_transition" NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "alert_delivery_status" NOT NULL,
	"response_code" smallint
);
--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"monitor_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"status" "monitor_status" NOT NULL,
	"status_code" smallint,
	"response_time_ms" integer,
	"error" "check_error"
);
--> statement-breakpoint
CREATE TABLE "check_rollups_hourly" (
	"monitor_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"up_count" integer DEFAULT 0 NOT NULL,
	"degraded_count" integer DEFAULT 0 NOT NULL,
	"down_count" integer DEFAULT 0 NOT NULL,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"avg_response_time_ms" integer,
	"p95_response_time_ms" integer,
	"min_ms" integer,
	"max_ms" integer,
	CONSTRAINT "check_rollups_hourly_monitor_id_bucket_start_pk" PRIMARY KEY("monitor_id","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"cause" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_url" text NOT NULL,
	"method" "monitor_method" DEFAULT 'GET' NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"expected_status" smallint DEFAULT 200 NOT NULL,
	"expected_keyword" text,
	"degraded_threshold_ms" integer DEFAULT 1000 NOT NULL,
	"failure_threshold" smallint DEFAULT 3 NOT NULL,
	"recovery_threshold" smallint DEFAULT 2 NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_status_page_monitors" (
	"status_page_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	CONSTRAINT "public_status_page_monitors_status_page_id_monitor_id_pk" PRIMARY KEY("status_page_id","monitor_id")
);
--> statement-breakpoint
CREATE TABLE "public_status_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_status_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_channel_id_alert_channels_id_fk" FOREIGN KEY ("alert_channel_id") REFERENCES "public"."alert_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_rollups_hourly" ADD CONSTRAINT "check_rollups_hourly_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_status_page_monitors" ADD CONSTRAINT "public_status_page_monitors_status_page_id_public_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."public_status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_status_page_monitors" ADD CONSTRAINT "public_status_page_monitors_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_status_pages" ADD CONSTRAINT "public_status_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_dedup_idx" ON "alert_deliveries" USING btree ("incident_id","alert_channel_id","transition");--> statement-breakpoint
CREATE INDEX "check_results_monitor_checked_at_idx" ON "check_results" USING btree ("monitor_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_one_open_per_monitor_idx" ON "incidents" USING btree ("monitor_id") WHERE "incidents"."status" = 'open';--> statement-breakpoint
CREATE INDEX "incidents_monitor_started_at_idx" ON "incidents" USING btree ("monitor_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "monitors_user_id_idx" ON "monitors" USING btree ("user_id");