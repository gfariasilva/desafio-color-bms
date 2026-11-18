import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "@/config/navigation";

/**
 * Alt+1 … Alt+9 open the main areas (NFR-05: keyboard-first).
 * Uses `event.code` ("Digit1") so it works with any keyboard layout.
 */
export function useNavShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const match = /^Digit([1-9])$/.exec(event.code);
      if (!match) return;
      const item = NAV_ITEMS.find((nav) => nav.shortcut === Number(match[1]));
      if (!item) return;
      event.preventDefault();
      navigate(item.path);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
}
