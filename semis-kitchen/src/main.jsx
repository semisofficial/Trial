import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import "./index.css";
import App from "./App.jsx";

const Admin = lazy(() => import("./Admin.jsx"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
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
