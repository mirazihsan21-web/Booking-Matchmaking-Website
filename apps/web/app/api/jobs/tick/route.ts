import { NextResponse } from "next/server";
import { createEmailSender } from "@/lib/email/sender";
import { authorizeJob } from "@/lib/jobs/auth";
import { runTick } from "@/lib/jobs/tick";
import { createServiceClient } from "@/lib/service-client";

/**
 * Called every 10 seconds by pg_cron (via pg_net) with the shared job secret. The database calls in
 * as host.docker.internal locally, so proxy.ts lets /api/jobs/* through for any host.
 */
export async function POST(request: Request) {
  if (!authorizeJob(request.headers.get("authorization"), process.env.JOB_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await runTick({ db: createServiceClient(), sender: createEmailSender(process.env) });
  return NextResponse.json(report);
}
