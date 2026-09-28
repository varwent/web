import { createHash } from "node:crypto";

export const SERVICE_LABELS = {
  web: "Web development",
  automation: "Automation",
  ai: "AI integrations",
  other: "Something else",
};
export const BUDGET_LABELS = {
  "under-1k": "Under $1k",
  "1k-5k": "$1k – $5k",
  "5k-15k": "$5k – $15k",
  "15k-plus": "$15k+",
  "not-sure": "Not sure yet",
};
export const SERVICES = Object.keys(SERVICE_LABELS);
export const BUDGETS = Object.keys(BUDGET_LABELS);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATE_LIMIT = { max: 5, windowMs: 10 * 60_000 };
const MIN_FILL_MS = 1500;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";

export function validateLead(input) {
  const errors = {};
  const lead = {
    name: clean(input.name, 100),
    email: clean(input.email, 254).toLowerCase(),
    company: clean(input.company, 120),
    services: Array.isArray(input.services)
      ? [...new Set(input.services.filter((s) => SERVICES.includes(s)))]
      : [],
    budget: BUDGETS.includes(input.budget) ? input.budget : "",
    message: clean(input.message, 3000),
    page: clean(input.page, 200),
  };

  if (!lead.name) errors.name = "Please add your name.";
  if (!EMAIL_RE.test(lead.email)) errors.email = "Please add a valid email.";
  if (lead.message.length < 10) errors.message = "A line or two about the project, please.";

  return { lead, errors };
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients; other checks still apply
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip") || "").trim();
}

const hashIp = (ip, salt) =>
  ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32) : "";

/**
 * Builds the POST handler. Dependencies are injected so it can be tested
 * without a real database or Google Sheet.
 */
export function createLeadHandler({ getCollection, afterInsert = () => {}, env = process.env }) {
  return async function POST(request) {
    if (!sameOrigin(request)) return json(403, { ok: false, error: "forbidden" });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: "invalid_json" });
    }
    if (!body || typeof body !== "object") return json(400, { ok: false, error: "invalid_json" });

    // Bots: filled the hidden field, or submitted faster than a human could.
    // Answer "ok" so they don't retry, but store nothing.
    const elapsed = Number(body.elapsedMs);
    if (body.website || (Number.isFinite(elapsed) && elapsed < MIN_FILL_MS)) {
      return json(200, { ok: true });
    }

    const { lead, errors } = validateLead(body);
    if (Object.keys(errors).length) return json(400, { ok: false, error: "validation", fields: errors });

    let leads;
    try {
      leads = await getCollection();
    } catch (err) {
      console.error("lets-talk: database unavailable", err);
      return json(503, { ok: false, error: "unavailable" });
    }

    const ipHash = hashIp(clientIp(request), env.IP_HASH_SALT || "varwent");
    try {
      if (ipHash) {
        const recent = await leads.countDocuments({
          ipHash,
          createdAt: { $gte: new Date(Date.now() - RATE_LIMIT.windowMs) },
        });
        if (recent >= RATE_LIMIT.max) return json(429, { ok: false, error: "rate_limited" });
      }

      const doc = {
        ...lead,
        status: "new",
        ipHash,
        userAgent: clean(request.headers.get("user-agent") || "", 300),
        createdAt: new Date(),
        sheet: { attempts: 0 },
      };
      const { insertedId } = await leads.insertOne(doc);
      doc._id = insertedId;

      afterInsert(leads, doc);
      return json(201, { ok: true, id: String(insertedId) });
    } catch (err) {
      console.error("lets-talk: failed to save lead", err);
      return json(500, { ok: false, error: "server" });
    }
  };
}
