export interface POP {
  pop: string;
  hash: string;
  response_time: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}