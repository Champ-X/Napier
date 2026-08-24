import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyDocumentLocale } from "./locale";
import "./styles/tokens.css";
import "./styles.css";
import "./workspace-shell.css";

applyDocumentLocale();

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

// Load the workspace shell as a dynamic import so the bootstrap entry stays
// within the main-entry budget; App and its dependencies form a separate chunk.
void import("./App").then(({ App }) => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
