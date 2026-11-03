CREATE TABLE public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  type text not null default 'RETAIL',
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

CREATE TABLE public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  barcode text,
  hsn text,
  category text,
  purchase_cost numeric(12,2) not null default 0,
  mrp numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  uom_purchase text not null default 'UNIT',
  uom_stock text not null default 'UNIT',
  uom_sale text not null default 'UNIT',
  conversion_factor numeric(12,4) not null default 1,
  min_stock numeric(12,2) not null default 0,
  is_loose boolean not null default false,
  enrichment_status text not null default 'COMPLETE',
  created_at timestamptz not null default now()
);

CREATE TABLE public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  quantity_on_hand numeric(14,3) not null default 0,
  reserved_qty numeric(14,3) not null default 0,
  unique (product_id, location_id)
);

CREATE TABLE public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text,
  age_group text,
  gender text,
  credit_limit numeric(12,2) not null default 0,
  outstanding_balance numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

CREATE TABLE public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  location_id uuid not null references public.locations(id),
  customer_id uuid references public.customers(id) on delete set null,
  total_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  balance_amount numeric(12,2) not null default 0,
  payment_status text not null default 'UNPAID',
  created_at timestamptz not null default now()
);

CREATE TABLE public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  uom text not null default 'UNIT',
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0
);

CREATE TABLE public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric(12,2) not null,
  mode text not null default 'CASH',
  created_at timestamptz not null default now()
);

CREATE TABLE public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  from_location_id uuid not null references public.locations(id),
  to_location_id uuid not null references public.locations(id),
  status text not null default 'REQUESTED',
  notes text,
  created_at timestamptz not null default now()
);

CREATE TABLE public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null default 1
);

CREATE TABLE public.cash_drawer_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  opened_by text not null default 'Operator',
  opening_cash numeric(12,2) not null default 0,
  closing_cash numeric(12,2),
  cash_sales numeric(12,2) not null default 0,
  cash_in numeric(12,2) not null default 0,
  cash_out numeric(12,2) not null default 0,
  status text not null default 'OPEN',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

CREATE TABLE public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  quantity numeric(14,3) not null,
  reason text not null default 'SPOILAGE',
  returnable_to_vendor boolean not null default false,
  cost_loss numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations, public.products, public.inventory, public.customers, public.invoices, public.invoice_items, public.payments, public.stock_transfers, public.stock_transfer_items, public.cash_drawer_sessions, public.stock_adjustments TO anon;
GRANT ALL ON public.locations, public.products, public.inventory, public.customers, public.invoices, public.invoice_items, public.payments, public.stock_transfers, public.stock_transfer_items, public.cash_drawer_sessions, public.stock_adjustments TO service_role;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open access" ON public.locations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.products FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.inventory FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.customers FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.invoices FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.invoice_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.payments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.stock_transfers FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.stock_transfer_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.cash_drawer_sessions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.stock_adjustments FOR ALL TO anon USING (true) WITH CHECK (true);
