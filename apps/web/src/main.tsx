import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter"; // bundled locally: works offline (NFR-03)
import "./index.css";
import { App } from "./App";
import { applyTheme, getStoredTheme } from "./lib/theme";

applyTheme(getStoredTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Element #root not found in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
