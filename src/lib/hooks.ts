import { useCallback, useLayoutEffect, useRef } from "react";
/** Stable function identity that always runs the latest closure, for memoized children. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
