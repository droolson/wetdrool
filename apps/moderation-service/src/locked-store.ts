import { ModerationServiceError } from './errors.js';
import type { ModerationStore } from './store.js';

export class LockedModerationStore implements ModerationStore {
  readonly kind = 'locked';

  put(): never {
    return locked();
  }

  get(): never {
    return locked();
  }

  activeLabels(): never {
    return locked();
  }

  getCase(): never {
    return locked();
  }

  getCaseSnapshot(): never {
    return locked();
  }

  getCaseLedger(): never {
    return locked();
  }

  transitionCase(): never {
    return locked();
  }

  applyAction(): never {
    return locked();
  }

  reviewAction(): never {
    return locked();
  }

  setLegalHold(): never {
    return locked();
  }

  recordAccess(): never {
    return locked();
  }

  runMaintenance(): never {
    return locked();
  }

  transparency(): never {
    return locked();
  }

  readiness(): never {
    return locked();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function locked(): never {
  throw new ModerationServiceError(
    'Moderation persistence is locked until PostgreSQL and a data-key ring are configured.',
    'locked',
  );
}
