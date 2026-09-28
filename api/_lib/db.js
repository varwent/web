import { MongoClient } from "mongodb";
import { attachDatabasePool } from "@vercel/functions";

// One client per function instance, reused across requests.
// attachDatabasePool releases idle connections before Vercel suspends the instance.
let clientPromise;
let indexesReady;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      appName: "varwent-web",
      maxIdleTimeMS: 5000,
      serverSelectionTimeoutMS: 8000,
    });
    attachDatabasePool(client);
    clientPromise = client.connect().catch((err) => {
      clientPromise = undefined; // let the next request retry
      throw err;
    });
  }
  return clientPromise;
}

export async function getLeadsCollection() {
  const client = await getClient();
  const leads = client.db(process.env.MONGODB_DB || "varwent").collection("leads");
  if (!indexesReady) {
    indexesReady = Promise.all([
      leads.createIndex({ createdAt: -1 }),
      leads.createIndex({ ipHash: 1, createdAt: -1 }),
      leads.createIndex({ "sheet.syncedAt": 1, createdAt: 1 }),
    ]).catch((err) => {
      indexesReady = undefined;
      console.warn("lets-talk: index creation failed", err);
    });
  }
  await indexesReady;
  return leads;
}
