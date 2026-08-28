# Invoice / Order Manager — v2

## 🚨 Do this first: rotate your Supabase service role key

Your uploaded `index.ts` had a **live Supabase service-role key and project
URL hardcoded in plain text** (it was being passed as the *argument* to
`Deno.env.get(...)` instead of an environment variable name). That key
bypasses all Row Level Security and gives full read/write access to your
entire database. Since it was sitting in a plain file, treat it as
compromised:

1. Go to **Supabase Dashboard → Project Settings → API**.
2. Click **"Generate new service_role key"** (or reset the project's API
   keys) to invalidate the old one.
3. Never paste a service-role key directly into any file again — Edge
   Functions get `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` injected
   automatically, so you never need to type them.

Also worth checking now: your **anon key + project URL are public in
`index.html` by design** (that's normal for a Supabase web app) — but that
only stays safe if **Row Level Security (RLS) is turned on** for `tasks`,
`employers`, and `user_subscriptions`. The in-app password prompt
(`checkPass`) only hides the UI; it does nothing to stop someone who has
your anon key from calling the database directly. If RLS isn't already on,
anyone with your site's source can read/write your data. See the RLS
section below for starter policies.

## What was actually going on

- `index.html`'s inline `<script>` is the *only* code that was actually
  running the app. The separate files (`api.js`, `auth.js`, `config.js`,
  `exports.js`, `invoicing.js`, `notifications.js`, `performance.js`,
  `render.js`, `ui-utils.js`, `app-lifecycle.js`) were never linked in
  with a `<script src>` tag anywhere — they were dead weight, and in a
  few places duplicated or contradicted the working code. I removed them
  rather than leave confusing unused copies in the project.
- `sw.js` (the service worker) was **never registered**, so none of it —
  caching, push, background checks — was actually active. It also called
  functions like `openDB()`/`getAllOrders()` that didn't exist anywhere,
  and one handler referenced `document`, which doesn't exist inside a
  service worker at all.
- The push code in `index.ts` sent a plain `fetch()` POST straight to the
  browser's push endpoint. Real push services (Google/Mozilla/Apple)
  require an authenticated, encrypted request (VAPID + payload
  encryption) — a raw POST like that would simply be rejected.

## What's new

| File | Purpose |
|---|---|
| `offline.js` | IndexedDB cache of every order/employer + a write queue. Add/edit/delete orders with zero connection; everything replays to Supabase the instant you're back online. |
| `realtime.js` | Subscribes to Supabase Realtime so every open device refreshes instantly when any other device changes something — this is your multi-device sync. |
| `alarm-engine.js` | Requests notification permission, fires real system notifications for due/overdue orders from on-device data (works fully offline), and registers for background/periodic sync + server push. |
| `sw.js` (rewritten) | Actually registered now. Caches the app shell for offline loading, handles real push payloads, and runs a background deadline check straight from the local cache. |
| `supabase-edge-function/index.ts` (rewritten) | Sends real, VAPID-authenticated push notifications when an order is overdue and the app is closed. No hardcoded secrets. |
| `manifest.json` (updated) | Added description, scope, orientation, categories — makes the install prompt and app listing look complete. |
| `index.html` (updated) | Wires in the new files, adds an **Install** button (Android/desktop) and an **iOS "Add to Home Screen"** banner (Safari never shows an automatic install prompt), registers the service worker. |

## The one honest limit on offline notifications

Local notifications from data already on the phone need **zero internet**
— that part is solved, and works in airplane mode as long as the order
had synced at least once before you went offline. What no PWA on any
phone can guarantee is an **exact, to-the-second alert while the app is
fully closed and the phone has been offline for a long stretch** —
browsers wake a closed PWA's background sync occasionally, not on a
precise timer. Only a native app using the OS's own alarm system (Android
`AlarmManager`, etc.) can promise that. Keeping the app open, or just
glancing at it near a deadline, is what guarantees the alert fires
instantly every time.

Real push notifications (server → device, even with the app closed) do
work reliably, but by definition they need the **receiving device** to
have internet at the moment the push arrives — that's a hard requirement
of how push works everywhere (iOS, Android, desktop), not something
specific to this app.

## Setup you still need to do

### 1. Enable Realtime replication (for multi-device sync)
Supabase Dashboard → **Database → Replication** → turn on replication for
the `tasks` and `employers` tables (they need to be in the
`supabase_realtime` publication).

### 2. Row Level Security (RLS)
If you want the password prompt to mean something, add real auth
(Supabase Auth) and policies like:

```sql
alter table tasks enable row level security;
alter table employers enable row level security;
alter table user_subscriptions enable row level security;

-- Example once you add Supabase Auth and an owner_id column:
create policy "owner can read/write own tasks"
  on tasks for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
```

Until you add real auth, at minimum keep RLS on with policies scoped to
what your anon key truly needs — an app with no RLS and a public anon key
is readable/writable by anyone who opens dev tools.

### 3. Create `user_subscriptions` (for server push)
```sql
create table user_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text unique not null,
  subscription_json text not null,
  created_at timestamptz default now()
);
```

### 4. Generate VAPID keys (for server push)
```bash
npx web-push generate-vapid-keys
```
- Paste the **public** key into `alarm-engine.js` → `VAPID_PUBLIC_KEY`.
- Set both as Edge Function secrets:
```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
```

### 5. Deploy and schedule the Edge Function
```bash
supabase functions deploy check-deadlines
```
Then schedule it to run every minute or so, either via **Database →
Cron Jobs (pg_cron)** calling the function's URL, or the **Schedules**
tab under Edge Functions in the dashboard.

### 6. Icons
`icon.png` is reused for both 192×192 and 512×512 — it'll look fine as a
home-screen icon, but for the crispest result on Android's adaptive icon
shapes, a version with some padding ("maskable" icon) looks better. Not
required to work — just a polish item if you want it later.

## Installing on a phone
- **Android / Chrome / Edge**: open the site, tap the green **Install
  App** button that appears (or the browser's own "Install app" menu
  item).
- **iPhone / iPad (Safari)**: Safari never shows an automatic install
  prompt — tap the **Share** icon, then **"Add to Home Screen"**. The
  app now shows this instruction automatically the first time you open
  it in Safari.
