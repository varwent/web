// POST /api/lets-talk — saves a "Let's talk" enquiry to MongoDB Atlas,
// then mirrors it to Google Sheets in the background.
import { waitUntil } from "@vercel/functions";
import { getLeadsCollection } from "./_lib/db.js";
import { createLeadHandler } from "./_lib/lead.js";
import { syncLeadsToSheet } from "./_lib/sheets.js";

export const POST = createLeadHandler({
  getCollection: getLeadsCollection,
  // Respond to the visitor right away; the sheet sync finishes after the response.
  afterInsert: (leads, lead) => waitUntil(syncLeadsToSheet(leads, lead)),
});
