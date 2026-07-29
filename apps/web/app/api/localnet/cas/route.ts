import { handleLocalCasWriteRequest } from '../../../../lib/local-cas-route';

export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return handleLocalCasWriteRequest(request);
}
