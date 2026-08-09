import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useData } from '../api/useData';
import { dispatchGlobalRefresh } from '../api/refreshCoordinator';
import { fetchRefreshStatus, isManualRefreshConfigured, requestManualRefresh } from '../api/client';
import type { Meta } from '../types/contracts';
import { GLOBAL_STATUS_LABEL } from '../lib/sources';
import { fmtRelative } from '../lib/format';
import { useTheme } from '../lib/theme';
import { Badge } from './ui';
import { Icon, type IconName } from './Icon';
import { AppFooter } from './AppFooter';
import { BrandMark } from './BrandMark';
import { MobileNavigation } from './MobileNavigation';
import { TopNavigation } from './TopNavigation';

export const BRAND = '媒體輿情監測';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '探索新聞',
    items: [
      { to: '/search', label: '新聞搜尋', icon: 'search' },
      { to: '/recent', label: '近期新聞', icon: 'newspaper' },
      { to: '/analysis', label: '進階分析', icon: 'scale' },
    ],
  },
  {
    label: '輿情分析',
    items: [
      { to: '/overview', label: '資料總覽', icon: 'layout' },
      { to: '/keywords', label: '關鍵字熱度', icon: 'flame' },
      { to: '/topics', label: '主題分類', icon: 'layers' },
      { to: '/entities', label: '組織', icon: 'network' },
    ],
  },
  {
    label: '資料說明',
    items: [{ to: '/method', label: '數據來源', icon: 'compass' }],
  },
];

const HOME_NAV: NavItem = { to: '/', label: '首頁', icon: 'layout', end: true };

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const icon: IconName = pref === 'system' ? 'monitor' : pref === 'light' ? 'sun' : 'moon';
  const label = pref === 'system' ? '跟隨系統' : pref === 'light' ? '淺色' : '深色';
  return (
    <button className="iconbtn" onClick={cycle} title={'主題：' + label + '（點擊切換）'} aria-label="切換主題">
      <Icon name={icon} size={18} />
    </button>
  );
}

function GlobalStatus() {
  const { data } = useData<Meta>('meta');
  if (!data) return null;
  const s = GLOBAL_STATUS_LABEL[data.status];
  return (
    <div className="appbar__status">
      <Badge variant={s.variant as never} dot>
        {s.label}
      </Badge>
      <span className="hide-sm">更新 {fmtRelative(data.lastFastAt)}</span>
    </div>
  );
}

function ManualRefreshButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    if (busy) return;
    setBusy(true);

    try {
      if (!isManualRefreshConfigured()) {
        // 沒有 Worker 時，瀏覽器無法安全地重抓來源，但仍可繞過快取取得
        // 排程剛發布的最新快照。訊息要說明實際做了什麼，不要暗示重新抓取。
        setMessage('已重新載入最新發布的資料（新聞每 5 分鐘自動更新）');
        dispatchGlobalRefresh({ reason: 'manual', bypassCache: true });
        window.setTimeout(() => setMessage(''), 4_000);
        return;
      }

      const request = await requestManualRefresh();
      setMessage('正在更新新聞…');

      let fastDone = false;
      let deepDone = false;

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await fetchRefreshStatus(request.refreshId);

        if (status.fast.status === 'completed' && !fastDone) {
          fastDone = true;
          setMessage('新聞已更新，正在同步分析…');
          dispatchGlobalRefresh({
            reason: 'manual',
            refreshId: request.refreshId,
            requestedAt: request.requestedAt,
            bypassCache: true,
          });
        }

        if (status.deep.status === 'completed') {
          deepDone = true;
          dispatchGlobalRefresh({
            reason: 'manual',
            refreshId: request.refreshId,
            requestedAt: request.requestedAt,
            bypassCache: true,
          });
          break;
        }

        // deep 為 unavailable（未設定 GitHub Token）或 failed 時不會再有進展，
        // 別讓使用者對著轉圈等滿 60 秒。
        if (status.deep.status === 'failed' || status.deep.status === 'unavailable') {
          break;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }

      if (fastDone && deepDone) {
        setMessage('全部資料已更新');
      } else if (fastDone) {
        setMessage('新聞已更新，部分分析資料仍在同步');
      } else {
        setMessage('更新未完成，系統仍會自動重試');
      }
      window.setTimeout(() => setMessage(''), 4_000);
    } catch (error) {
      // Worker 連不上、被節流或回應異常時，至少要把畫面上的資料重讀一次，
      // 否則按鈕看起來就像沒反應。
      dispatchGlobalRefresh({ reason: 'manual', bypassCache: true });
      setMessage((error as Error).message);
      window.setTimeout(() => setMessage(''), 4_000);
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? '更新中…' : '立即更新';
  return (
    <div className="appbar__refresh">
      <button
        className="refresh-btn"
        type="button"
        onClick={refresh}
        disabled={busy}
        aria-label="手動更新數據"
        title="重新載入最新輿情數據"
      >
        <Icon name="refresh" size={15} />
        <span className="refresh-btn__label">{label}</span>
      </button>
      {message && <span className="refresh-status toast-popover" role="status">{message}</span>}
    </div>
  );
}

export function Layout() {
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">跳至主要內容</a>
      <header className="appbar">
        <Link to="/" className="appbar__brand" aria-label="媒體輿情監測 - 回首頁">
          <BrandMark size="md" />
          <span>{BRAND}</span>
        </Link>
        <TopNavigation groups={NAV_GROUPS} />
        <div className="appbar__utilities">
          <GlobalStatus />
          <ManualRefreshButton />
          <ThemeToggle />
        </div>
      </header>

      <MobileNavigation groups={NAV_GROUPS} home={HOME_NAV} />

      <div className="layout">
        <main className="content" id="main-content">
          <Outlet />
          <AppFooter />
        </main>
      </div>
    </div>
  );
}
