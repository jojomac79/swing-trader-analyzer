import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ accepted: false, isPremium: false }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("disclaimer_accepted, is_premium, stripe_customer_id")
    .eq("user_id", email)
    .maybeSingle();

  console.log("disclaimer-status:", { email, data, error });

  // Hardcoded comped/dev-premium accounts never have a real Stripe subscription,
  // even if a stale stripe_customer_id (e.g. from earlier test-mode checkout)
  // is still sitting in their row — never trust that column for these emails.
  const DEV_PREMIUM_EMAILS = ["jojomac79@gmail.com", "411oakyates@gmail.com"];
  const isDevPremium = DEV_PREMIUM_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase());

  return NextResponse.json({
    accepted: !!data?.disclaimer_accepted,
    isPremium: !!data?.is_premium,
    hasStripeCustomer: isDevPremium ? false : !!data?.stripe_customer_id,
  });
}
