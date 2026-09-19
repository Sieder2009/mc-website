import { useCallback, useRef, useState } from "react";

export function useLightbox() {
  const [state, setState] = useState(null); // { src, caption } | null
  const lastFocusedRef = useRef(null);

  const open = useCallback((src, caption) => {
    lastFocusedRef.current = document.activeElement;
    setState({ src, caption });
  }, []);

  const close = useCallback(() => {
    setState(null);
    lastFocusedRef.current?.focus?.();
  }, []);

  return { state, open, close };
}
