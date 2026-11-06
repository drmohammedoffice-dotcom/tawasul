export type ApiResponse<T> = {
  success: true;
  message: string;
  data: T;
};

export function ok<T>(message: string, data: T): ApiResponse<T> {
  return { success: true, message, data };
}
