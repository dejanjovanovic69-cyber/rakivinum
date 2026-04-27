export type CommunitySection = "reviews" | "tops" | "compare" | "producers" | "search" | "events";

export type RatingItem = {
  id: string;
  productId: string;
  productName?: string;
  productImage?: string;
  rating: number;
  reviewText?: string;
  comment?: string;
  userLocation?: string;
  createdAt?: { seconds?: number; toDate?: () => Date } | string | Date | null;
  isFlagged?: boolean;
};

export type ProductItem = {
  id: string;
  name?: string;
  type?: string;
  category?: string;
  distillery?: string;
  distilleryId?: string;
  image?: string;
  bottleImageUrl?: string;
  averageRating?: number;
  alcoholPercentage?: number;
  _sum?: number;
  _count?: number;
};

export type DistilleryItem = {
  id: string;
  name?: string;
  region?: string;
  logoUrl?: string;
  isVerified?: boolean;
  location?: { city?: string; address?: string } | string;
};

export type CommunityEventItem = {
  id: string;
  eventDate?: string;
  title?: string;
  location?: string;
  description?: string;
  websiteUrl?: string;
  link?: string;
  mapsUrl?: string;
  [key: string]: unknown;
};

export type ComparePersistState = {
  filter?: string;
  leftQuery?: string;
  rightQuery?: string;
  leftId?: string;
  rightId?: string;
};

export type FilterOption = {
  id: string;
  label: string;
};

export type CompareFilterOption = {
  id: string;
  label: string;
};
