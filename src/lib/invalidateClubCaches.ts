import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/** Osvežava TanStack keševe koji zavise od liste klubova posetioca (Meni, Početna, Moji klubovi). */
export function invalidateVisitorClubCaches(queryClient: QueryClient, visitorId: string | null) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.myClubs.scope() });
  if (visitorId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.menu.joinedClubs(visitorId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.home.clubs(visitorId) });
  }
}

/** Posle join/leave na destileriji ili iz „Moji klubovi“ — visitor liste + javni broj članova i membership keš za tu destileriju. */
export function invalidateAfterClubMembershipChange(
  queryClient: QueryClient,
  visitorId: string | null,
  distilleryId: string,
) {
  invalidateVisitorClubCaches(queryClient, visitorId);
  void queryClient.invalidateQueries({ queryKey: queryKeys.distillery.memberCount(distilleryId) });
  if (visitorId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.distillery.membership(distilleryId, visitorId) });
  }
}
