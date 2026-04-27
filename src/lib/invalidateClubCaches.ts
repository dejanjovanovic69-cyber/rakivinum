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
