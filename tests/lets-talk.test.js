import { test } from "node:test";
import assert from "node:assert/strict";
import { createLeadHandler, validateLead } from "../api/_lib/lead.js";
import { syncLeadsToSheet, toSheetRow } from "../api/_lib/sheets.js";

// --- Minimal in-memory stand-in for a MongoDB collection -------------------
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const matches = (doc, query) =>
  Object.entries(query).every(([path, cond]) => {
    const v = get(doc, path);
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === "$gte") return v >= x;
        if (op === "$lt") return v < x;
        if (op === "$ne") return String(v) !== String(x);
        if (op === "$exists") return (v !== undefined) === x;
        throw new Error(`op ${op}`);
      });
    }
    return String(v) === String(cond);
  });
const setPath = (obj, path, val) => {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  if (val === undefined) delete target[last];
  else target[last] = val;
};

function fakeCollection() {
  const docs = [];
  let n = 0;
  return {
    docs,
    async countDocuments(q) {
      return docs.filter((d) => matches(d, q)).length;
    },
    async insertOne(doc) {
      const _id = `id${++n}`;
      docs.push({ ...structuredClone(doc), _id });
      return { insertedId: _id };
    },
    async updateOne(q, u) {
      const d = docs.find((x) => matches(x, q));
      if (!d) return;
      for (const [k, v] of Object.entries(u.$set || {})) setPath(d, k, v);
      for (const k of Object.keys(u.$unset || {})) setPath(d, k, undefined);
      for (const [k, v] of Object.entries(u.$inc || {})) setPath(d, k, (get(d, k) || 0) + v);
    },
    find(q) {
      let out = docs.filter((d) => matches(d, q));
      const cursor = {
        sort: (s) => {
          const [[k, dir]] = Object.entries(s);
          out = out.sort((a, b) => (get(a, k) - get(b, k)) * dir);
          return cursor;
        },
        limit: (l) => ((out = out.slice(0, l)), cursor),
        toArray: async () => out,
      };
      return cursor;
    },
  };
}

// --- Helpers ----------------------------------------------------------------
const valid = {
  name: "Priya Sharma",
  email: "Priya@Example.com",
  company: "Acme Foods",
  services: ["web", "ai", "bogus"],
  budget: "5k-15k",
  message: "We need a new marketing site with a chatbot.",
  page: "/",
  elapsedMs: 9000,
};

const post = (body, headers = {}) =>
  new Request("https://varwent.com/api/lets-talk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "https://varwent.com",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function setup() {
  const leads = fakeCollection();
  const inserted = [];
  const handler = createLeadHandler({
    getCollection: async () => leads,
    afterInsert: (_c, doc) => inserted.push(doc),
    env: {},
  });
  return { leads, inserted, handler };
}

// --- Handler ------------------------------------------------------------------
test("valid lead is saved and returns 201", async () => {
  const { leads, inserted, handler } = setup();
  const res = await handler(post(valid));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(leads.docs.length, 1);

  const doc = leads.docs[0];
  assert.equal(doc.email, "priya@example.com");
  assert.deepEqual(doc.services, ["web", "ai"]); // unknown values dropped
  assert.equal(doc.status, "new");
  assert.equal(doc.sheet.attempts, 0);
  assert.match(doc.ipHash, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(doc).includes("203.0.113.7"), "raw IP must not be stored");
  assert.equal(inserted.length, 1, "afterInsert (sheet sync) is triggered");
});

test("missing fields return 400 with field errors", async () => {
  const { leads, handler } = setup();
  const res = await handler(post({ name: "", email: "nope", message: "hi", elapsedMs: 9000 }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(Object.keys(body.fields).sort(), ["email", "message", "name"]);
  assert.equal(leads.docs.length, 0);
});

test("honeypot and too-fast submissions look ok but store nothing", async () => {
  const { leads, handler } = setup();
  assert.equal((await handler(post({ ...valid, website: "spam.biz" }))).status, 200);
  assert.equal((await handler(post({ ...valid, elapsedMs: 300 }))).status, 200);
  assert.equal(leads.docs.length, 0);
});

test("cross-origin browser posts are rejected", async () => {
  const { handler } = setup();
  const res = await handler(post(valid, { origin: "https://evil.example" }));
  assert.equal(res.status, 403);
});

test("bad JSON returns 400", async () => {
  const { handler } = setup();
  assert.equal((await handler(post("{nope"))).status, 400);
});

test("rate limit: 6th submission from one IP in 10 minutes gets 429", async () => {
  const { handler } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await handler(post(valid))).status, 201);
  assert.equal((await handler(post(valid))).status, 429);
  // a different visitor is unaffected
  assert.equal((await handler(post(valid, { "x-forwarded-for": "198.51.100.1" }))).status, 201);
});

