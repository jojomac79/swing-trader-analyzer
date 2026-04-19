import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Upsert the user record with disclaimer acceptance timestamp
  await supabaseAdmin.from("app_users").upsert({
    user_id: email,
    disclaimer_accepted: true,
    disclaimer_accepted_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  return NextResponse.json({ ok: true });
}
