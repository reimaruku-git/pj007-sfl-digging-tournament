import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { FarmPage } from "./pages/FarmPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";

const AdminPage = lazy(async () => {
  const module = await import("./pages/AdminPage");
  return { default: module.AdminPage };
});

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<LeaderboardPage />} />
        <Route path="/farm/:farmId" element={<FarmPage />} />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<p className="muted">Loading admin…</p>}>
              <AdminPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
