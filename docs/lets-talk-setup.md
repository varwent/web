# "Let's talk" form — setup

```
Website form ──POST /api/lets-talk──▶ Vercel function ──▶ MongoDB Atlas  (source of truth)
                                              │
                                              └─(background)─▶ Google Apps Script ──▶ Google Sheet
```

- Every "Let's talk" / "Start a project" button opens the form. `varwent.com/lets-talk` opens it directly (shareable link).
- Leads are saved to MongoDB first. The visitor sees "Thanks" only after the save succeeds.
- The copy to Google Sheets runs after the response. If it fails, the lead keeps a `sheet.error`, and it's retried
  (up to 5 times) whenever the next lead comes in. The sheet skips IDs it already has, so there are no duplicates.

Code: `api/lets-talk.js`, `api/_lib/*`, `integrations/google-sheets/Code.gs`. Tests: `npm test`.

---

## 1. MongoDB Atlas (≈3 min)

**Easiest — Vercel Marketplace (recommended)**

1. Vercel dashboard → your project → **Storage** (or **Integrations → Marketplace**) → **MongoDB Atlas** → *Create*.
2. Pick the **Free** plan and a region close to your Vercel functions (e.g. Mumbai `ap-south-1` or wherever your project runs).
3. Connect it to this project for **Production** and **Preview**.

Vercel adds `MONGODB_URI` for you. Nothing else to do.

**Already have an Atlas cluster?**

1. Atlas → **Database Access** → add a user with *Read and write to any database* (or just the `varwent` DB).
2. Atlas → **Network Access** → *Add IP Address* → `0.0.0.0/0` (Vercel functions don't have fixed IPs).
3. Atlas → **Connect → Drivers** → copy the `mongodb+srv://…` string and put in the user's password.
4. Vercel → project → **Settings → Environment Variables** → add `MONGODB_URI` = that string
   (Production + Preview). **Don't paste it in chat or commit it.**

Leads land in database **`varwent`**, collection **`leads`** (override the database with `MONGODB_DB`).

## 2. Google Sheet (≈5 min)

1. Open the sheet → **Extensions → Apps Script**.
2. Delete the sample code, paste all of `integrations/google-sheets/Code.gs`, click **Save**.
3. In the function dropdown pick **`setup`** → **Run** → approve the Google permissions prompt
   (it's your own script: *Advanced → Go to project → Allow*).
4. Open **Execution log** — copy the long secret it printed. That's `SHEETS_WEBHOOK_SECRET`
   (leave `SHARED_SECRET` in the code as `PASTE_SECRET_HERE`; the script reads the one `setup` saved).
   A **Leads** tab with headers now exists in the sheet.
5. **Deploy → New deployment** → type **Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   → **Deploy** → copy the **Web app URL** (ends in `/exec`). That's `SHEETS_WEBHOOK_URL`.
6. Vercel → **Settings → Environment Variables** → add both (Production + Preview):
   - `SHEETS_WEBHOOK_URL`
   - `SHEETS_WEBHOOK_SECRET`

"Anyone" only means the URL can be called without a Google login. Requests without the secret are rejected.
Check it's live by opening the URL in a browser: it should show `{"ok":true,"service":"varwent-leads"}`.

> Changed `Code.gs` later? **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
> The URL stays the same.

## 3. Redeploy

Environment variables apply to new deployments. Vercel → **Deployments** → latest → **⋯ → Redeploy**.

## Environment variables

| Name | Required | What |
|---|---|---|
| `MONGODB_URI` | yes | Atlas connection string (auto-set by the Marketplace integration) |
| `SHEETS_WEBHOOK_URL` | for Sheets | Apps Script web app `/exec` URL |
| `SHEETS_WEBHOOK_SECRET` | for Sheets | Secret printed by `setup()` |
| `MONGODB_DB` | no | Database name, default `varwent` |
| `IP_HASH_SALT` | no | Any random string; used to hash visitor IPs for rate limiting (raw IPs are never stored) |

## What's stored

```js
{
  name, email,
  phone: "+919876543210", phoneCountry: "IN",   // E.164
  businessType: "ecommerce",                    // startup | small-business | ecommerce | agency | enterprise | other
  page: "/", status: "new", createdAt, userAgent,
  ipHash,                                   // salted hash, for rate limiting only
  sheet: { attempts, syncedAt?, error? }    // Google Sheets copy status
}
```

Spam protection: hidden honeypot field, minimum fill time, same-origin check, and 5 submissions per visitor per 10 minutes.

## Troubleshooting

Sheet columns: Received · Name · Phone · Email · Business type · Page · Lead ID

- **Form says "Couldn't send that just now"** → Vercel → project → **Logs**, filter `lets-talk`.
  `MONGODB_URI is not set` = step 1 not done (or not redeployed). Timeouts = Atlas Network Access missing `0.0.0.0/0`.
- **In Mongo but not in the sheet** → look at the lead's `sheet.error` in Atlas.
  `unauthorized` = secret mismatch. `unexpected response` = wrong URL, or the deployment isn't "Anyone".
