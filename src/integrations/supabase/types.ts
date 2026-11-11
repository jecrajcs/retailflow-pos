export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      cash_drawer_sessions: {
        Row: {
          cash_in: number
          cash_out: number
          cash_sales: number
          closed_at: string | null
          closed_by_id: string | null
          close_block_reason: string | null
          closing_cash: number | null
          closing_denominations: Json | null
          id: string
          location_id: string
          opened_at: string
          opened_by: string
          opened_by_id: string | null
          opening_cash: number
          opening_denominations: Json | null
          override_by_id: string | null
          override_difference: number | null
          override_reason: string | null
          status: string
        }
        Insert: {
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          closed_at?: string | null
          closed_by_id?: string | null
          close_block_reason?: string | null
          closing_cash?: number | null
          closing_denominations?: Json | null
          id?: string
          location_id: string
          opened_at?: string
          opened_by?: string
          opened_by_id?: string | null
          opening_cash?: number
          opening_denominations?: Json | null
          override_by_id?: string | null
          override_difference?: number | null
          override_reason?: string | null
          status?: string
        }
        Update: {
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          closed_at?: string | null
          closed_by_id?: string | null
          close_block_reason?: string | null
          closing_cash?: number | null
          closing_denominations?: Json | null
          id?: string
          location_id?: string
          opened_at?: string
          opened_by?: string
          opened_by_id?: string | null
          opening_cash?: number
          opening_denominations?: Json | null
          override_by_id?: string | null
          override_difference?: number | null
          override_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_drawer_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_transactions: {
        Row: {
          amount: number
          created_at: string
          direction: string
          id: string
          location_id: string
          reason: string
          session_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          direction: string
          id?: string
          location_id: string
          reason?: string
          session_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          direction?: string
          id?: string
          location_id?: string
          reason?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_transactions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_drawer_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cashier_shortcuts: {
        Row: {
          location_id: string
          product_ids: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          location_id: string
          product_ids?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          location_id?: string
          product_ids?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashier_shortcuts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashier_shortcuts_updated_by_app_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      customers: {
        Row: {
          age_group: string | null
          created_at: string
          credit_limit: number
          gender: string | null
          id: string
          mobile: string | null
          name: string | null
          notes: string | null
          segment: string | null
          outstanding_balance: number
          visits: number
        }
        Insert: {
          age_group?: string | null
          created_at?: string
          credit_limit?: number
          gender?: string | null
          id?: string
          mobile?: string | null
          name?: string | null
          notes?: string | null
          segment?: string | null
          outstanding_balance?: number
          visits?: number
        }
        Update: {
          age_group?: string | null
          created_at?: string
          credit_limit?: number
          gender?: string | null
          id?: string
          mobile?: string | null
          name?: string | null
          notes?: string | null
          segment?: string | null
          outstanding_balance?: number
          visits?: number
        }
        Relationships: []
      }
      inventory: {
        Row: {
          id: string
          location_id: string
          product_id: string
          quantity_on_hand: number
          reserved_qty: number
        }
        Insert: {
          id?: string
          location_id: string
          product_id: string
          quantity_on_hand?: number
          reserved_qty?: number
        }
        Update: {
          id?: string
          location_id?: string
          product_id?: string
          quantity_on_hand?: number
          reserved_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sync_alerts: {
        Row: {
          created_at: string
          id: string
          location_id: string
          message: string
          operation_id: string
          product_id: string
          resolved_at: string | null
          resulting_quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          message: string
          operation_id: string
          product_id: string
          resolved_at?: string | null
          resulting_quantity: number
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          message?: string
          operation_id?: string
          product_id?: string
          resolved_at?: string | null
          resulting_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sync_alerts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sync_alerts_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "offline_sync_operations"
            referencedColumns: ["operation_id"]
          },
          {
            foreignKeyName: "inventory_sync_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          discount: number
          id: string
          invoice_id: string
          product_id: string
          quantity: number
          total: number
          unit_price: number
          uom: string
          unit_cost_snapshot: number | null
        }
        Insert: {
          discount?: number
          id?: string
          invoice_id: string
          product_id: string
          quantity?: number
          total?: number
          unit_price?: number
          uom?: string
          unit_cost_snapshot?: number | null
        }
        Update: {
          discount?: number
          id?: string
          invoice_id?: string
          product_id?: string
          quantity?: number
          total?: number
          unit_price?: number
          uom?: string
          unit_cost_snapshot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance_amount: number
          business_date: string
          cashier_id: string | null
          cashier_name: string | null
          created_at: string
          customer_id: string | null
          customer_segment: string | null
          discount_amount: number
          draft_payload: Json | null
          id: string
          invoice_number: string | null
          invoice_status: string
          location_id: string
          order_type: string | null
          paid_amount: number
          payment_status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          balance_amount?: number
          business_date?: string
          cashier_id?: string | null
          cashier_name?: string | null
          created_at?: string
          customer_id?: string | null
          customer_segment?: string | null
          discount_amount?: number
          draft_payload?: Json | null
          id?: string
          invoice_number?: string | null
          invoice_status?: string
          location_id: string
          order_type?: string | null
          paid_amount?: number
          payment_status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          balance_amount?: number
          business_date?: string
          cashier_id?: string | null
          cashier_name?: string | null
          created_at?: string
          customer_id?: string | null
          customer_segment?: string | null
          discount_amount?: number
          draft_payload?: Json | null
          id?: string
          invoice_number?: string | null
          invoice_status?: string
          location_id?: string
          order_type?: string | null
          paid_amount?: number
          payment_status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_cashier_id_app_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          type: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          type?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          type?: string
        }
        Relationships: []
      }
      offline_sync_operations: {
        Row: {
          accepted_at: string
          created_at: string
          device_id: string
          operation_id: string
          operation_type: string
          outlet_id: string | null
          payload: Json
          sync_message: string | null
          sync_status: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          created_at: string
          device_id: string
          operation_id: string
          operation_type: string
          outlet_id?: string | null
          payload: Json
          sync_message?: string | null
          sync_status?: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          device_id?: string
          operation_id?: string
          operation_type?: string
          outlet_id?: string | null
          payload?: Json
          sync_message?: string | null
          sync_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_sync_operations_user_id_app_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          change_given: number | null
          change_denominations: Json | null
          created_at: string
          customer_id: string | null
          id: string
          invoice_id: string
          mode: string
          tendered: number | null
        }
        Insert: {
          amount: number
          change_given?: number | null
          change_denominations?: Json | null
          created_at?: string
          customer_id?: string | null
          id?: string
          invoice_id: string
          mode?: string
          tendered?: number | null
        }
        Update: {
          amount?: number
          change_given?: number | null
          change_denominations?: Json | null
          created_at?: string
          customer_id?: string | null
          id?: string
          invoice_id?: string
          mode?: string
          tendered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          barcode: string | null
          barcode_type: string | null
          category: string | null
          subcategory: string | null
          conversion_factor: number
          created_at: string
          enrichment_status: string
          hsn: string | null
          id: string
          is_loose: boolean
          is_active: boolean
          min_sale_price: number
          min_stock: number
          mrp: number
          name: string
          name_hi: string | null
          quantity_precision: number
          preferred_supplier: string | null
          price_tiers: Json
          purchase_cost: number
          rack_location: string | null
          review_reason: string | null
          review_status: string
          sale_price: number
          search_aliases: string[]
          sku: string | null
          uom_purchase: string
          uom_sale: string
          uom_stock: string
          variant: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          barcode?: string | null
          barcode_type?: string | null
          category?: string | null
          subcategory?: string | null
          conversion_factor?: number
          created_at?: string
          enrichment_status?: string
          hsn?: string | null
          id?: string
          is_loose?: boolean
          is_active?: boolean
          min_sale_price?: number
          min_stock?: number
          mrp?: number
          name: string
          name_hi?: string | null
          quantity_precision?: number
          preferred_supplier?: string | null
          price_tiers?: Json
          purchase_cost?: number
          rack_location?: string | null
          review_reason?: string | null
          review_status?: string
          sale_price?: number
          search_aliases?: string[]
          sku?: string | null
          uom_purchase?: string
          uom_sale?: string
          uom_stock?: string
          variant?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          barcode?: string | null
          barcode_type?: string | null
          category?: string | null
          subcategory?: string | null
          conversion_factor?: number
          created_at?: string
          enrichment_status?: string
          hsn?: string | null
          id?: string
          is_loose?: boolean
          is_active?: boolean
          min_sale_price?: number
          min_stock?: number
          mrp?: number
          name?: string
          name_hi?: string | null
          quantity_precision?: number
          preferred_supplier?: string | null
          price_tiers?: Json
          purchase_cost?: number
          rack_location?: string | null
          review_reason?: string | null
          review_status?: string
          sale_price?: number
          search_aliases?: string[]
          sku?: string | null
          uom_purchase?: string
          uom_sale?: string
          uom_stock?: string
          variant?: string | null
        }
        Relationships: []
      }
      purchase_receipt_items: {
        Row: {
          id: string
          product_id: string
          quantity: number
          receipt_id: string
          source_total: number | null
          unit_cost: number
        }
        Insert: {
          id: string
          product_id: string
          quantity: number
          receipt_id: string
          source_total?: number | null
          unit_cost?: number
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          receipt_id?: string
          source_total?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          attachment_path: string | null
          created_at: string
          id: string
          invoice_date: string
          ocr_text: string | null
          received_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          source_total: number | null
          supplier_invoice_number: string
          supplier_name: string
          warehouse_location_id: string
        }
        Insert: {
          attachment_path?: string | null
          created_at?: string
          id: string
          invoice_date: string
          ocr_text?: string | null
          received_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status: string
          source_total?: number | null
          supplier_invoice_number: string
          supplier_name: string
          warehouse_location_id: string
        }
        Update: {
          attachment_path?: string | null
          created_at?: string
          id?: string
          invoice_date?: string
          ocr_text?: string | null
          received_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          source_total?: number | null
          supplier_invoice_number?: string
          supplier_name?: string
          warehouse_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_reviewed_by_app_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "purchase_receipts_warehouse_location_id_fkey"
            columns: ["warehouse_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_import_batches: {
        Row: {
          batch_key: string
          committed_at: string
          id: string
          imported_by: string
          location_mapping: Json
          source_file_name: string
          summary: Json
        }
        Insert: {
          batch_key: string
          committed_at?: string
          id?: string
          imported_by: string
          location_mapping: Json
          source_file_name: string
          summary?: Json
        }
        Update: {
          batch_key?: string
          committed_at?: string
          id?: string
          imported_by?: string
          location_mapping?: Json
          source_file_name?: string
          summary?: Json
        }
        Relationships: []
      }
      retail_import_source_rows: {
        Row: {
          batch_id: string
          entity_id: string
          entity_type: string
          id: string
          sheet_name: string
          source_key: string
          source_payload: Json
          source_row_number: number
        }
        Insert: {
          batch_id: string
          entity_id: string
          entity_type: string
          id?: string
          sheet_name: string
          source_key: string
          source_payload: Json
          source_row_number: number
        }
        Update: {
          batch_id?: string
          entity_id?: string
          entity_type?: string
          id?: string
          sheet_name?: string
          source_key?: string
          source_payload?: Json
          source_row_number?: number
        }
        Relationships: []
      }
      staff_location_access: {
        Row: {
          location_id: string
          user_id: string
        }
        Insert: {
          location_id: string
          user_id: string
        }
        Update: {
          location_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_location_access_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_location_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          cost_loss: number
          created_by: string | null
          created_at: string
          id: string
          import_batch_id: string | null
          location_id: string
          product_id: string
          quantity: number
          reason: string
          returnable_to_vendor: boolean
        }
        Insert: {
          cost_loss?: number
          created_by?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          location_id: string
          product_id: string
          quantity: number
          reason?: string
          returnable_to_vendor?: boolean
        }
        Update: {
          cost_loss?: number
          created_by?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          location_id?: string
          product_id?: string
          quantity?: number
          reason?: string
          returnable_to_vendor?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          id: string
          location_id: string
          movement_type: string
          product_id: string
          quantity_delta: number
          quantity_on_hand: number
          reference: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          movement_type?: string
          product_id: string
          quantity_delta: number
          quantity_on_hand: number
          reference?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          movement_type?: string
          product_id?: string
          quantity_delta?: number
          quantity_on_hand?: number
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          id: string
          product_id: string
          quantity: number
          transfer_id: string
        }
        Insert: {
          id?: string
          product_id: string
          quantity?: number
          transfer_id: string
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string
          from_location_id: string
          id: string
          notes: string | null
          status: string
          to_location_id: string
        }
        Insert: {
          created_at?: string
          from_location_id: string
          id?: string
          notes?: string | null
          status?: string
          to_location_id: string
        }
        Update: {
          created_at?: string
          from_location_id?: string
          id?: string
          notes?: string | null
          status?: string
          to_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string
          email: string | null
          is_active: boolean
          must_change_password: boolean
          phone: string | null
          role: string
          updated_at: string
          username: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email?: string | null
          is_active?: boolean
          must_change_password?: boolean
          phone?: string | null
          role: string
          updated_at?: string
          username?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string | null
          is_active?: boolean
          must_change_password?: boolean
          phone?: string | null
          role?: string
          updated_at?: string
          username?: string
          user_id?: string
        }
        Relationships: []
      }
      location_product_assignments: {
        Row: {
          created_at: string
          id: string
          location_id: string
          product_id: string
          review_reason: string | null
          review_status: string
          stock_count_status: string
        }
        Insert: {
          created_at?: string
          id: string
          location_id: string
          product_id: string
          review_reason?: string | null
          review_status?: string
          stock_count_status?: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          product_id?: string
          review_reason?: string | null
          review_status?: string
          stock_count_status?: string
        }
        Relationships: []
      }
      uncounted_sales: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          location_id: string
          product_id: string
          quantity: number
          recorded_by: string | null
        }
        Insert: {
          created_at?: string
          id: string
          invoice_id: string
          location_id: string
          product_id: string
          quantity: number
          recorded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          location_id?: string
          product_id?: string
          quantity?: number
          recorded_by?: string | null
        }
        Relationships: []
      }
      barcode_candidates: {
        Row: {
          code: string
          created_at: string
          id: string
          location_id: string
          product_id: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          id: string
          location_id: string
          product_id: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          location_id?: string
          product_id?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      category_reviews: {
        Row: {
          created_at: string
          id: string
          kind: string
          location_id: string
          name: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          location_id: string
          name: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          location_id?: string
          name?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_import_retailflow_workbook_batch: {
        Args: {
          p_actor_user_id: string
          p_batch_key: string
          p_location_mapping: Json
          p_payload: Json
          p_source_file_name: string
          p_summary: Json
        }
        Returns: Json
      }
      app_override_cash_session_close: {
        Args: {
          p_closing_denominations: Json
          p_counted_cash: number
          p_manager_user_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: undefined
      }
      app_resolve_inventory_sync_alert: {
        Args: { p_actor_user_id: string; p_alert_id: string }
        Returns: undefined
      }
      app_review_barcode_candidate: {
        Args: {
          p_actor_user_id: string
          p_barcode_type: string
          p_candidate_id: string
          p_reason: string
          p_status: string
        }
        Returns: undefined
      }
      app_assign_product_barcode: {
        Args: {
          p_actor_user_id: string
          p_barcode_type: string
          p_code: string
          p_location_id: string
          p_product_id: string
        }
        Returns: undefined
      }
      app_archive_product_as_admin: {
        Args: { p_actor_user_id: string; p_product_id: string; p_reason: string }
        Returns: undefined
      }
      app_update_own_username: {
        Args: { p_actor_user_id: string; p_username: string }
        Returns: string
      }
      app_save_staff_profile: {
        Args: {
          p_actor_user_id: string
          p_display_name: string
          p_email: string | null
          p_is_active: boolean
          p_location_ids: string[]
          p_must_change_password: boolean
          p_phone: string | null
          p_role: string
          p_user_id: string
        }
        Returns: undefined
      }
      app_set_product_price_tiers: {
        Args: {
          p_actor_user_id: string
          p_price_tiers: Json
          p_product_id: string
        }
        Returns: undefined
      }
      app_sync_offline_operation_as_staff: {
        Args: {
          p_actor_user_id: string
          p_device_id: string
          p_operation_id: string
          p_operation_type: string
          p_outlet_id: string | null
          p_payload: Json
        }
        Returns: Json
      }
      can_access_location: { Args: { p_location_id: string }; Returns: boolean }
      can_manage_retail_data: { Args: never; Returns: boolean }
      current_staff_role: { Args: never; Returns: string }
      resolve_inventory_sync_alert: {
        Args: { p_alert_id: string }
        Returns: undefined
      }
      set_product_price_tiers: {
        Args: { p_price_tiers: Json; p_product_id: string }
        Returns: undefined
      }
      sync_offline_operation: {
        Args: {
          p_device_id: string
          p_operation_id: string
          p_operation_type: string
          p_outlet_id: string | null
          p_payload: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
