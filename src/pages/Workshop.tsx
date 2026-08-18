import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { 
  Droplet, 
  Flame, 
  Beaker, 
  Scale, 
  ThermometerSun, 
  Cylinder, 
  History, 
  Trash2, 
  Save,
  ArrowLeft,
  ChevronRight,
  Calculator,
  Info,
  Wine,
  GlassWater,
  FlaskConical
} from "lucide-react";
import { cn } from "../lib/utils";
import { WorkshopField, WorkshopResult, WorkshopCard } from "../components/WorkshopComponents";
import { isQuotaSaverActive } from "../lib/quotaSaver";

// --- History Logic ---
type HistoryInputs = Record<string, string | number>;
type HistoryEntry = {
  id: number;
  toolLabel: string;
  result: string;
  inputs: HistoryInputs;
  timestamp: string;
};
type ToolSaveHandler = (res: string, inputs: HistoryInputs) => void;

function useWorkshopHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('workshop_history');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const saveToHistory = (toolLabel: string, result: string, inputs: HistoryInputs) => {
    const newItem: HistoryEntry = {
      id: Date.now(),
      toolLabel,
      result,
      inputs,
      timestamp: new Date().toISOString()
    };
    const newHistory = [newItem, ...history].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('workshop_history', JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('workshop_history');
  };

  return { history, saveToHistory, clearHistory };
}

// --- Tool Implementations ---

function Komina({ onSave }: { onSave: ToolSaveHandler }) {
  const [brix, setBrix] = useState(18);
  const babo = brix * 0.85;
  const oechsle = brix * 4.25;
  const alc = brix * 0.55;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <WorkshopField 
        label="Šećer u komini" 
        value={brix} 
        onChange={setBrix} 
        unit="% BRIX" 
        step="0.1" 
      />
      
      <WorkshopResult 
        label="Potencijalni Alkohol" 
        value={alc.toFixed(1)} 
        unit="% VOL" 
        subResults={[
          { label: "Babo mera", value: babo.toFixed(1), unit: "°" },
          { label: "Oechsle mera", value: oechsle.toFixed(0), unit: "°" }
        ]}
      />

      <button 
        onClick={() => onSave(`${alc.toFixed(1)}% alc`, { brix })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-gold-500" /> Sačuvaj proračun
      </button>
    </div>
  );
}

function Razblazivanje({ onSave }: { onSave: ToolSaveHandler }) {
  const [liters, setLiters] = useState(10);
  const [currentPct, setCurrentPct] = useState(65);
  const [targetPct, setTargetPct] = useState(42);
  const [temp, setTemp] = useState(15);
  
  const alcoholAt20 = useMemo(() => {
    // Standard correction: 0.3% per degree deviation from 20C
    return currentPct + (20 - temp) * 0.3;
  }, [currentPct, temp]);

  const waterToAdd = useMemo(() => {
    if (targetPct <= 0 || alcoholAt20 <= targetPct) return 0;
    return liters * (alcoholAt20 / targetPct - 1);
  }, [liters, alcoholAt20, targetPct]);

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 gap-4">
        <WorkshopField label="Količina" value={liters} onChange={setLiters} unit="L" />
        <WorkshopField label="Jačina (Očitana)" value={currentPct} onChange={setCurrentPct} unit="%" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <WorkshopField label="Temperatura" value={temp} onChange={setTemp} unit="°C" />
        <WorkshopField label="Cilj" value={targetPct} onChange={setTargetPct} unit="%" />
      </div>

      <div className="relative pt-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
           <Droplet className="w-4 h-4 text-blue-500 animate-bounce" />
           <div className="w-px h-6 bg-gradient-to-b from-blue-500/50 to-transparent" />
        </div>
        <WorkshopResult 
          label="Dodati destilovane vode" 
          value={waterToAdd.toFixed(2)} 
          unit="L" 
          variant="blue"
          subResults={[
            { label: "Jačina na 20°C", value: alcoholAt20.toFixed(1), unit: "%" }
          ]}
        />
      </div>

      <button 
        onClick={() => onSave(`${waterToAdd.toFixed(2)}L vode`, { liters, currentPct, targetPct, temp })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-blue-500" /> Sačuvaj proračun u dnevnik
      </button>
    </div>
  );
}

