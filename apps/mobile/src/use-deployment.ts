import { useEffect, useState } from 'react';

import { verifySolanaDeployment, type SolanaDeploymentVerification } from './deployment';
import type { MobileRuntimeConfig } from './runtime-config';

export type MobileDeploymentState = { readonly kind: 'checking' } | SolanaDeploymentVerification;

export function useSolanaDeployment(config: MobileRuntimeConfig): MobileDeploymentState {
  const [state, setState] = useState<MobileDeploymentState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'checking' });
    void verifySolanaDeployment(config).then((verification) => {
      if (active) setState(verification);
    });
    return () => {
      active = false;
    };
  }, [config]);

  return state;
}
