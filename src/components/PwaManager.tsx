import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Download, Apple } from "lucide-react";

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaManager() {
  const deferredPromptRef = useRef<BeforeInstallPromptEventLike | null>(null);
  const [modalContent, setModalContent] = useState<{ title: string; content: React.ReactNode } | null>(null);
  const installBusyRef = useRef(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEventLike;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (installBusyRef.current) return;
    installBusyRef.current = true;

    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;

      if (isStandalone) {
        setModalContent({
          title: "Aplikacija sa početnog ekrana",
          content: (
            <div className="space-y-4">
              <div className="w-16 h-16 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto border border-gold-500/20">
                <Download className="w-8 h-8 text-gold-500" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm text-text-secondary">
                  Otvorio si Rakivinum kao <strong className="text-white">aplikaciju</strong> (bez adresne trake). To je ispravno.
                </p>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Ako si dodao samo prečicu iz menija (tri tačke), ona ponekad i dalje otvara <strong className="text-white">Chrome sa trakom</strong> — to nije ista stvar kao instalacija iz Chrome poruke „Instaliraj aplikaciju“.
                </p>
                <p className="text-[10px] text-gold-500 font-bold uppercase tracking-widest bg-gold-500/5 py-2 rounded-xl">
                  Koristi ikonicu koja je nastala nakon „Instaliraj aplikaciju“
                </p>
              </div>
            </div>
          ),
        });
        return;
      }

      const deferredPrompt = deferredPromptRef.current;
      if (!deferredPrompt) {
        if (isIOS) {
          setModalContent({
            title: "Instalacija na iPhone",
            content: (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <Apple className="w-10 h-10 text-white opacity-20" />
                </div>
                <p className="text-xs text-text-secondary text-center">
                  U <strong className="text-white">Safariju</strong> otvori ovaj sajt, pa:
                </p>
                <div className="space-y-3 bg-white/3 p-4 rounded-2xl border border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gold-500/10 flex items-center justify-center text-gold-500 font-black italic border border-gold-500/20 shrink-0">
                      1
                    </div>
                    <p className="text-xs text-white">
                      Dole <span className="text-gold-500 font-black px-2 py-1 rounded bg-gold-500/10 border border-gold-500/20">Share</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gold-500/10 flex items-center justify-center text-gold-500 font-black italic border border-gold-500/20 shrink-0">
                      2
                    </div>
                    <p className="text-xs text-white">
                      <span className="text-gold-500 font-black px-2 py-1 rounded bg-gold-500/10 border border-gold-500/20">Add to Home Screen</span>
                    </p>
                  </div>
                </div>
                <p className="text-[9px] text-text-secondary text-center opacity-70 italic uppercase tracking-wider">
                  Samo Safari — ne iz Viber/Instagram pregledača
                </p>
              </div>
            ),
          });
        } else {
          setModalContent({
            title: "Instalacija (Android / Chrome)",
            content: (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary text-center leading-relaxed">
                  Ovde Chrome <strong className="text-white">nije ponudio</strong> brzo dugme za instalaciju. Možeš:
                </p>
                <div className="bg-white/3 p-5 rounded-2xl border border-white/5 space-y-3 text-left">
                  <p className="text-xs text-white">
                    <span className="text-gold-500 font-black">A)</span> Ako vidiš poruku „Instaliraj aplikaciju“ u meniju Chrome — koristi <strong>to</strong>; ikonica sa početnog ekrana onda otvara app preko celog ekrana.
                  </p>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    <span className="text-gold-500 font-black">B)</span> „Dodaj na početni ekran“ iz tri tačke često pravi <strong>prečicu koja i dalje otvara Chrome</strong> sa gornjom trakom — to je normalno ponašanje pretraživača, nije bug Rakivinuma.
                  </p>
                </div>
                <p className="text-[10px] text-center text-text-secondary italic">
                  Jedna poruka po kliku — ako se ništa ne desi, sačekaj sekund pa probaj ponovo.
                </p>
              </div>
            ),
          });
        }
        return;
      }

      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          deferredPromptRef.current = null;
        }
      } catch (err) {
        console.error("Installation failed", err);
      }
    } finally {
      installBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const onTrigger = () => {
      void handleInstallApp();
    };
    window.addEventListener("rakivinum_trigger_install", onTrigger);
    return () => window.removeEventListener("rakivinum_trigger_install", onTrigger);
  }, [handleInstallApp]);

  if (!modalContent) return null;

  return (
    <div className="fixed inset-0 z-[999] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="bg-bg-card-elevated border border-gold-500/30 rounded-[40px] w-full max-w-sm p-8 space-y-6 relative shadow-[0_30px_100px_rgba(0,0,0,1)]">
        <button
          type="button"
          onClick={() => setModalContent(null)}
          className="absolute top-8 right-8 p-2 hover:bg-white/10 rounded-full text-text-secondary transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="space-y-2 pt-4">
          <h3 className="text-2xl font-black font-serif text-gold-500 italic text-center pr-8">{modalContent.title}</h3>
          <div className="w-20 h-[2px] bg-gold-500/20 mx-auto" />
        </div>

        {modalContent.content}

        <button
          type="button"
          onClick={() => setModalContent(null)}
          className="w-full py-5 bg-white/5 border border-white/10 text-white font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-white/10 transition-all text-[10px] active:scale-95"
        >
          Razumem
        </button>
      </div>
    </div>
  );
}