function Prvenac({ onSave }: { onSave: ToolSaveHandler }) {
  const [voce, setVoce] = useState("Šljiva (1%)");
  const [meka, setMeka] = useState(100);
  
  const perc = voce.includes("Dunja") ? 0.015 : voce.includes("Ostalo") ? 0.012 : 0.01;
  const odvojiti = meka * perc;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-full overflow-hidden">
       <div className="space-y-1.5 group">
          <label className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] group-focus-within:text-gold-500 transition-colors">
            Tip Voća (Preporučen %)
          </label>
          <div className="relative">
            <select 
              value={voce} 
              onChange={(e) => setVoce(e.target.value)} 
              className="w-full bg-bg-base border border-white/10 rounded-xl p-4 pr-10 text-white font-bold text-sm focus:border-gold-500/50 outline-none appearance-none truncate"
            >
              <option>Šljiva (1%)</option>
              <option>Dunja (1.5%)</option>
              <option>Ostalo (1.2%)</option>
            </select>
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary rotate-90 pointer-events-none" />
          </div>
       </div>
       <WorkshopField label="Meka rakija u kazanu" value={meka} onChange={setMeka} unit="L" />

       <div className="grid grid-cols-1 gap-4">
          <WorkshopResult 
            label="Preporuka odvojiti prvenac" 
            value={odvojiti.toFixed(2)} 
            unit="L" 
            variant="red" 
          />
          
          <div className="bg-red-500/5 border border-red-500/10 p-4 rounded-2xl flex gap-3">
             <div className="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center shrink-0">
                <Info className="w-4 h-4 text-red-500" />
             </div>
             <div className="space-y-1">
                <p className="text-[10px] font-black uppercase text-red-400 tracking-wider">Savet Tehnologa</p>
                <p className="text-[10px] text-white/70 leading-relaxed">Prvenac sadrži visok procenat metil-alkohola. Njegovo precizno odvajanje je ključno za zdravstvenu ispravnost i ukus rakije.</p>
             </div>
          </div>
       </div>

      <button 
        onClick={() => onSave(`${odvojiti.toFixed(2)}L prvenac`, { voce, meka })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-red-500" /> Sačuvaj proračun
      </button>
    </div>
  );
}

function Kvasci({ onSave }: { onSave: ToolSaveHandler }) {
  const [kg, setKg] = useState(100);

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <WorkshopField label="Količina voća" value={kg} onChange={setKg} unit="kg" />
      
      <WorkshopResult 
        label="Potrebni Dodaci" 
        value={((kg/100)*25).toFixed(0)} 
        unit="g" 
        variant="gold"
        subResults={[
          { label: "Enzim", value: ((kg/100)*2).toFixed(1), unit: "g" },
          { label: "Kvasac", value: ((kg/100)*25).toFixed(0), unit: "g" },
          { label: "Hrana za kvasce", value: ((kg/100)*25).toFixed(0), unit: "g" }
        ]}
      />

      <button 
        onClick={() => onSave(`${kg}kg voća - set kvasaca`, { kg })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-gold-500" /> Sačuvaj recepturu
      </button>
    </div>
  );
}

function Patoka({ onSave }: { onSave: ToolSaveHandler }) {
  const [voce, setVoce] = useState("Šljiva");
  const saveti: Record<string, string> = {
    "Šljiva": "40 - 45%",
    "Dunja": "45 - 50%",
    "Jabuka": "42 - 44%",
    "Kruška": "45 - 48%",
    "Kajsija": "45 - 50%"
  };

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
       <div className="space-y-1.5 group">
          <label className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] group-focus-within:text-gold-500 transition-colors">
            Izaberi voće
          </label>
          <div className="relative">
            <select 
              value={voce} 
              onChange={(e) => setVoce(e.target.value)} 
              className="w-full bg-bg-base border border-white/10 rounded-xl p-4 pr-10 text-white font-bold text-sm focus:border-gold-500/50 outline-none appearance-none"
            >
              {Object.keys(saveti).map(v => <option key={v}>{v}</option>)}
            </select>
            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary rotate-90 pointer-events-none" />
          </div>
       </div>

       <div className="grid grid-cols-1 gap-4">
          <WorkshopResult 
            label="Kada prekinuti srce?" 
            value={saveti[voce]} 
            unit="NA LULI" 
            variant="blue" 
          />
          
          <div className="bg-blue-500/5 border border-blue-500/10 p-4 rounded-2xl flex gap-3">
             <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center shrink-0">
                <Info className="w-4 h-4 text-blue-500" />
             </div>
             <div className="space-y-1">
                <p className="text-[10px] font-black uppercase text-blue-400 tracking-wider">Važna napomena</p>
                <p className="text-[10px] text-white/70 leading-relaxed">Vrednosti su informativne. Finalnu odluku donesite na osnovu mirisa i ukusa na samoj luli tokom destilacije.</p>
             </div>
          </div>
       </div>

      <button 
        onClick={() => onSave(`Patoka savet: ${voce}`, { voce })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-blue-500" /> Sačuvaj u dnevnik
      </button>
    </div>
  );
}

