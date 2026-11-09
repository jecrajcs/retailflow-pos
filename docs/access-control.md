# RetailFlow access policy

Access is based on the action and data sensitivity, not HTTP method. Supabase Auth validates staff credentials; an active row in `public.users` grants POS access, and `public.staff_location_access` scopes Cashier and Manager operations.

## Access matrix

| Surface | Access | Enforcement |
|---|---|---|
| `/` dashboard | Public, aggregate only | Public overview returns business date, completed bill count, and total sales only. |
| `/admin` and `/api/admin/locations` | Active Admin only | Admin UI is role-gated; the location API independently checks the active Admin profile and same-origin mutations. |
| `/manager` | Active Manager only | Manager UI is role-gated; operational APIs enforce Manager role and assigned-location scope. |
| Staff login | Public sign-in endpoint | `/api/pos/login` proxies email/phone password sign-in to Supabase Auth and returns the active POS profile; credentials are not stored in RetailFlow tables. |
| Staff session, password, and staff management APIs | Signed-in; staff management is Admin or Manager according to target role and location scope | Each server handler verifies the Supabase access token, then loads an active POS profile and applies role/scope checks. |
| Billing, sales, inventory, and cash drawer | Active staff; location restricted | The server snapshot/sync APIs enforce roles and assigned locations. |
| Purchases, stock adjustments/transfers, sync-alert review | Manager or Admin; location restricted | Server checks role and each relevant location. |
| Staff role/location management | Admin manages network staff; Manager manages Cashiers only within assigned locations | API checks actor and target scopes; `app_save_staff_profile` repeats the Manager-to-Cashier and location-scope checks in the database. |
| Location creation and activation | Admin only | Admin location API validates input; deactivation is blocked while open shifts, assigned staff, or unresolved sync alerts remain. |
| Cashier catalog/customer data | Signed-in and role projected | Cashiers do not receive purchase cost, supplier, customer demographic, visit-count, or notes fields. |
| Raw snapshot/sync APIs | Staff-only | No operational rows are exposed through public endpoints. |

The initial Admin is created manually in Supabase Auth, then linked by Auth UUID using [`link-initial-admin.sql`](../scripts/link-initial-admin.sql). There is no public first-Admin bootstrap route. After sign-in, create the first location in `/admin`, then provision a Manager and assign the Manager's locations.

## Change checklist

1. Update `src/lib/access-policy.ts` when a page or API classification changes.
2. Keep the UI gate in `AccessBoundary`, but authenticate and authorize every protected server API independently.
3. Use server-side projections/aggregates; hiding a field in React is not authorization.
4. Test unauthenticated access, role/location boundaries, offline logout, and sensitive response fields.
5. Update this matrix and the setup instructions before release.
