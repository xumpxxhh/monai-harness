import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { ConsoleLayout } from "./layout/ConsoleLayout";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConsoleLayout />} />
        <Route path="/runs/:runId" element={<ConsoleLayout />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
