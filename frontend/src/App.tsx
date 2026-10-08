import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LangProvider } from './i18n';
import { AuthProvider, RequireRole, Toasts } from './auth';
import { CommandMenu } from './components/ui/CommandMenu';
import { AppShell } from './components/layout/AppShell';
import { Home } from './pages/Home';
import { SearchPage } from './pages/Search';
import { Tournaments } from './pages/Tournaments';
import { TournamentDetail } from './pages/TournamentDetail';
import { Athletes, AthleteDetail, Rankings, Clubs, ClubDetail, LiveAll } from './pages/Lists';
import { TvBoard } from './pages/TvReferee';
import { Organizer } from './pages/Organizer';
import { Admin } from './pages/Admin';
import { Verify, News, NewsDetail, NewsEditor } from './pages/Documents';
import { Notifications } from './pages/Notifications';
import { CoachDirectory } from './pages/CoachDirectory';
import { CoachProfile } from './pages/CoachProfile';
import { AthleteHome } from './pages/AthleteHome';
import { GuardianHome } from './pages/GuardianHome';
import { CoachHome } from './pages/CoachHome';
import { RefereeHome } from './pages/RefereeHome';
import { OrganizerHome } from './pages/OrganizerHome';
import { MeDispatcher } from './pages/MeDispatcher';
import { Cabinet } from './pages/Cabinet';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

function NotFound() {
  return (
    <div className="card p-8 text-center max-w-md mx-auto fade-up space-y-3">
      <div className="display text-4xl font-semibold">404</div>
      <Link to="/" className="btn-primary text-sm justify-center">KWF</Link>
    </div>
  );
}

export default function App() {
  const [cmdk, setCmdk] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdk(v => !v); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <QueryClientProvider client={qc}>
      <LangProvider>
        <AuthProvider>
        <BrowserRouter>
          <AppShell onCmdk={() => setCmdk(true)}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/tournaments" element={<Tournaments />} />
              <Route path="/tournaments/:id" element={<TournamentDetail />} />
              <Route path="/athletes" element={<Athletes />} />
              <Route path="/athletes/:id" element={<AthleteDetail />} />
              <Route path="/rankings" element={<Rankings />} />
              <Route path="/clubs" element={<Clubs />} />
              <Route path="/clubs/:id" element={<ClubDetail />} />
              <Route path="/coaches" element={<CoachDirectory />} />
              <Route path="/coaches/:id" element={<CoachProfile />} />
              <Route path="/live" element={<LiveAll />} />
              <Route path="/tv/:id" element={<TvBoard />} />
              {/* Role homes — one product, six work environments */}
              <Route path="/athlete" element={<RequireRole roles={['athlete']}><AthleteHome /></RequireRole>} />
              <Route path="/guardian" element={<RequireRole><GuardianHome /></RequireRole>} />
              <Route path="/coach" element={<RequireRole roles={['coach']}><CoachHome /></RequireRole>} />
              <Route path="/referee" element={<RequireRole roles={['referee', 'organizer']} perm="matches.manage"><RefereeHome /></RequireRole>} />
              <Route path="/organizer" element={<RequireRole perm="tournaments.manage"><OrganizerHome /></RequireRole>} />
              <Route path="/organizer/new" element={<RequireRole perm="tournaments.manage"><Organizer /></RequireRole>} />
              <Route path="/me" element={<MeDispatcher />} />
              {/* Legacy cabinet: compat layer, no longer the center of the app */}
              <Route path="/cabinet" element={<RequireRole><Cabinet /></RequireRole>} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/dashboard" element={<Navigate to="/me" replace />} />
              <Route path="/login" element={<Navigate to="/me" replace />} />
              <Route path="/register" element={<Navigate to="/me" replace />} />
              <Route path="/profile" element={<Navigate to="/me" replace />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/verify/:code" element={<Verify />} />
              <Route path="/news" element={<News />} />
              <Route path="/news/new" element={<RequireRole perm="news.manage"><NewsEditor /></RequireRole>} />
              <Route path="/news/:slug" element={<NewsDetail />} />
              <Route path="/admin/*" element={<RequireRole roles={['admin']}><Admin /></RequireRole>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
          <CommandMenu open={cmdk} onClose={() => setCmdk(false)} />
          <Toasts />
        </BrowserRouter>
        </AuthProvider>
      </LangProvider>
    </QueryClientProvider>
  );
}

