import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import './styles/apple.css';
import { ThemeProvider } from './lib/theme';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LoadingState } from './components/ui';

const SearchPage = lazy(() => import('./pages/SearchPage').then(({ SearchPage: page }) => ({ default: page })));
const AdvancedAnalysisPage = lazy(() => import('./pages/AdvancedAnalysisPage').then(({ AdvancedAnalysisPage: page }) => ({ default: page })));
const RecentPage = lazy(() => import('./pages/RecentPage').then(({ RecentPage: page }) => ({ default: page })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then(({ OverviewPage: page }) => ({ default: page })));
const KeywordsPage = lazy(() => import('./pages/KeywordsPage').then(({ KeywordsPage: page }) => ({ default: page })));
const TopicsPage = lazy(() => import('./pages/TopicsPage').then(({ TopicsPage: page }) => ({ default: page })));
const EntitiesPage = lazy(() => import('./pages/EntitiesPage').then(({ EntitiesPage: page }) => ({ default: page })));
const MethodPage = lazy(() => import('./pages/MethodPage').then(({ MethodPage: page }) => ({ default: page })));

export function App() {
  return (
    <StrictMode>
      <ThemeProvider>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Suspense fallback={<LoadingState label="載入分析工具…" />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="analysis" element={<AdvancedAnalysisPage />} />
                <Route path="recent" element={<RecentPage />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="keywords" element={<KeywordsPage />} />
                <Route path="topics" element={<TopicsPage />} />
                <Route path="entities" element={<EntitiesPage />} />
                <Route path="method" element={<MethodPage />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
      </ThemeProvider>
    </StrictMode>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
