import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";

/** Defer an automatic collapse until focus can be checked in visible content. */
export function useWorkspaceEvidenceDisclosure(secondary: boolean) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [secondaryApplied, setSecondaryApplied] = useState(secondary);
  const open = !secondary || !secondaryApplied || expanded;

  useLayoutEffect(() => {
    if (secondary === secondaryApplied) return;
    if (secondary && contentRef.current?.contains(document.activeElement)) {
      setExpanded(true);
    }
    setSecondaryApplied(secondary);
  }, [secondary, secondaryApplied]);

  return {
    contentRef,
    open,
    toggle: (event: MouseEvent<HTMLButtonElement>) => {
      if (open && contentRef.current?.contains(document.activeElement)) {
        event.currentTarget.focus();
      }
      setExpanded(!open);
    },
  };
}
