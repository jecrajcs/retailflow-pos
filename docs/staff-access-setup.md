# Staff accounts and login

RetailFlow uses Supabase Auth for staff credentials and sessions. POS roles, activation, mandatory password changes, and location assignments are stored separately in `public.users` and `public.staff_location_access`. `public.users.user_id` is the same UUID as `auth.users.id`; Supabase-managed `auth.*` tables are not part of RetailFlow migrations.

The public dashboard exposes only aggregate totals. Operational pages and APIs require an active staff profile, and server APIs enforce role and location scope. See [access-control.md](./access-control.md).

## Database setup

The baseline migration is [`20260625000000_retailflow_supabase_auth_baseline.sql`](../supabase/migrations/20260625000000_retailflow_supabase_auth_baseline.sql). It is intentionally destructive to the old RetailFlow schema: it drops the app-owned tables and functions from the previous SQL migrations, then creates the current schema. It does **not** drop Supabase-managed Auth, Storage, or system schemas. The later [`20261109000000_manager_scoped_cashier_access.sql`](../supabase/migrations/20261109000000_manager_scoped_cashier_access.sql) migration is forward-only and enables Managers to provision Cashiers only within their assigned locations.

1. Back up anything you may need. This reset removes RetailFlow business records, staff profiles, role/location assignments, and the old Better Auth tables. It does not remove Supabase Auth accounts.
2. Run the entire baseline migration once from the Supabase SQL editor or apply it through the configured Supabase migration workflow. Do not run it against a database whose RetailFlow data you need to keep; do not re-run it after setup because it drops and recreates the RetailFlow schema. If the baseline has already been run, do not run it again.
3. Apply `20261109000000_manager_scoped_cashier_access.sql` after the baseline. This migration replaces the staff-profile RPC without dropping existing data. It is required for Manager-managed Cashier accounts; it does not replace or re-run the baseline.
4. Configure server-only `SUPABASE_SERVICE_ROLE_KEY` and the server `SUPABASE_URL`. The browser/build also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; the server login proxy uses `SUPABASE_PUBLISHABLE_KEY`. Never expose the service-role key in browser variables, source control, or chat.
5. If staff will sign in by mobile number, enable/configure the Supabase Auth phone provider and SMS delivery. Phone users must be confirmed according to the project’s Auth settings.

The app and the migration do not drop the Supabase Auth user you created in Lovable. Supabase Auth remains the source of credentials; the profile table only grants RetailFlow POS access. The shared sign-in screen accepts the email or confirmed mobile number and password for every role. A successful Supabase Auth login must also match an active `public.users` profile to enter the POS.

## Link the first Admin

There is no `/first-admin` route. Create the initial account manually through **Lovable Cloud → Project Settings (More) → Users → Add user** (or Supabase Auth), and ensure the login method you plan to use is confirmed. Then:

1. Copy that Auth user’s UUID from the Users list.
2. Replace the placeholder UUID and display name in [`link-initial-admin.sql`](../scripts/link-initial-admin.sql).
3. Run the SQL in the Supabase SQL editor. It aborts if the Auth user is missing, a staff profile already exists, or an active Admin has already been linked.
4. Sign in with that account. The profile is marked `ADMIN`; Admins can access all active locations without individual location assignments. The login redirects to `/admin`.

## Provision staff and validate access

1. Sign in online as the linked Admin and open **Admin → Locations**. Create and activate at least one store or warehouse; location codes must be unique.
2. Open **Admin → Staff access**. Create a Manager and assign one or more active locations. Admin profiles do not need location assignments.
3. A Manager signs in to `/manager` and can create or update Cashier accounts only for locations assigned to that Manager. Manager accounts cannot create or edit other Manager/Admin accounts or Cashiers whose assignments extend outside their scope.
4. RetailFlow creates the Supabase Auth user and a corresponding POS profile. A temporary password is shown once; share it securely. The staff member must set a personal password before using operational screens.
5. Verify a Cashier sees only assigned locations, a Manager can use management workflows only within assigned locations, and the Admin can manage all locations. A location can be deactivated only after its cash shifts are closed, staff assignments are removed/reassigned, and inventory sync alerts are resolved. Deactivating a profile immediately blocks RetailFlow APIs even if its Supabase Auth account still exists.

Staff sign-in, provisioning, password changes, and server synchronization require a connection. After a successful online sign-in, the device caches the access profile so POS work can continue offline. Offline logout locks the device immediately, preserves pending bills/outbox work, and revokes the Supabase session when connectivity returns. Legacy outbox operations without a verified staff owner are moved to review.

## Verification boundary

The repository test suite verifies route matching and local policy rules, and the app can be built and served locally. These checks do not prove a real Supabase login, database migration state, or a full sale-to-sync journey. Before relying on the deployment, apply the forward Manager-scope migration, verify the manually linked Admin and first active location, and then test a uniquely identified Cashier sale in an isolated/test project. Do not use production customer, inventory, or staff records as test fixtures; do not re-run the destructive baseline to test.

## Product pricing and barcode data

New products receive a local SKU and an internal Code 128 barcode derived from that SKU. Scanned supplier/barcodes can replace the generated value. This barcode is for RetailFlow's own catalog and is not a GS1-issued EAN. Manager product forms and the Excel template accept quantity breaks such as `6:68,12:64` (minimum quantity:unit price). Retail price applies below the first break; higher quantity breaks must not exceed the retail price or go below the floor price. Billing recalculates the unit price when quantity crosses a break.