function Kupaza({ onSave }: { onSave: ToolSaveHandler }) {
  const [v1, setV1] = useState(10);
  const [j1, setJ1] = useState(60);
  const [v2, setV2] = useState(5);
  const [j2, setJ2] = useState(40);
  const [v3, setV3] = useState(0);
  const [j3, setJ3] = useState(0);

  const totalVol = v1 + v2 + v3;
  const finalStrength = totalVol > 0 ? (v1*j1 + v2*j2 + v3*j3) / totalVol : 0;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-3">
        {[
          { color: "text-gold-500", label: "Destilat A", v: v1, sv: setV1, j: j1, sj: setJ1 },
          { color: "text-white/40", label: "Destilat B", v: v2, sv: setV2, j: j2, sj: setJ2 },
          { color: "text-white/20", label: "Destilat C", v: v3, sv: setV3, j: j3, sj: setJ3 },
        ].map((d, i) => (
          <div key={i} className="bg-bg-base p-4 rounded-2xl border border-white/5 flex gap-4 items-center">
             <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center shrink-0">
               <Droplet className={cn("w-5 h-5", d.color)} />
             </div>
             <div className="flex-1 grid grid-cols-2 gap-3">
                <WorkshopField label={`${d.label} (L)`} value={d.v} onChange={d.sv} />
                <WorkshopField label={`Jačina (%)`} value={d.j} onChange={d.sj} />
             </div>
          </div>
        ))}
      </div>

      <WorkshopResult 
        label="Finalna Kupaža" 
        value={finalStrength.toFixed(1)} 
        unit="% VOL" 
        subResults={[{ label: "Zajednička zapremina", value: totalVol.toFixed(1), unit: "L" }]}
      />

      <button 
        onClick={() => onSave(`${finalStrength.toFixed(1)}% kupaža`, { v1, j1, v2, j2, v3, j3 })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-gold-500" /> Sačuvaj recept kupaže
      </button>
    </div>
  );
}

function Temperatura({ onSave }: { onSave: ToolSaveHandler }) {
  const [j, setJ] = useState(45);
  const [t, setT] = useState(15);
  const s = j + (20 - t) * 0.3;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 gap-4">
        <WorkshopField label="Očitana Jačina" value={j} onChange={setJ} unit="%" />
        <WorkshopField label="Temperatura" value={t} onChange={setT} unit="°C" />
      </div>

      <div className="relative group">
         <div className="absolute -left-2 top-0 bottom-0 w-1 bg-white/5 rounded-full overflow-hidden">
            <div 
              className="absolute bottom-0 w-full bg-orange-500 transition-all duration-1000" 
              style={{ height: `${Math.min(100, (t / 40) * 100)}%` }}
            />
         </div>
         <WorkshopResult 
            label="Korigovana Jačina (na 20°C)" 
            value={s.toFixed(1)} 
            unit="%" 
            variant="gold" 
         />
      </div>

      <button 
        onClick={() => onSave(`${s.toFixed(1)}% na 20°C`, { j, t })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-orange-400" /> Sačuvaj proračun
      </button>
    </div>
  );
}

function Bure({ onSave }: { onSave: ToolSaveHandler }) {
  const [h, setH] = useState(70);
  const [ds, setDs] = useState(60);
  const [dk, setDk] = useState(50);
  const vol = (Math.PI * h / 12 * (2 * ds**2 + dk**2)) / 1000;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-3 gap-2">
        <WorkshopField label="Visina" value={h} onChange={setH} unit="cm" />
        <WorkshopField label="Sredina" value={ds} onChange={setDs} unit="cm" />
        <WorkshopField label="Dno" value={dk} onChange={setDk} unit="cm" />
      </div>

      <div className="flex justify-center py-4">
         <div className="w-24 h-32 relative border-4 border-gold-500/20 rounded-[30%] overflow-hidden bg-bg-card">
            <div 
              className="absolute bottom-0 w-full bg-gold-500/10 transition-all duration-1000" 
              style={{ height: '70%' }}
            />
            {/* barrel hoops */}
            <div className="absolute top-1/4 w-full h-[2px] bg-white/5" />
            <div className="absolute top-2/4 w-full h-[2px] bg-white/5" />
            <div className="absolute top-3/4 w-full h-[2px] bg-white/5" />
         </div>
      </div>

      <WorkshopResult 
        label="Zapremina Bureta" 
        value={vol.toFixed(1)} 
        unit="L" 
      />

      <button 
        onClick={() => onSave(`${vol.toFixed(1)}L bure`, { h, ds, dk })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-gold-500" /> Sačuvaj proračun
      </button>
    </div>
  );
}