test("database outage returns 503 without throwing", async () => {
  const handler = createLeadHandler({
    getCollection: async () => {
      throw new Error("down");
    },
    env: {},
  });
  assert.equal((await handler(post(valid))).status, 503);
});

test("validateLead trims and caps lengths", () => {
  const { lead, errors } = validateLead({ ...valid, name: "  A  ", message: "x".repeat(5000) });
  assert.equal(lead.name, "A");
  assert.equal(lead.message.length, 3000);
  assert.deepEqual(errors, {});
});

// --- Sheets sync ----------------------------------------------------------------
const env = { SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/x/exec", SHEETS_WEBHOOK_SECRET: "s3cret" };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

test("toSheetRow uses readable labels", () => {
  const row = toSheetRow({ _id: "abc", createdAt: new Date("2026-09-28T10:00:00Z"), ...valid, services: ["web", "ai"] });
  assert.equal(row.services, "Web development, AI integrations");
  assert.equal(row.budget, "$5k – $15k");
  assert.equal(row.id, "abc");
});

test("successful sync marks the lead as synced and sends the secret", async () => {
  const leads = fakeCollection();
  const { insertedId } = await leads.insertOne({ ...valid, createdAt: new Date(), sheet: { attempts: 0 } });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return reply({ ok: true });
  };
  await syncLeadsToSheet(leads, leads.docs[0], { env, fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.secret, "s3cret");
  assert.equal(calls[0].body.lead.id, insertedId);
  assert.ok(leads.docs[0].sheet.syncedAt instanceof Date);
});

test("failed sync is recorded, then retried with the next lead", async () => {
  const leads = fakeCollection();
  await leads.insertOne({ ...valid, createdAt: new Date(Date.now() - 5 * 60_000), sheet: { attempts: 0 } });
  const old = leads.docs[0];

  await syncLeadsToSheet(leads, old, { env, fetchImpl: async () => reply({ ok: false, error: "unauthorized" }) });
  assert.equal(old.sheet.attempts, 1);
  assert.match(old.sheet.error, /unauthorized/);
  assert.equal(old.sheet.syncedAt, undefined);

  await leads.insertOne({ ...valid, createdAt: new Date(), sheet: { attempts: 0 } });
  const fresh = leads.docs[1];
  const sent = [];
  await syncLeadsToSheet(leads, fresh, {
    env,
    fetchImpl: async (_u, init) => (sent.push(JSON.parse(init.body).lead.id), reply({ ok: true })),
  });
  assert.deepEqual(sent, [fresh._id, old._id], "new lead first, then the backlog");
  assert.ok(old.sheet.syncedAt && !old.sheet.error);
});

test("non-JSON Apps Script reply (e.g. wrong URL / login page) counts as a failure", async () => {
  const leads = fakeCollection();
  await leads.insertOne({ ...valid, createdAt: new Date(), sheet: { attempts: 0 } });
  await syncLeadsToSheet(leads, leads.docs[0], {
    env,
    fetchImpl: async () => new Response("<html>Sign in</html>", { status: 200 }),
  });
  assert.match(leads.docs[0].sheet.error, /unexpected response/);
});

test("sync is skipped when Sheets isn't configured", async () => {
  const leads = fakeCollection();
  await leads.insertOne({ ...valid, createdAt: new Date(), sheet: { attempts: 0 } });
  let called = false;
  await syncLeadsToSheet(leads, leads.docs[0], { env: {}, fetchImpl: async () => ((called = true), reply({})) });
  assert.equal(called, false);
});
