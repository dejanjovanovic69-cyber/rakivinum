export function buildStableVisitorSeed(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "na";
  const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const parts = [
    nav.userAgent || "ua",
    nav.language || "lang",
    nav.platform || "platform",
    tz,
  ];
  return parts.join("|");
}

function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function getStableVisitorId(): string {
  return `v_${simpleHash(buildStableVisitorSeed())}`;
}

export function getOrCreateVisitorId(): string {
  const existing = localStorage.getItem("rakivinum_visitor_id");
  if (existing && existing.trim()) return existing.trim();
  const stable = getStableVisitorId();
  localStorage.setItem("rakivinum_visitor_id", stable);
  return stable;
}

