import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const config = { api: { bodyParser: false } };

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const getUserEmail = (obj: { metadata?: Stripe.Metadata | null; customer_email?: string | null }): string | null => {
    return obj.metadata?.user_id ?? obj.customer_email ?? null;
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const email = getUserEmail(session);
      if (email) {
        await supabaseAdmin.from("app_users").upsert({
          user_id: email,
          is_premium: true,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
        }, { onConflict: "user_id" });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      // Look up user by stripe_subscription_id
      const { data } = await supabaseAdmin
        .from("app_users")
        .select("user_id")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();
      if (data?.user_id) {
        await supabaseAdmin.from("app_users")
          .update({ is_premium: false, stripe_subscription_id: null })
          .eq("user_id", data.user_id);
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const isActive = sub.status === "active" || sub.status === "trialing";
      const { data } = await supabaseAdmin
        .from("app_users")
        .select("user_id")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();
      if (data?.user_id) {
        await supabaseAdmin.from("app_users")
          .update({ is_premium: isActive })
          .eq("user_id", data.user_id);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
