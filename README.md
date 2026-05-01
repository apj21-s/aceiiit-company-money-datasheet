# ACE-IIIT Company Money Datasheet

This project supports two modes:

1. Local browser mode
2. Shared online mode through Supabase

## Files

- `index.html`
- `style.css`
- `app.js`
- `data.js`
- `config.js`

## Make It Shared For Everyone

This app is ready for GitHub Pages. To make data shared for all users, connect it to Supabase.

### 1. Create a Supabase project

Create a project in Supabase and open the SQL Editor.

Run this SQL:

```sql
create table if not exists public.company_datasheet (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.company_datasheet enable row level security;

create policy "allow read for anon"
on public.company_datasheet
for select
to anon
using (true);

create policy "allow write for anon"
on public.company_datasheet
for insert
to anon
with check (true);

create policy "allow update for anon"
on public.company_datasheet
for update
to anon
using (true)
with check (true);
```

### 2. Get your Supabase values

From Supabase project settings, copy:

- Project URL
- Anon public key

### 3. Fill in `config.js`

Edit `config.js`:

```js
window.APP_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_PUBLIC_KEY',
  tableName: 'company_datasheet',
  documentId: 'main',
};
```

### 4. Push to GitHub Pages

Commit and push the project. GitHub Pages hosts the frontend, and Supabase stores the shared sheet data.

## How It Works

- Everyone opening the same GitHub Pages URL reads the same shared JSON document.
- Edits save automatically to Supabase.
- The app periodically refreshes to catch updates from others.
- If Supabase is missing or temporarily unavailable, the app falls back to browser storage.

## Important Note

This version stores the full sheet as one JSON document. That is simple and good for a small team, but if multiple people edit at the same time, the latest save wins.

Future upgrades can be:

1. Separate row-level tables in Supabase
2. Team login/auth
3. Edit history / audit log
4. Realtime subscriptions instead of polling
