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
  siret: string | null;
  vat_number: string | null;
  client_number: string | null;
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
  pipeline_meta: PipelineMeta | null;
  corrected_fields: Record<string, string | number | null> | null;
  human_feedback: Feedback | null;
  ai_feedback: Feedback | null;
}

export interface PipelineStep {
  name: string;
  duration: number;
  fields_found?: number;
  templates_checked?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  success?: boolean;
}

export interface PipelineMeta {
  method: string;
  text_method?: string;
  llm_model: string;
  llm_input_tokens: number;
  llm_output_tokens: number;
  templates_checked: number;
  steps: PipelineStep[];
  total_duration?: number;
}

export interface Feedback {
  verdict: 'OK' | 'NOK';
  comment: string;
  generated_at?: string;
  submitted_at?: string;
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
