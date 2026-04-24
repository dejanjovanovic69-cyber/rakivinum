import * as React from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null,
      componentStack: "",
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack || "" });
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if ((this as any).state.hasError) {
      let errorMessage = "Došlo je do neočekivane greške.";
      let details = (this as any).state.error?.message;
      const stack = (this as any).state.componentStack as string;

      // Try parsing Firebase error context if it exists
      try {
        if (details && details.startsWith("{")) {
          const parsed = JSON.parse(details);
          if (parsed.error && parsed.error.includes("permissions")) {
            errorMessage = "Nemate prava pristupa ovoj akciji.";
            details = "Nedovoljne permisije.";
          }
        }
      } catch (e) {
        // Not a JSON error message, ignore
      }

      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">{errorMessage}</h2>
            {details && (
              <p className="text-sm text-text-secondary font-mono bg-bg-card-elevated p-2 rounded-md max-w-sm overflow-auto">
                {details}
              </p>
            )}
            {stack ? (
              <p className="text-[10px] text-text-secondary font-mono bg-black/30 p-2 rounded-md max-w-sm overflow-auto text-left whitespace-pre-wrap">
                {stack}
              </p>
            ) : null}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400"
          >
            Pokušaj ponovo
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
