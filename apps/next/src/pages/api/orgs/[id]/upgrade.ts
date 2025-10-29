import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";

import { prisma } from "@quenti/prisma";
import { stripe } from "@quenti/payments";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { id } = req.query as { id: string };
  const { session_id } = req.body as { session_id: string };

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
  } catch (e) {
    return res.status(400).json({ error: "Invalid session_id" });
  }

  if (checkoutSession.payment_status !== "paid") {
    return res.status(402).json({ error: "Payment required" });
  }

  const org = await prisma.organization.findUnique({
    where: { id },
  });

  const metadata = org?.metadata as { paymentId?: unknown[] } | undefined | null;

  if (
    !org ||
    !metadata ||
    !Array.isArray(metadata.paymentId) ||
    !metadata.paymentId.includes(session_id)
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
    });
  }

  const memberships = await prisma.organizationMembership.findMany({
    where: { orgId: id },
  });

  const member = memberships.find((m) => {
    const metadata = m.metadata as { onboardingStep?: unknown[] } | null;
    const step = metadata?.onboardingStep;
    return Array.isArray(step) && step.includes("publish");
  });

  if (!member) {
    throw new TRPCError({
      code: "NOT_FOUND",
    });
  }

  // Для free users — просто повертаємо org (upgrade не потрібен)
  return res.status(200).json({ org });
}
