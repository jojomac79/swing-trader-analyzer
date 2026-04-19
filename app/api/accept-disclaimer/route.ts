import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date().toISOString();

  // Try update first (user already exists)
  const { data: updated } = await supabaseAdmin
    .from("app_users")
    .update({ disclaimer_accepted: true, disclaimer_accepted_at: now })
    .eq("user_id", email)
    .select("user_id")
    .maybeSingle();

  // If no row existed, insert one
  if (!updated) {
    await supabaseAdmin.from("app_users").insert({
      user_id: email,
      disclaimer_accepted: true,
      disclaimer_accepted_at: now,
      daily_count: 0,
      last_reset_date: now.slice(0, 10),
      is_premium: false,
    });
  }

  return NextResponse.json({ ok: true });
}
