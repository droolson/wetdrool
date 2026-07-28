import type { ComposerDraft } from './composer-draft';
import type { DevicePreferences } from './local-preferences';

export const LOCAL_EXPORT_FORMAT = 'wokesocial-device-export/v1';

export interface LocalDeviceExport {
  data: {
    composerDraft: ComposerDraft | null;
    devicePreferences: DevicePreferences;
  };
  exportedAt: string;
  format: typeof LOCAL_EXPORT_FORMAT;
  notice: string;
}

export function createLocalDeviceExport(
  devicePreferences: DevicePreferences,
  composerDraft: ComposerDraft | null,
  exportedAt = new Date(),
): LocalDeviceExport {
  return {
    data: {
      composerDraft,
      devicePreferences,
    },
    exportedAt: exportedAt.toISOString(),
    format: LOCAL_EXPORT_FORMAT,
    notice:
      'This file contains only settings and draft data stored by this browser. It is not a protocol account export.',
  };
}

export function serializeLocalDeviceExport(value: LocalDeviceExport): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
