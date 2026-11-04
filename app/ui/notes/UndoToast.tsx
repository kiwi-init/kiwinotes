// O aviso de baixo com "Desfazer" (T2469): depois de apagar, por 8 s. Some sozinho ou com o clique.

import { useEffect, useRef } from "react";

export interface Toast {
  text: string;
  undo?(): void;
}

export function UndoToast({ toast, onDone }: { toast: Toast; onDone(): void }) {
  // O prazo conta por aviso, não por render: o pai passa um onDone novo a cada render.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className="kn-toast" role="status">
      <span>{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          className="kn-bt kn-bt-acc"
          onClick={() => {
            toast.undo?.();
            onDone();
          }}
        >
          Desfazer
        </button>
      ) : null}
    </div>
  );
}
