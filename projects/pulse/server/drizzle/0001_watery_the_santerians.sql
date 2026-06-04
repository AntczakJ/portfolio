ALTER TABLE "monitors" ADD COLUMN "current_status" "monitor_status";--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "last_checked_at" timestamp with time zone;