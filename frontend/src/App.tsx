import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { FarmSessionProvider } from "./lib/farmSession";
import { FarmPage } from "./pages/FarmPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProfilePicturePage } from "./pages/ProfilePicturePage";
import { TournamentsPage } from "./pages/TournamentsPage";

const AdminPage = lazy(async () => {
  const module = await import("./pages/AdminPage");
  return { default: module.AdminPage };
});

export default function App() {
  return (
    <FarmSessionProvider>
      <Layout>
        <Routes>
          <Route
            path="/admin"
            element={
              <Suspense fallback={<p className="muted">Loading admin…</p>}>
                <AdminPage />
              </Suspense>
            }
          />
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:tournamentId" element={<TournamentsPage />} />
          <Route path="/tournaments/:tournamentId/farm/:farmId" element={<FarmPage />} />
          <Route path="/records" element={<Navigate to="/tournaments" replace />} />
          <Route path="/records/:tournamentId" element={<Navigate to="/tournaments" replace />} />
          <Route path="/farm/:farmId" element={<FarmPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/picture" element={<ProfilePicturePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </FarmSessionProvider>
  );
}