// --- Wine Tools ---

function VinskiSecer({ onSave }: { onSave: ToolSaveHandler }) {
  const [brix, setBrix] = useState(20);
  const alc = brix * 0.59;
  const babo = brix * 0.85;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <WorkshopField label="Šećer u grožđu" value={brix} onChange={setBrix} unit="% BRIX" />
      <WorkshopResult 
        label="Potencijalni Alkohol u Vinu" 
        value={alc.toFixed(1)} 
        unit="% VOL"
        subResults={[{ label: "KMW (Babo)", value: babo.toFixed(1), unit: "°" }]}
      />
      <button 
        onClick={() => onSave(`${alc.toFixed(1)}% alc vino`, { brix })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-gold-500" /> Sačuvaj proračun
      </button>
    </div>
  );
}

function Sumporisanje({ onSave }: { onSave: ToolSaveHandler }) {
  const [liters, setLiters] = useState(100);
  const [target, setTarget] = useState(30);
  const [current, setCurrent] = useState(10);
  
  // Formula: (Target - Current) * Liters / 10 is approx g of Vinobran (50% SO2)
  const required = Math.max(0, (target - current) * liters / 500); 

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <WorkshopField label="Količina vina" value={liters} onChange={setLiters} unit="L" />
      <div className="grid grid-cols-2 gap-4">
        <WorkshopField label="Trenutni slobodni SO2" value={current} onChange={setCurrent} unit="mg/L" />
        <WorkshopField label="Ciljani slobodni SO2" value={target} onChange={setTarget} unit="mg/L" />
      </div>
      <WorkshopResult 
        label="Potreban Kalijum-metabisulfit" 
        value={required.toFixed(1)} 
        unit="g" 
        variant="blue"
      />
      <button 
        onClick={() => onSave(`${required.toFixed(1)}g Vinobrana`, { liters, target, current })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-blue-500" /> Sačuvaj proračun
      </button>
    </div>
  );
}

function KiselostVina({ onSave }: { onSave: ToolSaveHandler }) {
  const [liters, setLiters] = useState(100);
  const [currentAcidity, setCurrentAcidity] = useState(5);
  const [targetAcidity, setTargetAcidity] = useState(6.5);
  
  const acidToAdd = Math.max(0, (targetAcidity - currentAcidity) * liters / 10); // in grams for 1g/L increase

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <WorkshopField label="Količina vina" value={liters} onChange={setLiters} unit="L" />
      <div className="grid grid-cols-2 gap-4">
        <WorkshopField label="Trenutne kiseline" value={currentAcidity} onChange={setCurrentAcidity} unit="g/L" />
        <WorkshopField label="Ciljane kiseline" value={targetAcidity} onChange={setTargetAcidity} unit="g/L" />
      </div>
      <WorkshopResult 
        label="Potrebna Vinska Kiselina" 
        value={acidToAdd.toFixed(0)} 
        unit="g" 
        variant="gold"
      />
       <button 
        onClick={() => onSave(`${acidToAdd.toFixed(0)}g kiseline`, { liters, currentAcidity, targetAcidity })}
        className="w-full py-3.5 btn-secondary text-[11px] flex items-center justify-center gap-2"
      >
        <Save className="w-3.5 h-3.5 text-gold-500" /> Sačuvaj proračun
      </button>
    </div>
  );
}

