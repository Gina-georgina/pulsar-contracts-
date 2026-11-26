import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PayerDashboard } from "./components/PayerDashboard";
import { MobileNav } from "./components/MobileNav";
import "./styles/theme.css";

const navItems = [
  { label: "Dashboard", href: "#dashboard" },
  { label: "Payers", href: "#payers" },
  { label: "Claims", href: "#claims" },
  { label: "Settings", href: "#settings" },
];

createRoot(document.getElementById("root")!).render(
  <>
    <MobileNav items={navItems} />
    <PayerDashboard />
  </>
);
