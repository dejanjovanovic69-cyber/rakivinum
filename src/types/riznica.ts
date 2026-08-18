import type { Timestamp } from "firebase/firestore";

export type RiznicaCategory =
  | "favoriti"
  | "specijalna-rezerva"
  | "za-poklon"
  | "probano"
  | null;

export interface RiznicaItem {
  drinkId: string;
  addedAt: Timestamp;
  category: RiznicaCategory;
  userRating: number | null;
  notes: string;
  purchasePrice: number | null;
  purchaseDate: Timestamp | null;
  shelf?: string;
  position?: number;
}

export interface RiznicaStats {
  totalDrinks: number;
  avgRating: number | null;
  topType: string | null;
  oldestYear: number | null;
  totalValue: number;
}

export interface RiznicaPrivacySettings {
  riznicaPublic: boolean;
  riznicaPublicNotes: boolean;
  riznicaLastSharedAt: Timestamp | null;
}
