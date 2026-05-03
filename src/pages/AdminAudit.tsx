import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { 
  ShieldAlert, 
  Users, 
  UserX, 
  Activity, 
  Fingerprint, 
  ShieldCheck, 
  AlertTriangle,
  Search,
  MoreVertical,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Filter,
  ArrowLeft
} from "lucide-react";
import { auth, db } from "../lib/firebase";
import { collection, query, orderBy, limit, getDocs, doc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { cn } from "../lib/utils";
import { shouldRunRefresh } from "../lib/refreshGate";
import { REFRESH_INTERVAL } from "../lib/cachePolicy";
import { readCache, writeCache } from "../lib/resilience";
import { meterDbRead } from "../lib/requestMeter";

const PERMISSION_MATRIX = [
  { role: "Gost", viewLabel: "Da", rate: "Ne", analytics: "Ne", actions: "Pretraga" },
  { role: "Korisnik", viewLabel: "Da", rate: "Da (1 dnevno)", analytics: "Osnovna", actions: "Čuvanje, Ocena" },
  { role: "Destiler", viewLabel: "Da", rate: "Da", analytics: "Puna (Svoj Brend)", actions: "Edit Rakije, QR Export" },
  { role: "Admin", viewLabel: "Da", rate: "Da", analytics: "Celi Sistem", actions: "Blokiranje, Moderacija" },
];

type AuditLog = {
  id: string;
  ipHash?: string;
  fingerprintHash?: string;
  visitorId?: string;
  actorKey?: string;
  rating?: number;
  isSourceSuspicious?: boolean;
  productName?: string;
  timestamp?: string;
  userAgent?: string;
  reviewText?: string;
  userId?: string;
};
type AuditUser = { id: string; email?: string; role?: string; isBlocked?: boolean };
type AbuseBlock = { isBlocked?: boolean; [key: string]: unknown };
type SourceSummary = {
  key: string;
  ipHash: string | null;
  fingerprintHash: string | null;
  visitorId: string | null;
  total: number;
  low: number;
  suspiciousCount: number;
  lastAt: string | null;
  products: Set<string>;
  lowRatio?: number;
  productList?: string[];
};

export default function AdminAudit() {
  const EMERGENCY_READ_FREEZE = false;
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
    navigate("/admin", { replace: true });
  };
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [abuseBlocks, setAbuseBlocks] = useState<Record<string, AbuseBlock>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'matrix' | 'logs' | 'users' | 'sources'>('logs');

  useEffect(() => {
    if (EMERGENCY_READ_FREEZE) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const logsCacheKey = "rakivinum_cache_admin_audit_logs_v1";
    const usersCacheKey = "rakivinum_cache_admin_audit_users_v1";
    const blocksCacheKey = "rakivinum_cache_admin_audit_blocks_v1";

    const refreshAuditData = async () => {
      // Throttle quick focus/visibility bursts.
      if (!shouldRunRefresh("admin-audit:refresh", REFRESH_INTERVAL.ADMIN_PANEL_10M)) return;
      try {
        const logsQuery = query(collection(db, 'rating_logs'), orderBy('createdAt', 'desc'), limit(80));
        const logsSnap = await getDocs(logsQuery);
        meterDbRead("adminAudit:rating_logs", logsSnap.size);
        const nextLogs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as AuditLog[];
        if (!cancelled) {
          setLogs(nextLogs);
          setLoading(false);
        }
        writeCache(logsCacheKey, nextLogs, REFRESH_INTERVAL.ADMIN_PANEL_10M);
      } catch (err) {
        console.error("AdminAudit logs refresh failed", err);
        if (!cancelled) {
          const cachedLogs = readCache<AuditLog[]>(logsCacheKey);
          if (cachedLogs) setLogs(cachedLogs);
          setLoading(false);
        }
      }

      try {
        const usersQuery = query(collection(db, 'users'), limit(25));
        const usersSnap = await getDocs(usersQuery);
        meterDbRead("adminAudit:users", usersSnap.size);
        const nextUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() })) as AuditUser[];
        if (!cancelled) setUsers(nextUsers);
        writeCache(usersCacheKey, nextUsers, REFRESH_INTERVAL.ADMIN_PANEL_10M);
      } catch (err) {
        console.error("AdminAudit users refresh failed", err);
        if (!cancelled) {
          const cachedUsers = readCache<AuditUser[]>(usersCacheKey);
          if (cachedUsers) setUsers(cachedUsers);
        }
      }

      try {
        const blocksQuery = query(collection(db, 'abuse_blocks'), limit(80));
        const blocksSnap = await getDocs(blocksQuery);
        meterDbRead("adminAudit:abuse_blocks", blocksSnap.size);
        const next: Record<string, AbuseBlock> = {};
        blocksSnap.forEach((d) => {
          next[d.id] = d.data();
        });
        if (!cancelled) setAbuseBlocks(next);
        writeCache(blocksCacheKey, next, REFRESH_INTERVAL.ADMIN_PANEL_10M);
      } catch (err) {
        console.error("AdminAudit abuse blocks refresh failed", err);
        if (!cancelled) {
          const cachedBlocks = readCache<Record<string, AbuseBlock>>(blocksCacheKey);
          if (cachedBlocks) setAbuseBlocks(cachedBlocks);
        }
      }
    };

    const cachedLogs = readCache<AuditLog[]>(logsCacheKey);
    const cachedUsers = readCache<AuditUser[]>(usersCacheKey);
    const cachedBlocks = readCache<Record<string, AbuseBlock>>(blocksCacheKey);
    if (cachedLogs) {
      setLogs(cachedLogs);
      setLoading(false);
    }
    if (cachedUsers) setUsers(cachedUsers);
    if (cachedBlocks) setAbuseBlocks(cachedBlocks);

    if (!cachedLogs || !cachedUsers || !cachedBlocks || shouldRunRefresh("admin-audit:initial", REFRESH_INTERVAL.ADMIN_PANEL_10M)) {
      void refreshAuditData();
    }
    const onFocusRefresh = () => {
      if (document.visibilityState !== "visible") return;
      void refreshAuditData();
    };
    const onVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      onFocusRefresh();
    };
    window.addEventListener("focus", onFocusRefresh);
    document.addEventListener("visibilitychange", onVisibilityRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocusRefresh);
      document.removeEventListener("visibilitychange", onVisibilityRefresh);
    };
  }, [EMERGENCY_READ_FREEZE]);

  const toggleBlockUser = async (userId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        isBlocked: !currentStatus,
        updatedAt: new Date().toISOString()
      });
      alert(`Korisnik je ${!currentStatus ? 'BLOKIRAN' : 'ODBLOKIRAN'}`);
    } catch (err) {
      console.error(err);
    }
  };

  const getSourceDocMeta = (source: SourceSummary): { docId: string | null; label: string } => {
    if (source.ipHash) return { docId: `ip_${source.ipHash}`, label: "IP hash" };
    if (source.fingerprintHash) return { docId: `fp_${source.fingerprintHash}`, label: "Fingerprint hash" };
    if (source.visitorId) return { docId: `visitor_${source.visitorId}`, label: "Visitor ID" };
    return { docId: null, label: "Nepoznato" };
  };

  const toggleSourceBlock = async (source: SourceSummary, shouldBlock: boolean) => {
    const meta = getSourceDocMeta(source);
    if (!meta.docId) {
      alert("Nije moguće blokirati izvor bez identifikatora.");
      return;
    }
    try {
      await setDoc(doc(db, "abuse_blocks", meta.docId), {
        isBlocked: shouldBlock,
        sourceType: meta.label,
        sourceDocId: meta.docId,
        ipHash: source.ipHash || null,
        fingerprintHash: source.fingerprintHash || null,
        visitorId: source.visitorId || null,
        reason: shouldBlock ? "Manual admin block" : "Manual admin approval",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      alert(shouldBlock ? "Izvor je blokiran." : "Izvor je odobren i odblokiran.");
    } catch (err) {
      console.error(err);
      alert("Greška pri izmeni statusa izvora.");
    }
  };

  const riskySources = Object.values(
    logs.reduce((acc: Record<string, SourceSummary>, log) => {
      const sourceKey = log.ipHash || log.fingerprintHash || log.visitorId || log.actorKey;
      if (!sourceKey) return acc;
      if (!acc[sourceKey]) {
        acc[sourceKey] = {
          key: sourceKey,
          ipHash: log.ipHash || null,
          fingerprintHash: log.fingerprintHash || null,
          visitorId: log.visitorId || null,
          total: 0,
          low: 0,
          suspiciousCount: 0,
          lastAt: null as string | null,
          products: new Set<string>(),
        };
      }
      acc[sourceKey].total += 1;
      if (Number(log.rating || 0) <= 2) acc[sourceKey].low += 1;
      if (log.isSourceSuspicious) acc[sourceKey].suspiciousCount += 1;
      if (log.productName) acc[sourceKey].products.add(String(log.productName));
      const currentTs = typeof log.timestamp === "string" ? log.timestamp : null;
      if (currentTs && (!acc[sourceKey].lastAt || currentTs > acc[sourceKey].lastAt)) {
        acc[sourceKey].lastAt = currentTs;
      }
      return acc;
    }, {})
  )
    .map((item: SourceSummary) => ({
      ...item,
      lowRatio: item.total > 0 ? item.low / item.total : 0,
      productList: Array.from(item.products).slice(0, 4),
    }))
    .filter((item: SourceSummary) => item.total >= 3 || item.suspiciousCount > 0)
    .sort((a: SourceSummary, b: SourceSummary) => {
      if (b.suspiciousCount !== a.suspiciousCount) return b.suspiciousCount - a.suspiciousCount;
      if (b.lowRatio !== a.lowRatio) return b.lowRatio - a.lowRatio;
      return b.total - a.total;
    })
    .slice(0, 20);

  return (
    <div className="min-h-screen bg-bg-base text-white p-4 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button 
          onClick={goBackSafe}
          className="p-2 -ml-2 text-text-secondary hover:text-white transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20">
          <ShieldAlert className="w-6 h-6 text-red-500" />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight">SIGURNOSNI AUDIT</h1>
          <p className="text-[10px] text-text-secondary uppercase tracking-widest font-bold">Anti-Fraud & Moderacija (D2, D3)</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-bg-card border border-border-subtle rounded-xl max-w-fit">
        {[
          { id: 'logs', label: 'Logovi', icon: Activity },
          { id: 'sources', label: 'Izvori', icon: Fingerprint },
          { id: 'users', label: 'Korisnici', icon: Users },
          { id: 'matrix', label: 'Matrica', icon: ShieldCheck },
        ].map((tab) => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'matrix' | 'logs' | 'users' | 'sources')}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
              activeTab === tab.id ? "bg-red-500 text-white shadow-lg" : "text-text-secondary hover:text-white"
            )}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Areas */}
      {activeTab === 'logs' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5 duration-500">
           <div className="flex justify-between items-center px-1">
             <h3 className="text-xs font-bold text-text-secondary uppercase tracking-[0.2em]">Sistemski Logovi (Anti-Indijanac)</h3>
             <button className="text-[10px] font-bold text-red-400">Očisti logove</button>
           </div>
           <div className="space-y-3">
              {logs.length === 0 ? (
                <div className="p-12 text-center bg-bg-card border border-dashed border-border-subtle rounded-3xl">
                   <Activity className="w-8 h-8 text-white/5 mx-auto mb-2" />
                   <p className="text-xs text-text-secondary">Nema sumnjivih aktivnosti.</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="bg-bg-card border border-border-subtle p-4 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", log.rating <= 2 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-green-500")}></div>
                        <span className="text-xs font-bold">{log.productName}</span>
                      </div>
                      <span className="text-[10px] text-text-secondary font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <Fingerprint className="w-3 h-3 text-red-400" />
                      <span className="text-text-secondary truncate max-w-[200px]">{log.userAgent}</span>
                    </div>
                    <div className="p-2 bg-black/40 rounded-lg border border-white/5">
                      <p className="text-[10px] italic text-text-secondary">"{log.reviewText || "Bez komentara"}"</p>
                    </div>
                    <div className="flex justify-between pt-1">
                       <span className="text-[10px] font-bold text-gold-500">Ocena: {log.rating} ★</span>
                       <button 
                         onClick={() => toggleBlockUser(log.userId, false)}
                         className="text-[10px] bg-red-500/10 text-red-500 px-2.5 py-1 rounded-md border border-red-500/20 font-bold uppercase transition-colors hover:bg-red-500 hover:text-white"
                       >
                         Blokiraj Korisnika
                       </button>
                    </div>
                  </div>
                ))
              )}
           </div>
        </div>
      )}

      {activeTab === 'sources' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5 duration-500">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-[0.2em]">Rizični izvori (7 dana)</h3>
            <span className="text-[10px] text-gold-500 font-bold">{riskySources.length} izvora</span>
          </div>
          {riskySources.length === 0 ? (
            <div className="p-12 text-center bg-bg-card border border-dashed border-border-subtle rounded-3xl">
              <ShieldCheck className="w-8 h-8 text-white/10 mx-auto mb-2" />
              <p className="text-xs text-text-secondary">Nema izvora sa sumnjivim obrascem.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {riskySources.map((source) => (
                <div key={source.key} className="bg-bg-card border border-border-subtle rounded-2xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-text-secondary">Izvor</p>
                      <p className="text-xs text-white font-mono truncate">
                        {(source.ipHash || source.fingerprintHash || source.visitorId || "n/a").slice(0, 24)}...
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {abuseBlocks[getSourceDocMeta(source).docId || ""]?.isBlocked ? (
                        <span className="text-[10px] px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 font-bold uppercase">
                          Blokiran
                        </span>
                      ) : source.suspiciousCount > 0 ? (
                        <span className="text-[10px] px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold uppercase">
                          Sumnjiv
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-black/30 rounded-lg p-2">
                      <p className="text-[9px] text-text-secondary uppercase">Ukupno</p>
                      <p className="text-sm font-black text-white">{source.total}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <p className="text-[9px] text-text-secondary uppercase">Niske</p>
                      <p className="text-sm font-black text-red-400">{source.low}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <p className="text-[9px] text-text-secondary uppercase">Udeo</p>
                      <p className="text-sm font-black text-gold-500">{Math.round(source.lowRatio * 100)}%</p>
                    </div>
                  </div>

                  {source.productList.length > 0 && (
                    <p className="text-[10px] text-text-secondary">
                      Proizvodi: <span className="text-white">{source.productList.join(", ")}</span>
                    </p>
                  )}
                  {source.lastAt && (
                    <p className="text-[10px] text-text-secondary">
                      Poslednja aktivnost: {new Date(source.lastAt).toLocaleString("sr-RS")}
                    </p>
                  )}
                  <div className="pt-1">
                    {abuseBlocks[getSourceDocMeta(source).docId || ""]?.isBlocked ? (
                      <button
                        onClick={() => toggleSourceBlock(source, false)}
                        className="text-[10px] bg-green-500/10 text-green-400 px-3 py-1.5 rounded-md border border-green-500/20 font-bold uppercase hover:bg-green-500 hover:text-black transition-colors"
                      >
                        Odobri izvor
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleSourceBlock(source, true)}
                        className="text-[10px] bg-red-500/10 text-red-400 px-3 py-1.5 rounded-md border border-red-500/20 font-bold uppercase hover:bg-red-500 hover:text-white transition-colors"
                      >
                        Blokiraj izvor
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-5 duration-500">
           <div className="bg-bg-card border border-border-subtle rounded-2xl overflow-hidden">
             <table className="w-full text-left text-xs">
               <thead className="bg-white/5 border-b border-white/5">
                 <tr>
                   <th className="p-4 font-bold text-text-secondary">Korisnik</th>
                   <th className="p-4 font-bold text-text-secondary text-right">Status</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-white/5">
                 {users.map(u => (
                   <tr key={u.id}>
                     <td className="p-4">
                       <p className="font-bold truncate max-w-[120px]">{u.email}</p>
                       <p className="text-[9px] text-text-secondary uppercase">{u.role || 'user'}</p>
                     </td>
                     <td className="p-4 text-right">
                       <button 
                         onClick={() => toggleBlockUser(u.id, u.isBlocked)}
                         className={cn(
                           "px-2 py-1 rounded-md text-[10px] font-bold uppercase border",
                           u.isBlocked 
                             ? "bg-red-500/10 text-red-500 border-red-500/20" 
                             : "bg-green-500/10 text-green-500 border-green-500/20"
                         )}
                       >
                         {u.isBlocked ? 'Blokiran' : 'Aktivan'}
                       </button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      )}

      {activeTab === 'matrix' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500">
          <div className="p-5 bg-gradient-to-br from-red-500/20 to-transparent border border-red-500/20 rounded-3xl space-y-3">
             <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Anti-Abuse Strategija</h3>
             </div>
             <ul className="space-y-2">
                {[
                  "Max 1 ocena po artiklu dnevno",
                  "Fingerprinting botova preko User-Agenta",
                  "Cooldown od 3s između akcija",
                  "Automatsko flag-ovanje niskih ocena bez teksta",
                  "Moderator dashboard za instat blokadu"
                ].map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px] text-text-primary/90">
                     <div className="w-1 h-1 bg-red-400 rounded-full" /> {r}
                  </li>
                ))}
             </ul>
          </div>

          <div className="space-y-3">
             <h3 className="text-xs font-bold text-text-secondary uppercase tracking-[0.2em] px-2">Matrica Pristupa (D2)</h3>
             <div className="bg-bg-card border border-border-subtle rounded-[24px] overflow-x-auto">
                <table className="w-full text-left text-[10px]">
                   <thead className="bg-white/5 text-text-secondary border-b border-white/5">
                      <tr>
                         <th className="p-3">Uloga</th>
                         <th className="p-3 whitespace-nowrap">Ocenjivanje</th>
                         <th className="p-3">Analitika</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {PERMISSION_MATRIX.map((row, i) => (
                        <tr key={i} className="hover:bg-white/5">
                           <td className="p-3 font-bold text-gold-500">{row.role}</td>
                           <td className="p-3">{row.rate}</td>
                           <td className="p-3">{row.analytics}</td>
                        </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </div>
        </div>
      )}

      {/* Security Actions Cards */}
      <div className="grid grid-cols-2 gap-3">
         <div className="bg-bg-base border border-border-subtle p-4 rounded-3xl space-y-2 hover:border-red-500/40 transition-colors">
            <UserX className="w-5 h-5 text-red-500" />
            <p className="text-[10px] font-bold text-white uppercase">Sruši nalog</p>
            <p className="text-[8px] text-text-secondary">Trajna blokada po UID-u</p>
         </div>
         <div className="bg-bg-base border border-border-subtle p-4 rounded-3xl space-y-2 hover:border-gold-500/40 transition-colors">
            <Fingerprint className="w-5 h-5 text-gold-500" />
            <p className="text-[10px] font-bold text-white uppercase">Otisak</p>
            <p className="text-[8px] text-text-secondary">Audit sumnjivih MAC-ova</p>
         </div>
      </div>
    </div>
  );
}
