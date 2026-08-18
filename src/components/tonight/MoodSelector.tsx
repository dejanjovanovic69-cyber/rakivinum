import { cn } from "../../lib/utils";

export type MoodId =
  | "slavlje"
  | "opustanje"
  | "romantika"
  | "drustvo"
  | "samoca"
  | "refleksija"
  | "posle_posla"
  | "proslava";

export const MOOD_OPTIONS: Array<{ id: MoodId; label: string }> = [
  { id: "slavlje", label: "Slavlje" },
  { id: "opustanje", label: "Opuštanje" },
  { id: "romantika", label: "Romantika" },
  { id: "drustvo", label: "Društvo" },
  { id: "samoca", label: "Samoća" },
  { id: "refleksija", label: "Refleksija" },
  { id: "posle_posla", label: "Posle posla" },
  { id: "proslava", label: "Proslava" },
];

type Props = {
  value: MoodId | null;
  onChange: (next: MoodId) => void;
};

export default function MoodSelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {MOOD_OPTIONS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors",
            value === m.id
              ? "border-gold-500/55 bg-gold-500/15 text-gold-300"
              : "border-white/15 bg-white/5 text-text-secondary hover:border-gold-500/35 hover:text-white",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

