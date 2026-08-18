import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, ScanLine, FlaskConical, Users, Settings, Bell, X, LibraryBig, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { useState } from "react";

export default function MobileLayout() {
  const navigate = useNavigate();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const navItems = [
    { icon: Home, label: "Home", path: "/" },
    { icon: Users, label: "Zajednica", path: "/community" },
    { icon: LibraryBig, label: "Riznica", path: "/moja-riznica" },
    { icon: ScanLine, label: "Skeniraj", path: "/scan", isPrimary: true },
    { icon: FlaskConical, label: "Radionica", path: "/radionica" },
    { icon: Settings, label: "Meni", path: "/menu" },
  ];

  return (
    <div className="flex flex-col min-h-[100dvh] bg-bg-base max-w-2xl mx-auto shadow-2xl relative overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg-card/90 backdrop-blur-md border-b border-border-gold px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-full pl-2 pr-4 py-1.5 shadow-inner">
          <span className="w-8 h-8 overflow-hidden rounded-[8px] shrink-0 bg-black">
            <img
              src="/icon-192.png"
              alt="RV"
              className="w-full h-full object-cover object-center media-crisp scale-[2.2]"
              style={{ objectPosition: "52% 50%" }}
              referrerPolicy="no-referrer"
            />
          </span>
          <h1 className="text-[14px] font-black italic text-gold-500 tracking-wider m-0 uppercase flex items-center gap-1.5">
            <span className="opacity-20 font-serif text-white">/</span> RAKIVINUM MREŽA
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setIsNotifOpen(true)}
          className="relative p-2 rounded-full text-text-secondary hover:text-gold-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border border-bg-card" />
        </button>
      </header>

      {/* Notifications Modal */}
      {isNotifOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm p-6 flex flex-col justify-end">
          <div className="bg-bg-card-elevated border border-border-gold rounded-3xl p-6 space-y-4 animate-in slide-in-from-bottom-full duration-300">
            <div className="flex justify-between items-center border-b border-white/5 pb-4">
              <h3 className="text-lg font-bold text-white">Obaveštenja</h3>
              <button
                type="button"
                onClick={() => setIsNotifOpen(false)}
                className="p-2 hover:bg-white/5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>
            <div className="space-y-4 py-6">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-4 items-start animate-in fade-in slide-in-from-right-4">
                <div className="w-10 h-10 rounded-xl bg-gold-500/10 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-gold-500" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-bold text-white">Preporuka Dana</p>
                    <span className="text-[10px] text-text-secondary">Danas</span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">Nova preporuka vrhunske rakije je spremna! Pogledajte šta smo izdvojili za vas na početnoj strani.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsNotifOpen(false);
                      navigate("/");
                    }}
                    className="mt-2 w-full py-2.5 rounded-xl border border-gold-500/20 bg-gold-500/5 text-[10px] text-gold-500 font-bold uppercase tracking-widest hover:bg-gold-500/10 hover:border-gold-500/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card-elevated"
                  >
                    Pogledaj odmah
                  </button>
                </div>
              </div>

              <div className="text-center pt-4">
                <p className="ui-caption uppercase tracking-widest italic text-text-secondary/60">Nema više obaveštenja</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto pb-24 scroll-smooth">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card border-t border-border-gold pb-safe">
        <div className="max-w-2xl mx-auto flex justify-between items-end px-2 py-2 h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            
            if (item.isPrimary) {
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className="flex flex-col items-center justify-center flex-1 -mt-5 relative z-10 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/65 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
                >
                  {({ isActive }) => (
                    <div className={cn(
                      "flex items-center justify-center w-14 h-14 rounded-full transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
                      isActive 
                        ? "bg-gold-500 text-black shadow-[0_0_20px_rgba(212,175,55,0.3)]" 
                        : "bg-bg-card border-2 border-gold-500 text-gold-500"
                    )}>
                      <Icon className="w-6 h-6" strokeWidth={isActive ? 2.5 : 2} />
                    </div>
                  )}
                </NavLink>
              );
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => cn(
                  "flex flex-col items-center justify-end flex-1 pb-1 gap-1 transition-colors rounded-xl min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card",
                  isActive ? "text-gold-500" : "text-text-nav hover:text-text-primary"
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon className="w-5 h-5 mb-0.5 transition-transform" strokeWidth={isActive ? 2.5 : 2} />
                    <span className="text-[10px] font-medium leading-none tracking-wide">{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
