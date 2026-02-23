import { useEffect, useRef } from "react";

/**
 * Custom hook that automatically scrolls to the bottom of a container
 * when the dependency array changes
 */
export function useAutoScroll<T>(dependency: T) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dependency]);

  return scrollRef;
}

