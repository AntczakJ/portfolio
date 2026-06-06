CREATE TYPE "public"."event_type" AS ENUM('geofence.enter', 'geofence.exit', 'status.change', 'arrived', 'departed');--> statement-breakpoint
CREATE TYPE "public"."loop_mode" AS ENUM('loop', 'ping_pong');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('en_route', 'at_stop', 'idle', 'returning');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('van', 'truck', 'courier');--> statement-breakpoint
CREATE TYPE "public"."zone_kind" AS ENUM('depot', 'delivery_zone', 'restricted');--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"type" "event_type" NOT NULL,
	"vehicle_id" text NOT NULL,
	"zone_id" text,
	"at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"geometry" jsonb NOT NULL,
	"length_m" double precision NOT NULL,
	"loop_mode" "loop_mode" DEFAULT 'loop' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"point" jsonb NOT NULL,
	"dwell_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "zone_kind" NOT NULL,
	"geometry" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"route_id" text NOT NULL,
	"base_speed_mps" double precision NOT NULL,
	"status" "vehicle_status" DEFAULT 'en_route' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_snapshots" (
	"vehicle_id" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"heading_deg" double precision NOT NULL,
	"speed_mps" double precision NOT NULL,
	"route_id" text NOT NULL,
	"distance_along_route_m" double precision NOT NULL,
	"progress" double precision NOT NULL,
	"status" "vehicle_status" NOT NULL,
	"next_stop_id" text,
	"eta_seconds" double precision,
	"current_zone_id" text,
	"server_tick" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_snapshots" ADD CONSTRAINT "telemetry_snapshots_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_vehicle_id_at_idx" ON "events" USING btree ("vehicle_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "route_stops_route_id_seq_idx" ON "route_stops" USING btree ("route_id","seq");--> statement-breakpoint
CREATE INDEX "vehicles_route_id_idx" ON "vehicles" USING btree ("route_id");