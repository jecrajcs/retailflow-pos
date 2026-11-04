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
          closing_cash: number | null
          id: string
          location_id: string
          opened_at: string
          opened_by: string
          opening_cash: number
          status: string
        }
        Insert: {
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          closed_at?: string | null
          closing_cash?: number | null
          id?: string
          location_id: string
          opened_at?: string
          opened_by?: string
          opening_cash?: number
          status?: string
        }
        Update: {
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          closed_at?: string | null
          closing_cash?: number | null
          id?: string
          location_id?: string
          opened_at?: string
          opened_by?: string
          opening_cash?: number
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
      customers: {
        Row: {
          age_group: string | null
          created_at: string
          credit_limit: number
          gender: string | null
          id: string
          mobile: string | null
          name: string
          notes: string | null
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
          name: string
          notes?: string | null
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
          name?: string
          notes?: string | null
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
          created_at: string
          customer_id: string | null
          discount_amount: number
          id: string
          invoice_number: string | null
          location_id: string
          paid_amount: number
          payment_status: string
          total_amount: number
        }
        Insert: {
          balance_amount?: number
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          id?: string
          invoice_number?: string | null
          location_id: string
          paid_amount?: number
          payment_status?: string
          total_amount?: number
        }
        Update: {
          balance_amount?: number
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          id?: string
          invoice_number?: string | null
          location_id?: string
          paid_amount?: number
          payment_status?: string
          total_amount?: number
        }
        Relationships: [
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
      payments: {
        Row: {
          amount: number
          change_given: number | null
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
          barcode: string | null
          category: string | null
          conversion_factor: number
          created_at: string
          enrichment_status: string
          hsn: string | null
          id: string
          is_loose: boolean
          min_sale_price: number
          min_stock: number
          mrp: number
          name: string
          purchase_cost: number
          rack_location: string | null
          sale_price: number
          sku: string | null
          uom_purchase: string
          uom_sale: string
          uom_stock: string
          variant: string | null
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          conversion_factor?: number
          created_at?: string
          enrichment_status?: string
          hsn?: string | null
          id?: string
          is_loose?: boolean
          min_sale_price?: number
          min_stock?: number
          mrp?: number
          name: string
          purchase_cost?: number
          rack_location?: string | null
          sale_price?: number
          sku?: string | null
          uom_purchase?: string
          uom_sale?: string
          uom_stock?: string
          variant?: string | null
        }
        Update: {
          barcode?: string | null
          category?: string | null
          conversion_factor?: number
          created_at?: string
          enrichment_status?: string
          hsn?: string | null
          id?: string
          is_loose?: boolean
          min_sale_price?: number
          min_stock?: number
          mrp?: number
          name?: string
          purchase_cost?: number
          rack_location?: string | null
          sale_price?: number
          sku?: string | null
          uom_purchase?: string
          uom_sale?: string
          uom_stock?: string
          variant?: string | null
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          cost_loss: number
          created_at: string
          id: string
          location_id: string
          product_id: string
          quantity: number
          reason: string
          returnable_to_vendor: boolean
        }
        Insert: {
          cost_loss?: number
          created_at?: string
          id?: string
          location_id: string
          product_id: string
          quantity: number
          reason?: string
          returnable_to_vendor?: boolean
        }
        Update: {
          cost_loss?: number
          created_at?: string
          id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_payment: {
        Args: { p_amount: number; p_invoice_id: string; p_mode: string }
        Returns: undefined
      }
      close_cash_session: {
        Args: {
          p_cash_in: number
          p_cash_out: number
          p_counted_cash: number
          p_session_id: string
        }
        Returns: Json
      }
      create_pos_invoice: {
        Args: {
          p_customer_id: string
          p_discount: number
          p_items: Json
          p_location_id: string
          p_payments: Json
        }
        Returns: Json
      }
      create_stock_adjustment: {
        Args: {
          p_location_id: string
          p_product_id: string
          p_quantity: number
          p_reason: string
          p_returnable: boolean
        }
        Returns: string
      }
      log_cash_txn: {
        Args: {
          p_amount: number
          p_direction: string
          p_location_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: string
      }
      open_cash_session: {
        Args: {
          p_location_id: string
          p_opened_by: string
          p_opening_cash: number
        }
        Returns: string
      }
      receive_stock_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
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
