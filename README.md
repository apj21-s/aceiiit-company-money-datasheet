# ACE-IIIT Company Money Datasheet

This version uses:

1. GitHub Pages for hosting
2. Supabase Auth for login
3. Supabase Postgres for shared sheet data

## Access Model

The page URL can stay public, but the data is protected:

- visitors first see a login screen
- only approved team accounts can sign in
- database access is enforced by Supabase RLS

## Files

- `index.html`
- `style.css`
- `config.js`
- `auth.js`
- `data.js`
- `app.js`

## 1. Create the data table

Run this in Supabase SQL Editor:

```sql
create table if not exists public.company_datasheet (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.company_datasheet enable row level security;
```

## 2. Create restricted RLS policies

Replace the three emails below with the real team emails.

This uses the JWT email claim pattern recommended by Supabase docs through `auth.jwt() ->> 'email'`.

```sql
drop policy if exists "company_datasheet_select_allowed" on public.company_datasheet;
drop policy if exists "company_datasheet_insert_allowed" on public.company_datasheet;
drop policy if exists "company_datasheet_update_allowed" on public.company_datasheet;

create policy "company_datasheet_select_allowed"
on public.company_datasheet
for select
to authenticated
using (
  (auth.jwt() ->> 'email') in (
    'priyanshu@example.com',
    'uman@example.com',
    'arkaprava@example.com'
  )
);

create policy "company_datasheet_insert_allowed"
on public.company_datasheet
for insert
to authenticated
with check (
  (auth.jwt() ->> 'email') in (
    'priyanshu@example.com',
    'uman@example.com',
    'arkaprava@example.com'
  )
);

create policy "company_datasheet_update_allowed"
on public.company_datasheet
for update
to authenticated
using (
  (auth.jwt() ->> 'email') in (
    'priyanshu@example.com',
    'uman@example.com',
    'arkaprava@example.com'
  )
)
with check (
  (auth.jwt() ->> 'email') in (
    'priyanshu@example.com',
    'uman@example.com',
    'arkaprava@example.com'
  )
);
```

## 3. Create the three auth users

In Supabase:

1. Open `Authentication`
2. Open `Users`
3. Create users for:
   - Priyanshu
   - Uman
   - Arkaprava
4. Set their email addresses and passwords

Recommended:

- use email + password auth
- disable open public sign-up if you do not want anyone else creating accounts

## 4. Update `config.js`

Edit `config.js` and replace the placeholder emails with the real ones:

```js
window.APP_CONFIG = {
  supabaseUrl: 'https://aosnjbzzsynbbopcbmnn.supabase.co',
  supabaseAnonKey: 'YOUR_PUBLISHABLE_KEY',
  tableName: 'company_datasheet',
  documentId: 'main',
  allowedUsers: [
    { name: 'Priyanshu', email: 'real-priyanshu-email@example.com' },
    { name: 'Uman', email: 'real-uman-email@example.com' },
    { name: 'Arkaprava', email: 'real-arkaprava-email@example.com' },
  ],
};
```

## 5. Push to GitHub Pages

Once deployed:

- anyone can open the page URL
- only logged-in approved users can access the sheet
- all shared reads and writes happen with the signed-in user token

## Password Management

Approved users now have two ways to manage passwords:

1. `Reset Password` from the login screen
   - enter the approved email
   - Supabase sends a recovery link
   - when they open that link, the app loads and they can set a new password

2. `Update Password` after login
   - sign in normally
   - use the password form in the header
   - save a new password directly

Important Supabase setting:

- In `Authentication` settings, add your GitHub Pages site URL to the allowed redirect URLs / site URL list.
- Example:
  - `https://yourusername.github.io`
  - or `https://yourusername.github.io/your-repo-name/`

## Important Notes

- If the emails in `config.js` and the RLS policy do not match, access will fail.
- The current app stores the sheet as one shared JSON document, so if two approved users save at exactly the same time, the latest save wins.
- This is real protection at the database layer, not just frontend hiding.
- The sheet now also stores manual audit metadata inside the shared JSON:
  - who last updated it
  - when they updated it
  - which section was updated most recently
  - which field was touched most recently
