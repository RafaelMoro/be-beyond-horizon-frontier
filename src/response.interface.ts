export interface GeneralResponse {
  version: string;
  success: boolean;
  data: unknown;
  message: string | null;
  error: string | object | null;
}
