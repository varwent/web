// Mirrors leads into Google Sheets through a Google Apps Script web app
// (see integrations/google-sheets/Code.gs). MongoDB stays the source of truth:
// a failed sync is recorded on the lead and retried on later submissions.
// The Apps Script skips lead IDs it already has, so retries never duplicate rows.

import { BUSINESS_LABELS, INTEREST_LABELS } from "./lead.js";

const MAX_ATTEMPTS = 5;
const BACKLOG_BATCH = 5;

export function sheetsConfigured(env = process.env) {
  return Boolean(env.SHEETS_WEBHOOK_URL && env.SHEETS_WEBHOOK_SECRET);
}

export function toSheetRow(lead) {
  return {
    id: String(lead._id),
    createdAt: new Date(lead.createdAt).toISOString(),
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    businessType: BUSINESS_LABELS[lead.businessType] || lead.businessType || "",
    interest: INTEREST_LABELS[lead.interest] || "",
    page: lead.page || "",
  };
}

export async function postToSheet(lead, { env = process.env, fetchImpl = fetch } = {}) {
  // Apps Script answers POSTs with a 302 to a one-time URL; fetch follows it as a GET.
  const res = await fetchImpl(env.SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.SHEETS_WEBHOOK_SECRET, lead: toSheetRow(lead) }),
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`unexpected response from Apps Script (HTTP ${res.status})`);
  }
  if (!data.ok) throw new Error(`Apps Script: ${data.error || "unknown error"}`);
}

async function syncOne(leads, lead, opts) {
  try {
    await postToSheet(lead, opts);
    await leads.updateOne(
      { _id: lead._id },
      { $set: { "sheet.syncedAt": new Date() }, $unset: { "sheet.error": "" } }
    );
    return true;
  } catch (err) {
    console.warn(`lets-talk: sheet sync failed for ${lead._id}`, err);
    await leads
      .updateOne(
        { _id: lead._id },
        { $set: { "sheet.error": String(err.message || err) }, $inc: { "sheet.attempts": 1 } }
      )
      .catch(() => {});
    return false;
  }
}

// Sync the new lead, then retry a few older ones that never made it.
export async function syncLeadsToSheet(leads, newLead, opts = {}) {
  if (!sheetsConfigured(opts.env)) return;
  await syncOne(leads, newLead, opts);

  const backlog = await leads
    .find({
      _id: { $ne: newLead._id },
      "sheet.syncedAt": { $exists: false },
      "sheet.attempts": { $lt: MAX_ATTEMPTS },
      createdAt: { $lt: new Date(Date.now() - 60_000) },
    })
    .sort({ createdAt: 1 })
    .limit(BACKLOG_BATCH)
    .toArray()
    .catch(() => []);

  for (const lead of backlog) await syncOne(leads, lead, opts);
}
