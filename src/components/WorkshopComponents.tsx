import { ReactNode } from "react";
import { cn } from "../lib/utils";

interface FieldProps {
  label: string;
  value: number | string;
  onChange: (val: any) => void;
  type?: string;
  unit?: string;
  step?: string;
  min?: string;
}

export function WorkshopField({ label, value, onChange, type = "number", unit, step, min }: FieldProps) {
  return (
    <div className="space-y-1.5 group">
      <label className="eyebrow-label text-text-secondary group-focus-within:text-gold-500 transition-colors">
        {label}
      </label>
      <div className="relative">
        <input 
          type={type} 
          value={value} 
          step={step}
          min={min}
          onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
          className="w-full bg-bg-base border border-white/10 rounded-xl p-3.5 pr-24 text-white font-mono text-lg focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/20 outline-none transition-all appearance-none"
        />
        {unit && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-text-secondary uppercase tracking-wide pointer-events-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

interface ResultProps {
  label: string;
  value: string | number;
  unit?: string;
  variant?: "gold" | "red" | "blue" | "green";
  subResults?: { label: string; value: string | number; unit?: string }[];
}

export function WorkshopResult({ label, value, unit, variant = "gold", subResults }: ResultProps) {
  const variants = {
    gold: "border-gold-500/20 bg-gold-500/5 text-gold-500",
    red: "border-red-500/20 bg-red-500/5 text-red-500",
    blue: "border-blue-500/20 bg-blue-500/5 text-blue-500",
    green: "border-green-500/20 bg-green-500/5 text-green-500",
  };

  return (
    <div className={cn("card-soft card-elevated rounded-3xl p-6 space-y-4 relative overflow-hidden", variants[variant])}>
      {/* Background patterns */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-current opacity-[0.03] rounded-full blur-2xl -mr-12 -mt-12" />
      
      <div className="space-y-1 text-center relative z-10">
        <p className="eyebrow-label opacity-80">{label}</p>
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="text-4xl font-black tracking-tight font-sans text-white">{value}</span>
          {unit && <span className="text-sm font-bold opacity-60 uppercase">{unit}</span>}
        </div>
      </div>

      {subResults && subResults.length > 0 && (
        <div className="grid grid-cols-1 gap-2 border-t border-current/10 pt-4 relative z-10">
          {subResults.map((res, i) => (
            <div key={i} className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wide">
              <span className="opacity-60">{res.label}</span>
              <span className="text-white">{res.value} {res.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkshopCard({ children, title, icon: Icon, description }: { children: ReactNode; title: string; icon: any; description: string }) {
  return (
    <div className="card-soft card-elevated rounded-[32px] p-6 space-y-8 shadow-2xl relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-gold-500" />
            <h3 className="text-lg font-black text-white uppercase tracking-tight">{title}</h3>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed max-w-[240px]">{description}</p>
        </div>
        <div className="w-12 h-12 bg-gold-500/5 rounded-2xl flex items-center justify-center border border-gold-500/10">
          <Icon className="w-6 h-6 text-gold-500/40" />
        </div>
      </div>
      
      <div className="space-y-8">
        {children}
      </div>
    </div>
  );
}
