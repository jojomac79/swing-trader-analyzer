import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    monthly: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID ?? "",
    yearly: process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID ?? "",
  });
}
