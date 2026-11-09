# Staff accounts and login

RetailFlow keeps POS data in Supabase PostgreSQL, but staff credentials and sessions are managed by the RetailFlow server with Better Auth. Staff identity, role, active state, and location assignments remain in `public.users` and `public.staff_location_access`; passwords are stored only as Better Auth password hashes. Supabase Auth is not used for staff sign-in, and this setup does not add customer or e-commerce login.

Route and data visibility is classified by purpose and sensitivity in [access-control.md](./access-control.md). Public dashboard access is limited to fixed daily aggregate totals; operational records remain authenticated and scoped.

## Initial Admin setup

The preferred bootstrap path is a one-time SQL seed run manually by the project owner in the trusted Supabase SQL editor. It matches the current Better Auth schema and sets `must_change_password=true`, so the Admin must choose a personal password before opening operational screens.

1. Confirm migrations `0005_offline_access_and_sync.sql`, `0006_staff_users_pricing_barcodes.sql`, and `0007_app_managed_staff_auth.sql` have been applied. Back up `public.users`, `public.auth_users`, `public.auth_accounts`, and `public.auth_login_identifiers` before seeding.
2. Choose a strong temporary password and keep it in a password manager. From the project root, run:

   ```sh
   node scripts/generate-admin-password-hash.mjs
   ```

   Type the password at the hidden prompt. The helper uses the installed Better Auth password hasher and prints only its compatible hash. The helper does not store or print the password.
3. Replace `PASTE_BETTER_AUTH_HASH_HERE` in `scripts/seed-initial-admin.sql` with the printed hash, then run the entire script in the SQL editor. It runs in a transaction and aborts if an Admin profile or the requested email/mobile already exists. Do not paste the temporary password into SQL.
4. If the SQL editor reports an error, do not continue to sign in. Inspect the business error and confirm that none of the Admin rows were committed before retrying; if the editor leaves the transaction open, roll it back. Restore the hash placeholder before sharing the file, and resolve any existing duplicate profile deliberately.
5. After success, open the POS and sign in with `admin@dailyplazaa.com` (or `8269295929`) and the temporary password. The app should require a new personal password before allowing access to operational pages.

Passwords are never stored as plaintext or encrypted for later recovery. `auth_accounts.password` contains a one-way Better Auth hash; it cannot be used to reveal the temporary password. If the temporary password is lost, issue a reset/new temporary password rather than trying to recover it.

The older `/setup/first-admin` form and its one-time token/RPC remain in the application for now. Do not use that route for this seed process; it asks the operator to choose a password and currently does not set the desired mandatory first-login change. Retire that fallback only after this manual seed and recovery path are verified.

No Supabase Auth provider or Edge Function deployment is needed for staff sign-in. The app's server API uses `SUPABASE_SERVICE_ROLE_KEY`, Better Auth uses a dedicated `BETTER_AUTH_SECRET` containing at least 32 characters, and the server needs canonical `BETTER_AUTH_URL` plus `BETTER_AUTH_TRUSTED_ORIGIN`. Keep all of these out of browser-exposed variables. Production URLs and origins must use HTTPS. For local development use the exact origin shown in the browser, including host and port, for both Better Auth URL settings. The default is `http://localhost:8080`; if the dev server selects another port or you open it as `127.0.0.1`, update both values to match and restart the server. Store secrets in the ignored `.env`; do not use a shared/fallback secret. A missing Supabase server key or untrusted browser origin prevents sign-in and is reported as a service/configuration error rather than an invalid-password result.

After applying `0007_app_managed_staff_auth.sql`, apply `0008_cleanup_legacy_staff_profiles.sql` if the legacy `public.staff_profiles` table still exists. It removes only an empty leftover table, re-points its location-access foreign key to `public.users` when safe, and aborts rather than deleting profile data or unreviewed dependencies. Do not drop other tables based only on their apparent absence from a code search; check the live schema, data, database dependencies, and migration history first.

## Create and validate staff logins

1. Sign in as the bootstrapped Admin while online.
2. Open **Manager → Staff access**, enter a name and at least one of email or mobile, choose a role, and assign locations for Cashiers and Managers.
3. RetailFlow creates the app-managed credential and matching `public.users` profile. The Admin sees a randomly generated temporary password once. Share it securely; it is not persisted in the staff profile or shown again.
4. The staff member signs in with their email/mobile and temporary password, then chooses a personal password before the POS opens. Staff sign-in, provisioning, password changes, and session revocation require a connection.
5. Verify the role and location scope with a Cashier assigned to one outlet, a Manager assigned to their authorized locations, and the Admin. Deactivate or change access from the same staff panel.

Once a device has a local staff profile, billing and local saves can continue offline. Offline logout locks the device immediately, preserves pending bills and outbox work, and revokes the server session when connectivity returns. Legacy outbox operations without a staff owner are moved to review instead of being retried indefinitely.

## Product pricing and barcode data

New products receive a local SKU and an internal Code 128 barcode derived from that SKU. Scanned supplier/barcodes can replace the generated value. This barcode is for RetailFlow's own catalog and is not a GS1-issued EAN. Manager product forms and the Excel template accept quantity breaks such as `6:68,12:64` (minimum quantity:unit price). Retail price applies below the first break; higher quantity breaks must not exceed the retail price or go below the floor price. Billing recalculates the unit price when quantity crosses a break.
