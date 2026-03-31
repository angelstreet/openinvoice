export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

export interface ExtractedFields {
  supplier: string | null;
  client: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  line_items: LineItem[];
}

export interface ExtractionResult {
  filename: string;
  pages: number;
  raw_text: string;
  confidence: number;
  fields: ExtractedFields;
  warnings: string[];
}

export interface LogEntry {
  step: string;
  message: string;
  elapsed: number;
}

export interface DocumentListItem {
  id: string;
  filename: string;
  file_size: number;
  content_type: string;
  uploaded_at: string;
  status: string;
  confidence: number | null;
  extracted_fields: ExtractedFields | null;
  warnings: string[];
  user_id: string | null;
  source: string;
}

export interface DocumentListResponse {
  items: DocumentListItem[];
  total: number;
  page: number;
  pages: number;
}

export interface DashboardStats {
  total_documents: number;
  success_count: number;
  error_count: number;
  success_rate: number;
  avg_confidence: number;
  total_amount: number;
  invoices_per_month: { month: string; count: number }[];
  supplier_distribution: { name: string; count: number; total_amount: number }[];
  amounts_per_month: { month: string; amount: number }[];
  top_suppliers: { name: string; count: number; total_amount: number }[];
  unique_suppliers: number;
}
