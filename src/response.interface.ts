export interface GeneralResponse {
  version: string;
  success: boolean;
  data: unknown;
  // string[]: the record mutations' step log (D10).
  message: string | string[] | null;
  error: string | object | null;
}
