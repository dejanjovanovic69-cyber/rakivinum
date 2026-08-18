import { cn } from "../../lib/utils";

export type FoodId =
  | "rostilj"
  | "pecenje"
  | "sir_suhomesnato"
  | "riba"
  | "dezert"
  | "pikantno"
  | "nista_posebno"
  | "kafana";

export const FOOD_OPTIONS: Array<{ id: FoodId; label: string }> = [
  { id: "rostilj", label: "Roštilj" },
  { id: "pecenje", label: "Pečenje" },
  { id: "sir_suhomesnato", label: "Sir & suhomesnato" },
  { id: "riba", label: "Riba / morski plodovi" },
  { id: "dezert", label: "Dezert" },
  { id: "pikantno", label: "Pikantno" },
  { id: "nista_posebno", label: "Ništa posebno" },
  { id: "kafana", label: "Kafana stil" },
];

type Props = {
  value: FoodId | null;
  onChange: (next: FoodId) => void;
};

export default function FoodSelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {FOOD_OPTIONS.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors",
            value === f.id
              ? "border-gold-500/55 bg-gold-500/15 text-gold-300"
              : "border-white/15 bg-white/5 text-text-secondary hover:border-gold-500/35 hover:text-white",
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

