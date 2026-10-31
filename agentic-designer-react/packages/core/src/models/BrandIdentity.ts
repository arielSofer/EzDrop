// Ported 1:1 from AgenticDesigner/Services/BrandKit.swift (type definition only;
// BrandKit's apply/normalize/shade behaviour is ported with the services layer).

export interface BrandIdentity {
  /** hex, e.g. "#F0653C" */
  accent: string;
  accentSecondary?: string;
  name?: string;
}

/** `BrandIdentity.none` */
export const BrandIdentityNone: Readonly<BrandIdentity> = Object.freeze({ accent: '' });

export function makeBrandIdentity(init: Partial<BrandIdentity> & { accent: string }): BrandIdentity {
  const b: BrandIdentity = { accent: init.accent };
  if (init.accentSecondary !== undefined) b.accentSecondary = init.accentSecondary;
  if (init.name !== undefined) b.name = init.name;
  return b;
}

/** `BrandIdentity.isSet` */
export function brandIdentityIsSet(brand: BrandIdentity): boolean {
  return brand.accent.startsWith('#') && brand.accent.length >= 7;
}
