import React, { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  getCountFromServer,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { X, TrendingUp, Star, Loader2, Sparkles, Download, BarChart2, ArrowLeft, Info, FileSpreadsheet } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell 
} from 'recharts';

interface AnalyticsModalProps {
  distillery: { id: string; name?: string };
  onClose: () => void;
}

type ProductRow = {
  id: string;
  name?: string;
  scanCount?: number;
  ratingCount?: number;
  averageRating?: number;
};
type RatingRow = { rating?: number; productId?: string; reviewText?: string };

const COLORS = [
  "var(--color-gold-500)",
  "var(--color-gold-600)",
  "var(--color-gold-300)",
  "var(--color-gold-700)",
  "var(--color-gold-400)",
];

export default function DistilleryAnalyticsModal({ distillery, onClose }: AnalyticsModalProps) {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [generatingAi, setGeneratingAi] = useState(false);
  /** Prosečna ocena na uzorku platforme (isključujući vaše proizvode kad je uzorak dovoljno velik), inače null. */
  const [platformAvg, setPlatformAvg] = useState<number | null>(null);
  const [clubMemberCount, setClubMemberCount] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch products
      const qProd = query(collection(db, "products"), where("distilleryId", "==", distillery.id), limit(20));
      const pSnap = await getDocs(qProd);
      const prodData = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProducts(prodData);

      // 2. Ocene: jedan upit po destileriji (manje čitanja nego više „in“ chunkova), plus dedup fallback za stare zapise bez distilleryId
      const pIds = prodData.map((p: { id: string }) => p.id);
      const byId = new Map<string, Record<string, unknown>>();
      const addRatingSnap = (snap: QuerySnapshot) => {
        snap.docs.forEach((d) => {
          if (!byId.has(d.id)) byId.set(d.id, d.data() as Record<string, unknown>);
        });
      };
      try {
        const rQ = query(collection(db, 'ratings'), where('distilleryId', '==', distillery.id), limit(20));
        const rSnap = await getDocs(rQ);
        addRatingSnap(rSnap);
      } catch (e) {
        console.warn('Ocene po distilleryId nisu učitane', e);
      }
      for (let i = 0; i < pIds.length; i += 10) {
        const chunk = pIds.slice(i, i + 10);
        if (chunk.length === 0) continue;
        try {
          const qRat = query(collection(db, "ratings"), where("productId", "in", chunk), limit(20));
          const rSnap = await getDocs(qRat);
          addRatingSnap(rSnap);
        } catch (e) {
          console.warn('Fallback ocene po productId chunk', e);
        }
      }
      setRatings([...byId.values()]);

      const ownProductIds = new Set(prodData.map((p: { id: string }) => p.id));
      let benchmark: number | null = null;
      const parseRatingDocs = (docs: { data: () => Record<string, unknown> }[]) =>
        docs
          .map((d) => d.data())
          .filter((r: Record<string, unknown>) => typeof r.rating === 'number') as {
          rating: number;
          productId?: string;
        }[];
      try {
        let plat: { rating: number; productId?: string }[] = [];
        try {
          const platQ = query(collection(db, 'ratings'), orderBy('createdAt', 'desc'), limit(20));
          const platSnap = await getDocs(platQ);
          plat = parseRatingDocs(platSnap.docs);
        } catch (e) {
          console.warn('Benchmark orderBy(createdAt) nije uspeo — probam uzorak bez sortiranja', e);
        }
        if (plat.length < 5) {
          const fbSnap = await getDocs(query(collection(db, 'ratings'), limit(20)));
          plat = parseRatingDocs(fbSnap.docs);
        }
        const others = plat.filter((r) => r.productId && !ownProductIds.has(r.productId));
        const pool = others.length >= 8 ? others : plat;
        if (pool.length >= 5) {
          benchmark = pool.reduce((s, r) => s + r.rating, 0) / pool.length;
        }
      } catch (e) {
        console.warn('Uzorak platforme za benchmark nije učitan', e);
      }
      setPlatformAvg(benchmark);

      try {
        const mQ = query(collection(db, 'club_memberships'), where('distilleryId', '==', distillery.id));
        const cnt = await getCountFromServer(mQ);
        setClubMemberCount(cnt.data().count);
      } catch (e) {
        console.warn('Broj članova kluba nije učitan', e);
        setClubMemberCount(0);
      }

    } catch (error) {
      console.error("Greška pri učitavanju analitike", error);
    } finally {
      setLoading(false);
    }
  }, [distillery.id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const generateAiAnalysis = async () => {
    setGeneratingAi(true);
    try {
      const texts = ratings.filter(r => r.reviewText).map(r => r.reviewText).join("\n");
      
      if (!texts.trim()) {
        setAiSummary("Nema dovoljno tekstualnih recenzija za AI generisanje.");
        setGeneratingAi(false);
        return;
      }

      // AI Studio injects GEMINI_API_KEY into process.env.GEMINI_API_KEY via vite.config.ts
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Ti si somelijer i ekspert za balkanske rakije. Pročitaj ove recenzije za proizvode destilerije "${distillery.name}":\n\n${texts}\n\nNapiši profesionalni, ohrabrujući poslovni izveštaj (do 150 reči) namenjen menadžmentu ove destilerije. Istakni šta kupci najviše vole i na šta eventualno treba obratiti pažnju. Zadrži poslovni, autoritativni i pozitivan ton B2B konsultanta.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });

      setAiSummary(response.text || "Greška pri generisanju.");
    } catch (error) {
      console.error("AI Error:", error);
      setAiSummary("Trenutno nije moguće generisati AI analizu.");
    } finally {
      setGeneratingAi(false);
    }
  };

  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const GOLD = [184, 134, 11];
    
    doc.setFillColor(26, 26, 28);
    doc.rect(0, 0, 210, 297, 'F');

    doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("RAKIVINUM ANALITIKA", 105, 30, { align: 'center' });
    
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(distillery.name, 105, 45, { align: 'center' });
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(150, 150, 150);
    doc.text("Poslovni izvestaj trzisnog ucinka", 105, 55, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(`Generisan: ${new Date().toLocaleString('sr-RS')}`, 105, 62, { align: 'center' });

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text(`Ukupan broj proizvoda: ${products.length}`, 20, 74);
    doc.text(`Ukupan broj ocena: ${ratings.length}`, 20, 88);
    doc.text(`Clanovi kluba: ${clubMemberCount}`, 20, 102);

    const avg = ratings.length > 0 ? (ratings.reduce((a, b) => a + b.rating, 0) / ratings.length).toFixed(1) : "N/A";
    doc.text(`Prosecna ocena asortimana: ${avg} / 5.0`, 20, 116);
    doc.text(
      `Prosek uzorka platforme: ${platformAvg != null ? platformAvg.toFixed(1) : 'N/A'} / 5.0`,
      20,
      130
    );

    if (aiSummary) {
      doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.text("AI Analiza i Zakljucak:", 20, 148);
      doc.setTextColor(200, 200, 200);
      doc.setFontSize(10);
      
      const splitText = doc.splitTextToSize(aiSummary.replace(/[čćžšđČĆŽŠĐ]/g, match => {
        const charMap: Record<string, string> = { 'č':'c', 'ć':'c', 'ž':'z', 'š':'s', 'đ':'d', 'Č':'C', 'Ć':'C', 'Ž':'Z', 'Š':'S', 'Đ':'D' };
        return charMap[match] || match;
      }), 170);
      
      doc.text(splitText, 20, 158);
    }

    doc.save(`Izvestaj_${distillery.name.replace(/\s+/g, '_')}.pdf`);
  };

  const exportCSV = () => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(['Meta', 'Vrednost'].join(';'));
    lines.push(['Destilerija', esc(distillery.name || '')].join(';'));
    lines.push(['Datum izvoza', esc(new Date().toLocaleString('sr-RS'))].join(';'));
    lines.push(['Clanovi kluba', String(clubMemberCount)].join(';'));
    lines.push(['Ukupno ocena (asortiman)', String(ratings.length)].join(';'));
    lines.push('');
    lines.push(['Proizvod', 'ID', 'Skenova', 'Broj ocena', 'Prosek (1-5)'].join(';'));
    products.forEach((p: { id: string; name?: string; scanCount?: number }) => {
      const pr = ratings.filter((r: { productId?: string }) => r.productId === p.id);
      const n = pr.length;
      const mean =
        n > 0 ? (Math.round((pr.reduce((s: number, r: { rating: number }) => s + r.rating, 0) / n) * 100) / 100).toFixed(2) : '';
      lines.push(
        [esc(p.name || ''), p.id, String(Number(p.scanCount) || 0), String(n), mean].join(';')
      );
    });
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Izvestaj_${(distillery.name || 'destilerija').replace(/\s+/g, '_')}.csv`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Prosek: iz uzorka ocena u modalu, inače ponderisano sa polja na proizvodima (agregat u dokumentu)
  const weightedFromProducts = products.reduce(
    (acc, p: { ratingCount?: number; averageRating?: number }) => {
      const n = Number(p.ratingCount) || 0;
      const a = Number(p.averageRating);
      if (n > 0 && !Number.isNaN(a)) {
        acc.sum += a * n;
        acc.n += n;
      }
      return acc;
    },
    { sum: 0, n: 0 }
  );
  const avgFromProducts =
    weightedFromProducts.n > 0 ? (weightedFromProducts.sum / weightedFromProducts.n).toFixed(1) : null;
  const avgRating =
    ratings.length > 0
      ? (
          ratings.reduce((a, b) => a + (typeof (b as { rating?: number }).rating === 'number' ? (b as { rating: number }).rating : 0), 0) /
          ratings.length
        ).toFixed(1)
      : avgFromProducts ?? '0.0';
  
  // Pie chart data
  const prodsData = products.slice(0, 5).map((p) => ({
    name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
    skeniranja: Number(p.scanCount) || 0,
  }));

  // Bar chart data
  const distRating = parseFloat(avgRating);
  const benchmarkData =
    platformAvg != null
      ? [
          { name: distillery.name.length > 12 ? distillery.name.substring(0, 12) + '…' : distillery.name, prosek: distRating },
          { name: 'Uzorak platforme', prosek: platformAvg },
        ]
      : [{ name: distillery.name.length > 16 ? distillery.name.substring(0, 16) + '…' : distillery.name, prosek: distRating }];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/90 backdrop-blur-md overflow-y-auto">
      <div className="bg-bg-card border border-border-subtle rounded-2xl w-full max-w-5xl shadow-2xl relative my-auto animate-in fade-in zoom-in-95 duration-300">
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 p-2 bg-black/50 text-text-secondary hover:text-white rounded-full transition-colors z-10 hover:bg-red-500 hover:border-red-500 border border-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 md:p-8 flex flex-col h-[90vh] sm:h-auto sm:max-h-[85vh] overflow-y-auto custom-scrollbar">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              <button 
                onClick={onClose}
                className="p-2 sm:hidden bg-white/5 rounded-xl text-text-secondary hover:text-white"
                title="Nazad"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>
              <div>
                <div className="flex items-center gap-3 text-gold-500 mb-2">
                  <BarChart2 className="w-6 h-6" />
                  <h2 className="text-2xl font-bold text-white uppercase tracking-wider">{distillery.name}</h2>
                </div>
                <p className="text-text-secondary text-sm">Poslovni centar za analitiku, tržišni udeo i recenzije kupaca.</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap justify-end sm:justify-start">
              <button 
                onClick={onClose}
                className="hidden sm:flex px-4 py-2 bg-white/5 border border-white/10 text-white hover:bg-white/10 rounded-xl font-bold text-xs uppercase items-center gap-2 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Nazad
              </button>
              <button
                type="button"
                onClick={exportCSV}
                className="px-4 py-2 border border-white/15 text-text-secondary hover:text-white hover:bg-white/10 rounded-xl font-bold text-xs uppercase flex items-center gap-2 transition-colors self-start sm:self-auto"
              >
                <FileSpreadsheet className="w-4 h-4" /> CSV
              </button>
              <button
                type="button"
                onClick={exportPDF}
                className="px-4 py-2 border border-gold-500/50 text-gold-500 hover:bg-gold-500 hover:text-black rounded-xl font-bold text-xs uppercase flex items-center gap-2 transition-colors self-start sm:self-auto"
              >
                <Download className="w-4 h-4" /> PDF
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
              <Loader2 className="w-8 h-8 text-gold-500 animate-spin mb-4" />
              <p className="text-text-secondary font-bold animate-pulse">Obračunavam tržišne podatke...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-bg-card-elevated border border-border-subtle rounded-xl p-4 flex flex-col">
                   <p className="text-xs text-text-secondary font-bold uppercase mb-1">Registrovane Flaše</p>
                   <p className="text-3xl font-black text-white mt-auto">{products.length}</p>
                </div>
                <div className="bg-bg-card-elevated border border-border-subtle rounded-xl p-4 flex flex-col group relative">
                   <p className="text-xs text-text-secondary font-bold uppercase mb-1 flex items-center gap-1"> Interakcije <Info className="w-3 h-3 opacity-50" /> </p>
                   <p className="text-3xl font-black text-white mt-auto">
                     {ratings.length +
                       products.reduce((sum, p) => sum + (Number((p as { scanCount?: number }).scanCount) || 0), 0)}
                   </p>
                   <div className="absolute inset-0 bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4 text-[9px] text-white text-center rounded-xl pointer-events-none">
                      Zbir javnih ocena i skenova (scanCount) na vašim flašama u bazi.
                   </div>
                </div>
                <div className="bg-bg-card-elevated border border-border-subtle rounded-xl p-4 flex flex-col group relative">
                   <p className="text-xs text-text-secondary font-bold uppercase mb-1 flex items-center gap-1"> Ocena <Info className="w-3 h-3 opacity-50" /> </p>
                   <p className="text-3xl font-black text-gold-500 flex items-center gap-2 mt-auto">
                     {avgRating} <Star className="w-5 h-5 fill-gold-500" />
                   </p>
                   <div className="absolute inset-0 bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4 text-[9px] text-white text-center rounded-xl pointer-events-none">
                      Aritmetička sredina svih javnih ocena koje je vaš brend dobio od verifikovanih korisnika.
                   </div>
                </div>
                <div className="bg-bg-card-elevated border border-border-subtle rounded-xl p-4 flex flex-col group relative">
                   <p className="text-xs text-text-secondary font-bold uppercase mb-1 flex items-center gap-1"> Članovi Kluba <Info className="w-3 h-3 opacity-50" /> </p>
                   <p className="text-3xl font-black text-white mt-auto">{clubMemberCount}</p>
                   <div className="absolute inset-0 bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4 text-[9px] text-white text-center rounded-xl pointer-events-none">
                      Broj korisnika koji su zapratili vaš brend i postali članovi vašeg loyalty ekosistema.
                   </div>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Udeo proizvoda */}
                <div className="bg-bg-card-elevated border border-border-subtle rounded-xl p-5">
                  <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-center">Najpopularniji Proizvodi</h3>
                  <p className="text-[10px] text-text-secondary text-center mb-4 italic">Popularnost se obračunava na osnovu broja očitavanja (skenova) i prosečne ocene korisnika.</p>
                  <div className="h-[250px] w-full">
                    {prodsData.length > 0 && prodsData.some((d) => d.skeniranja > 0) ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={prodsData}
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            fill="var(--color-gold-500)"
                            dataKey="skeniranja"
                            label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}
                            labelLine={false}
                          >
                            {prodsData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid rgba(255,255,255,0.14)' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-text-secondary italic text-center px-4">
                        Nema zabeleženih skenova na flašama (scanCount). Pie će biti smislen kada korisnici skeniraju QR.
                      </div>
                    )}
                  </div>
                </div>

                {/* Benchmark */}
                <div className="bg-bg-card-elevated border border-border-subtle rounded-xl p-5">
                  <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-center">Ocene vs Celokupno Tržište</h3>
                  <p className="text-[10px] text-text-secondary text-center mb-4 italic">
                    {platformAvg != null
                      ? 'Upoređuje vašu prosečnu ocenu sa prosekom na uzorku nedavnih ocena na platformi (Firestorov limit — indikativno, ne zvanična statistika).'
                      : 'Za poređenje sa platformom potrebno je više javnih ocena; trenutno je prikazan samo vaš prosečan skor.'}
                  </p>
                  <div className="h-[250px] w-full mt-4">
                     <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={benchmarkData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.14)" vertical={false} />
                        <XAxis dataKey="name" stroke="rgba(255,255,255,0.55)" tick={{fontSize: 12}} />
                        <YAxis stroke="rgba(255,255,255,0.55)" domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid rgba(255,255,255,0.14)' }} cursor={{fill: 'rgba(255,255,255,0.08)'}} />
                        <Bar dataKey="prosek" fill="var(--color-gold-500)" maxBarSize={60} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </div>

              {/* AI Report Section */}
              <div className="bg-gradient-to-br from-bg-card-elevated to-black border border-gold-500/20 rounded-xl p-6 relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <Sparkles className="w-32 h-32 text-gold-500" />
                 </div>
                 
                 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 relative z-10">
                    <div>
                      <h3 className="text-lg font-bold text-gold-500 flex items-center gap-2">
                        <Sparkles className="w-5 h-5" />
                        AI Sažetak Recenzija
                      </h3>
                      <p className="text-xs text-text-secondary mt-1">Veštačka inteligencija čita i sumira mišljenja potrošača.</p>
                    </div>
                    {ratings.length > 0 && !aiSummary && (
                      <button 
                        onClick={generateAiAnalysis}
                        disabled={generatingAi}
                        className="px-4 py-2 bg-gold-500 text-black font-bold text-xs uppercase rounded-xl hover:bg-gold-400 transition-colors flex items-center gap-2"
                      >
                        {generatingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generiši AI Sažetak"}
                      </button>
                    )}
                 </div>

                 <div className="relative z-10 min-h-[100px] border border-dashed border-gold-500/30 rounded-xl bg-black/30 p-5">
                    {generatingAi ? (
                      <div className="flex items-center gap-3 text-gold-500 font-medium">
                         <Loader2 className="w-5 h-5 animate-spin" /> Gemini analizira sentiment potrošača...
                      </div>
                    ) : aiSummary ? (
                      <p className="text-text-primary/90 text-sm leading-relaxed first-letter:text-4xl first-letter:font-black first-letter:text-gold-500 first-letter:float-left first-letter:mr-2">
                        {aiSummary}
                      </p>
                    ) : (
                      <p className="text-sm text-text-secondary italic text-center leading-relaxed mt-4">
                        Pritisnite dugme iznad kako bi naš sistem pročitao sve recenzije i ispisao jasan zaključak o utisku potrošača.
                      </p>
                    )}
                 </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
