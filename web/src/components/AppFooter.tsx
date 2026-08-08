import { Link } from 'react-router-dom';

export function AppFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>媒體輿情監測</strong>
        <span>公開新聞資料分析工具，不代表整體民意。</span>
      </div>
      <nav aria-label="頁尾導覽">
        <Link to="/method">方法與來源</Link>
      </nav>
      <p>僅呈現標題、短前言、時間與原文連結；更新採 best effort。</p>
    </footer>
  );
}
