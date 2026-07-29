export function isSeekerModelHint(
  operatingSystem: string,
  constants: Readonly<Record<string, unknown>>,
): boolean {
  return operatingSystem === 'android' && constants.Model === 'Seeker';
}
