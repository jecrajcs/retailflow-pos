# RetailFlow access policy

Access is decided by what a screen/action needs and what its data reveals, not by whether it happens to use `GET`. The policy is intentionally explicit and should be reviewed whenever a route, response field, table, or user role changes.

## Initial access matrix

| Surface                                                   | Access                                                                                                                      | Reason                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` dashboard overview                                    | Public, aggregate only                                                                                                      | Enables a quick review without disclosing individual transactions or customer records. It shows today's completed-bill count and total sales only; total sales still reveals commercially sensitive turnover, so anyone who can reach the app can see it. |
| `/setup/first-admin`                                      | Public form; POST requires a valid single-use bootstrap token                                                               | Required to initialize the first owner account before any Admin exists. The token digest is stored server-side and consumed atomically.                                                                                                                   |
| Staff login and session endpoints                         | Public sign-in; protected session read/write                                                                                | Login must be reachable before a session exists. Session data is never returned to unauthenticated callers.                                                                                                                                               |
| Billing, sales register, inventory, and cash drawer       | Signed-in staff, restricted to assigned locations                                                                           | These screens expose customer/transaction information or allow store operations. Server APIs must enforce the same location scope.                                                                                                                        |
| Purchases, stock adjustments/transfers, sync-alert review | Manager or Admin and assigned location(s)                                                                                   | These actions affect stock valuation, supplier documents, and reconciliation.                                                                                                                                                                             |
| Staff account/role/location management                    | Admin only                                                                                                                  | Changes identities and authorization.                                                                                                                                                                                                                     |
| POS product data for Cashiers                             | Signed-in, assigned POS scope; no purchase cost or preferred supplier                                                       | Cashiers need sale-facing catalog fields, not cost or supplier details.                                                                                                                                                                                   |
| Customer data for Cashiers                                | Signed-in staff; customer name/mobile and credit/balance needed for service; demographics, visit counts, and notes withheld | Contact and balance data support billing/credit checks. Additional profile details are not needed for cashier work.                                                                                                                                       |
| Public API `/api/public-overview`                         | Public, fixed aggregate response only                                                                                       | Returns business date, completed bill count, and total sales. It never returns invoice rows, IDs, customers, locations, payments, or database errors.                                                                                                     |
| Raw snapshot/sync APIs                                    | Signed-in, role/location authorization                                                                                      | These APIs contain operational records and are never public.                                                                                                                                                                                              |

This matrix is a starting point, not a claim that every future business case is covered. Before expanding public data, identify the purpose, audience, fields, aggregation level, privacy/commercial impact, retention/cache behavior, and server-side enforcement. Prefer aggregated responses over row-level data. A page being public does not make its APIs public by default.

## Adding or changing access

1. Update `src/lib/access-policy.ts` with the page/API classification.
2. Keep protected-route UI gating in `AccessBoundary`, but independently authenticate and authorize each protected API handler.
3. Use server-side projections/aggregates; do not rely on hiding a column in React.
4. Add tests for allowed access, denied access, location/role boundaries, and response fields that must not leak.
5. Update this matrix with the reason and any newly exposed data before release.

## Create the initial Admin

The initial Admin identity requested for this store is:

- Name: **DailyPlazaa Admin**
- Login: **admin@dailyplazaa.com**
- Mobile: **8269295929**

The account has **not** been created by this code change. Creating it requires a working production server configuration (`SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `BETTER_AUTH_TRUSTED_ORIGIN`) and a valid one-time bootstrap token. Do not put these secrets in browser variables, source control, or chat.

Once the deployed server is configured and the database has `0007`:

1. Generate a high-entropy setup token and insert only its SHA-256 hex digest in `public.auth_bootstrap_tokens` using a trusted database session. Keep the token temporarily and share it only with the owner through a secure channel.
2. Open `/setup/first-admin`, enter **DailyPlazaa Admin**, `admin@dailyplazaa.com` (and `8269295929` if desired), the one-time token, and a strong owner-chosen password.
3. The form creates the credential/profile, signs in, and consumes the token. Verify `/api/staff-session` returns the Admin role while signed in.
4. Remove any unused bootstrap token rows. Never create an Admin by direct table edits or reuse the one-time token.

## Add the next store users

After signing in as Admin:

1. Open **Manager → Staff access → Add staff**.
2. Enter the staff member's name and at least one unique email or mobile number; choose Cashier, Manager, or Admin.
3. Assign one or more locations to Cashiers and Managers. Admins can access all active locations.
4. Save and securely deliver the one-time temporary password shown by the app. It is not stored for later display.
5. The staff member signs in with their email/mobile and temporary password, then sets a personal password before using the POS.
6. Confirm the role and location restrictions with that staff account. Deactivate or reset access from the same Admin panel when needed.
