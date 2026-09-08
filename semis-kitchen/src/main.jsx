import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import "./index.css";
import App from "./App.jsx";
import LegalPage from "./components/LegalPage.jsx";
import { privacySections, termsSections } from "./content/legalContent.js";

const Admin = lazy(() => import("./Admin.jsx"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/privacy"
          element={<LegalPage title="Privacy Policy" description="How Semi's Kitchen collects, uses, stores, and protects customer information." canonicalPath="/privacy" sections={privacySections} />}
        />
        <Route
          path="/terms"
          element={<LegalPage title="Terms of Service" description="Ordering, payment, delivery, cancellation, refund, and food-safety terms for Semi's Kitchen." canonicalPath="/terms" sections={termsSections} />}
        />
        <Route
          path="/nashi"
          element={(
            <Suspense fallback={<div className="min-h-screen bg-green-950" aria-label="Loading admin dashboard" />}>
              <Admin />
            </Suspense>
          )}
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
