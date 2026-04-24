import { useCallback, useState } from "react";
import { Wine } from "lucide-react";

const STORAGE_KEY = "rakivinum_age_18_confirmed";

export function hasAgeGateConsent(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

type Props = {
  onConfirmed: () => void;
};

/**
 * Blokira aplikaciju dok korisnik ne potvrdi da ima 18+ godina (sajt o alkoholu).
 */
export default function AgeGate({ onConfirmed }: Props) {
  const [declined, setDeclined] = useState(false);

  const confirm = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // privatni režim / blokiran storage — ipak pusti sesiju
    }
    onConfirmed();
  }, [onConfirmed]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex min-h-[100dvh] items-center justify-center bg-bg-base/95 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      aria-describedby="age-gate-desc"
    >
      <div className="card-soft card-elevated w-full max-w-md rounded-3xl border border-gold-500/30 p-6 shadow-[0_0_60px_rgba(212,175,55,0.12)]">
        <div className="mb-5 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gold-500/25 bg-gold-500/10">
            <Wine className="h-8 w-8 text-gold-500" aria-hidden />
          </div>
        </div>

        <h1
          id="age-gate-title"
          className="text-center text-xl font-black uppercase italic tracking-wide text-white"
        >
          Potvrda starosti
        </h1>
        <p
          id="age-gate-desc"
          className="mt-3 text-center text-sm leading-relaxed text-text-secondary"
        >
          Ovaj sajt sadrži informacije o alkoholnim pićima. Ulaz je dozvoljen samo osobama koje imaju{" "}
          <span className="font-bold text-gold-500">najmanje 18 godina</span>.
        </p>
        <p className="mt-2 text-center text-xs text-text-secondary/80">
          Nastavkom potvrđujete da ste punoletni u skladu sa zakonima vaše zemlje.
        </p>

        {declined ? (
          <div className="empty-state mt-6 rounded-2xl p-5 text-center text-sm text-text-secondary leading-relaxed">
            Bez potvrde starosti ne možete koristiti sajt. Ako ste punoletni, izaberite „Da“.
            <button
              type="button"
              onClick={() => setDeclined(false)}
              className="mt-4 w-full py-3 btn-tertiary text-xs"
            >
              Nazad
            </button>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-row-reverse">
            <button type="button" onClick={confirm} className="flex-1 py-3.5 btn-primary text-sm">
              Da, imam 18+
            </button>
            <button type="button" onClick={() => setDeclined(true)} className="flex-1 py-3.5 btn-tertiary text-sm font-bold">
              Ne
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
