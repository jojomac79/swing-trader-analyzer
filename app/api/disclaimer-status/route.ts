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

  return NextResponse.json({
    accepted: !!data?.disclaimer_accepted,
    isPremium: !!data?.is_premium,
    // Complimentary/dev-premium accounts have is_premium=true but no real
    // Stripe subscription behind them — nothing for the billing portal to manage.
    hasStripeCustomer: !!data?.stripe_customer_id,
  });
}
