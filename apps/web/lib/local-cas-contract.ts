export const LOCAL_CAS_ROUTE = '/api/localnet/cas';
export const LOCAL_CAS_CONTENT_TYPE = 'application/vnd.wokesocial.signed-envelope+json';
export const LOCAL_CAS_EXPECTED_CID_HEADER = 'x-wokesocial-content-cid';
export const LOCAL_CAS_RECEIPT_SCHEMA = 'wokesocial.local-cas-receipt.v1';

export interface LocalCasReceipt {
  readonly byteLength: number;
  readonly cid: string;
  readonly locator: string;
  readonly policy: {
    readonly permanence: 'deletion-compatible';
  };
  readonly provider: 'local-filesystem';
  readonly providerVersion: '1';
  readonly schema: typeof LOCAL_CAS_RECEIPT_SCHEMA;
  readonly verified: true;
}

export interface LocalCasWriteResult {
  readonly outcome: 'already-present' | 'stored';
  readonly receipt: LocalCasReceipt;
}