// Map of all tools
const TOOLS = [
  { id: "komina", label: "Analiza Komine", icon: Beaker, component: Komina, category: "rakija", desc: "Precizno merenje šećera i potencijala alkohola pre vrenja." },
  { id: "kvasci", label: "Kvasci (R)", icon: Beaker, component: Kvasci, category: "rakija", desc: "Proračun enzyma, kvasaca i hrane za čisto vrenje." },
  { id: "prvenac", label: "Prvenac", icon: Flame, component: Prvenac, category: "rakija", desc: "Srpska tehnologija prepeka — odvajanje štetnog metila." },
  { id: "patoka", label: "Patoka", icon: Droplet, component: Patoka, category: "rakija", desc: "Preporuke za pravilan prekid hvatanja srca rakije." },
  { id: "razblazivanje", label: "Razblaživanje", icon: Droplet, component: Razblazivanje, category: "rakija", desc: "Bezbedno spuštanje jačine srca rakije na pitku meru." },
  { id: "temperatura", label: "Korekcija Temp.", icon: ThermometerSun, component: Temperatura, category: "rakija", desc: "Kalibracija jačine na standardnih 20 stepeni celzijusa." },
  { id: "kupaza", label: "Kupaža", icon: Scale, component: Kupaza, category: "rakija", desc: "Spajanje različitih destilata radi dobijanja balansa." },
  { id: "bure", label: "Zapremina Bureta", icon: Cylinder, component: Bure, category: "rakija", desc: "Proračun zapremine drvenih sudova nepravilnog oblika." },
  
  { id: "vinski_secer", label: "Šećer u grožđu", icon: Wine, component: VinskiSecer, category: "vino", desc: "Procena potencijalnog alkohola i zrelosti grožđa." },
  { id: "sumporisanje", icon: GlassWater, label: "Sumporisanje", component: Sumporisanje, category: "vino", desc: "Proračun Vinobrana za zaštitu vina od oksidacije." },
  { id: "kiselost", icon: Droplet, label: "Korekcija Kiselina", component: KiselostVina, category: "vino", desc: "Podešavanje balansa kiselina u širi ili vinu." },
  { id: "enzimi_vino", icon: FlaskConical, label: "Enologija", component: Kvasci, category: "vino", desc: "Doze kvasaca i hrane za vrhunska vina." },
];

