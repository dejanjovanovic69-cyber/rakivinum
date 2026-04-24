const DEFAULT_SUPERUSER_EMAILS = ["ldjs1969@gmail.com"];

const parseConfiguredSuperusers = () => {
  const raw = import.meta.env.VITE_SUPERUSER_EMAILS as string | undefined;
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
};

const SUPERUSER_EMAILS = new Set([
  ...DEFAULT_SUPERUSER_EMAILS.map((email) => email.toLowerCase()),
  ...parseConfiguredSuperusers(),
]);

export const isSuperuserEmail = (email?: string | null) =>
  !!email && SUPERUSER_EMAILS.has(email.toLowerCase());
