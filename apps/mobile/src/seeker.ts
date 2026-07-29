import { Platform } from 'react-native';

import { isSeekerModelHint } from './seeker-model';

export function hasSeekerDeviceHint(): boolean {
  return isSeekerModelHint(
    Platform.OS,
    Platform.constants as unknown as Readonly<Record<string, unknown>>,
  );
}
