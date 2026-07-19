import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Hardcoded comped/dev-premium accounts never have a real Stripe subscription,
// even if a stale stripe_customer_id (e.g. from earlier test-mode checkout) is
// still sitting in their row — never attempt a portal session for these emails.
const DEV_PREMIUM_EMAILS = ["jojomac79@gmail.com", "411oakyates@gmail.com"];

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (DEV_PREMIUM_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase())) {
    return NextResponse.json({ error: "This account has complimentary Pro access — no billing portal to manage." }, { status: 404 });
  }

  const { data } = await supabaseAdmin
    .from("app_users")
    .select("stripe_customer_id")
    .eq("user_id", email)
    .maybeSingle();

  if (!data?.stripe_customer_id) {
    return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  }

  const origin = req.headers.get("origin") ?? "http://localhost:3000";

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: origin,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("Stripe portal session error:", err);
    return NextResponse.json({ error: "Could not create billing portal session — the saved payment record may be invalid." }, { status: 502 });
  }
}
