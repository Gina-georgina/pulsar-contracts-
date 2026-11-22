import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PayerDashboard } from "./components/PayerDashboard";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <PayerDashboard />
  </ErrorBoundary>
);