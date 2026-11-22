import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PayerDashboard } from "./components/PayerDashboard";
import { MerchantRegistrationWizard } from "./components/MerchantRegistrationWizard";

function App() {
  const [showMerchantWizard, setShowMerchantWizard] = useState(false);

  return (
    <>
      <PayerDashboard onRegisterAsMerchant={() => setShowMerchantWizard(true)} />
      {showMerchantWizard && (
        <MerchantRegistrationWizard onClose={() => setShowMerchantWizard(false)} />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);