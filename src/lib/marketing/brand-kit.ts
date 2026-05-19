import type { Prisma } from "@prisma/client";

export type BrandKit = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontStyle: string;
  slogan: string;
  disclaimer: string;
};

export const DEFAULT_BRAND_KIT: BrandKit = {
  primaryColor: "#1f3a5f",
  secondaryColor: "#f5f7fb",
  accentColor: "#c9a84c",
  fontStyle: "Modern editorial",
  slogan: "",
  disclaimer:
    "Information deemed reliable but not guaranteed. Equal Housing Opportunity.",
};

export function parseBrandKit(raw: unknown): BrandKit {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    primaryColor: stringOr(obj.primaryColor, DEFAULT_BRAND_KIT.primaryColor),
    secondaryColor: stringOr(obj.secondaryColor, DEFAULT_BRAND_KIT.secondaryColor),
    accentColor: stringOr(obj.accentColor, DEFAULT_BRAND_KIT.accentColor),
    fontStyle: stringOr(obj.fontStyle, DEFAULT_BRAND_KIT.fontStyle),
    slogan: stringOr(obj.slogan, DEFAULT_BRAND_KIT.slogan),
    disclaimer: stringOr(obj.disclaimer, DEFAULT_BRAND_KIT.disclaimer),
  };
}

export function brandKitToJson(brandKit: BrandKit): Prisma.InputJsonValue {
  return {
    primaryColor: brandKit.primaryColor,
    secondaryColor: brandKit.secondaryColor,
    accentColor: brandKit.accentColor,
    fontStyle: brandKit.fontStyle,
    slogan: brandKit.slogan,
    disclaimer: brandKit.disclaimer,
  };
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
