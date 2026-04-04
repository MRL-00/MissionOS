import { useCallback, useEffect, useRef, useState } from "react";
import type { NodePosition } from "./types";

export function useNodePositions(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);

  const measure = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const next = new Map<string, NodePosition>();

      container.querySelectorAll<HTMLElement>("[data-agent-id]").forEach((element) => {
        const id = element.dataset.agentId;
        if (!id) {
          return;
        }

        const rect = element.getBoundingClientRect();
        next.set(id, {
          id,
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
        });
      });

      setPositions(next);
    });
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(container);
    measure();

    return () => {
      observerRef.current?.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, measure]);

  return { positions, measure };
}
