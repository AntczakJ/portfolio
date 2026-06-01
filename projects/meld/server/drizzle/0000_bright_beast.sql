CREATE TABLE "board_ops" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"op_seq" integer NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"state" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_ops" ADD CONSTRAINT "board_ops_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_ops_board_id_op_seq_unique" ON "board_ops" USING btree ("board_id","op_seq");--> statement-breakpoint
CREATE INDEX "board_ops_board_id_op_seq_idx" ON "board_ops" USING btree ("board_id","op_seq");--> statement-breakpoint
CREATE INDEX "boards_last_active_at_idx" ON "boards" USING btree ("last_active_at");