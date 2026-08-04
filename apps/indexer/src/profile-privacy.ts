import {
  legacyProfileContentSchema,
  profileContentSchema,
  type LegacyProfileContent,
  type ProfileContent,
} from '@wetdrool/protocol';

export type ProfileManifestSchemaVersion = 1 | 2;

/**
 * Public indexers retain only profile values with explicit public visibility.
 * Authorized clients can resolve protected references from the verified source
 * manifest without turning those references into a public projection.
 */
export function projectPublicProfileContent(
  schemaVersion: ProfileManifestSchemaVersion,
  content: unknown,
): ProfileContent {
  if (schemaVersion === 1) {
    return projectLegacyProfile(legacyProfileContentSchema.parse(content));
  }

  const current = profileContentSchema.parse(content);
  const { gender, location, ...publicFields } = current;

  return profileContentSchema.parse({
    ...publicFields,
    pronouns: current.pronouns.filter((entry) => entry.visibility === 'public'),
    chosenFamilyLabels: current.chosenFamilyLabels.filter((entry) => entry.visibility === 'public'),
    ...(gender?.visibility === 'public' ? { gender } : {}),
    ...(location?.visibility === 'public' ? { location } : {}),
  });
}

function projectLegacyProfile(content: LegacyProfileContent): ProfileContent {
  // The frozen v1 schema gave chosen-family labels and location no visibility
  // marker. Do not retroactively infer public consent for those plaintext
  // values. Gender and pronouns survive only when v1 explicitly marked them
  // public, and are normalized into the protected v2 public-value shape.
  return profileContentSchema.parse({
    displayName: content.displayName,
    bio: content.bio,
    ...(content.avatar === undefined ? {} : { avatar: content.avatar }),
    ...(content.banner === undefined ? {} : { banner: content.banner }),
    pronouns: content.pronouns.filter((entry) => entry.visibility === 'public'),
    chosenFamilyLabels: [],
    ...(content.gender !== undefined && content.genderVisibility === 'public'
      ? { gender: { visibility: 'public' as const, value: content.gender } }
      : {}),
    ...(content.website === undefined ? {} : { website: content.website }),
    links: content.links,
  });
}