export default function Workshop() {
  const QUOTA_SAVER = isQuotaSaverActive();
  useEffect(() => {
    if (!QUOTA_SAVER) return;
    console.info("[QuotaSaver] Workshop mount: no network reads, calculator-only mode.");
  }, [QUOTA_SAVER]);
  const navigate = useNavigate();
  const location = useLocation();
  const goBackSafe = () => {
    const navState = location.state as { returnTo?: string } | null;
    if (navState?.returnTo) {
      navigate(navState.returnTo);
      return;
    }
    const rt = new URLSearchParams(location.search).get("rt");
    if (rt) {
      navigate(rt);
      return;
    }
    navigate("/menu", { replace: true });
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = searchParams.get("cat") === "vino" ? "vino" : "rakija";
  const [category, setCategory] = useState<'rakija' | 'vino'>(initialCategory);
  const currentTabId = searchParams.get("tab") || (category === 'rakija' ? "komina" : "vinski_secer");
  const { history, saveToHistory, clearHistory } = useWorkshopHistory();
  const [showHistory, setShowHistory] = useState(false);
  
  const filteredTools = TOOLS.filter(t => t.category === category);
  const currentTool = TOOLS.find(t => t.id === currentTabId) || (category === 'rakija' ? TOOLS[0] : TOOLS[8]);
  const ActiveComponent = currentTool.component;

  return (
    <div className="min-h-screen bg-bg-base text-white p-4 pb-32 animate-in fade-in duration-700">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={goBackSafe} className="p-2 -ml-2 text-text-secondary hover:text-white transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="space-y-1">
            <h2 className="page-title text-white">Radionica</h2>
            <p className="eyebrow-label text-gold-500 opacity-80">Profesionalni digitalni alati</p>
          </div>
        </div>
        <button 
          onClick={() => setShowHistory(!showHistory)}
          className={cn(
            "p-3 rounded-2xl border transition-all relative",
            showHistory ? "bg-gold-500 border-gold-500 text-black shadow-lg" : "bg-white/5 border-white/10 text-text-secondary"
          )}
        >
          <History className="w-5 h-5" />
          {history.length > 0 && !showHistory && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-black flex items-center justify-center text-white border-2 border-bg-base">
              {history.length}
            </span>
          )}
        </button>
      </div>

      {showHistory ? (
        // ... (history view remains same)
        <div className="space-y-7 animate-in fade-in slide-in-from-right-8 duration-500">
           <div className="flex justify-between items-center px-2">
             <h3 className="section-title text-white">Dnevnik merenja</h3>
             <button onClick={clearHistory} className="text-[11px] font-bold text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20 uppercase tracking-wide flex items-center gap-2">
               <Trash2 className="w-3.5 h-3.5" /> Obriši sve
             </button>
           </div>
           
           <div className="space-y-4">
             {history.length === 0 ? (
               <div className="empty-state p-12 text-center space-y-3 max-w-md mx-auto">
                  <Calculator className="w-10 h-10 text-gold-500/25 mx-auto" />
                  <p className="text-xs text-text-secondary leading-relaxed">Istorija je prazna. Sačuvajte prvo merenje u digitalni dnevnik.</p>
               </div>
             ) : (
               history.map((item) => (
                <div key={item.id} className="card-soft card-interactive p-5 rounded-[24px] flex justify-between items-center group">
                   <div className="space-y-1.5">
                     <p className="eyebrow-label text-gold-500">{item.toolLabel}</p>
                      <p className="text-xl font-black text-white">{item.result}</p>
                      <p className="text-[10px] text-white/70 font-mono">{new Date(item.timestamp).toLocaleDateString()} • {new Date(item.timestamp).toLocaleTimeString()}</p>
                   </div>
                   <button className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                     <ChevronRight className="w-5 h-5" />
                   </button>
                 </div>
               ))
             )}
           </div>
           <button 
             onClick={() => setShowHistory(false)}
             className="w-full py-3.5 btn-tertiary text-[11px]"
           >
             Nazad na kalkulatore
           </button>
        </div>
      ) : (
        <>
          {/* Main Categories Tabs */}
          <div className="grid grid-cols-2 gap-2 mb-8 bg-bg-card p-1 rounded-2xl border border-white/8 mx-2">
             <button 
               onClick={() => { setCategory('rakija'); setSearchParams({ cat: 'rakija', tab: 'komina' }); }}
               className={cn("py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2", 
                 category === 'rakija' ? "bg-gold-500 text-black shadow-lg" : "text-text-secondary hover:text-white")}
             >
               <Flame className="w-4 h-4" /> Rakija
             </button>
             <button 
               onClick={() => { setCategory('vino'); setSearchParams({ cat: 'vino', tab: 'vinski_secer' }); }}
               className={cn("py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2", 
                 category === 'vino' ? "bg-gold-500 text-black shadow-lg" : "text-text-secondary hover:text-white")}
             >
               <Wine className="w-4 h-4" /> Vino
             </button>
          </div>

          {/* Categories Slider */}
          <div className="flex overflow-x-auto pb-4 -mx-4 px-4 snap-x no-scrollbar gap-3">
            {filteredTools.map((tool) => {
              const isActive = currentTabId === tool.id;
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setSearchParams({ cat: category, tab: tool.id })}
                  className={cn(
                    "snap-start whitespace-nowrap flex flex-col items-center gap-3 px-6 py-5 rounded-[24px] transition-all duration-300 border min-w-[120px]",
                    isActive 
                      ? "bg-gold-500 border-gold-500 text-black shadow-xl shadow-gold-500/20 scale-105 z-10" 
                      : "bg-bg-card text-text-secondary border-white/5 hover:border-gold-500/30"
                  )}
                >
                  <Icon className={cn("w-6 h-6", isActive ? "text-black" : "text-gold-500/50")} />
                  <span className="text-[10px] font-black uppercase tracking-wider">{tool.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active Tool Area */}
          <div className="mt-8">
            <WorkshopCard 
              title={currentTool.label} 
              icon={currentTool.icon} 
              description={currentTool.desc}
            >
              <ActiveComponent onSave={(res, inputs) => {
                saveToHistory(currentTool.label, res, inputs);
                alert("Proračun sačuvan u dnevnik!");
              }} />
            </WorkshopCard>
          </div>

          {/* Info Card */}
          <div className="mt-8 p-6 bg-gold-500/5 border border-gold-500/10 rounded-[32px] flex gap-4">
             <div className="w-10 h-10 bg-gold-500/10 rounded-2xl flex items-center justify-center shrink-0">
                <Info className="w-5 h-5 text-gold-500" />
             </div>
             <div className="space-y-1 text-xs text-text-secondary leading-relaxed pt-1">
                <span className="font-bold text-white uppercase block mb-1">D3 Sigurnosni Standard</span>
                Svi proračuni se vrše lokalno na telefonu. Podaci su dostupni i bez interneta u podrumu.
             </div>
          </div>
        </>
      )}

    </div>
  );
}
