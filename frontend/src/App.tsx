import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/AdminPage";
import { FarmPage } from "./pages/FarmPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<LeaderboardPage />} />
        <Route path="/farm/:farmId" element={<FarmPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
