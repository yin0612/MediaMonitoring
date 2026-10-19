export const NEWS_SOURCES = [
  { id: 'tvbs', displayName: 'TVBS', domains: ['news.tvbs.com.tw', 'tvbs.com.tw'], aliases: ['TVBS新聞網', 'TVBS'] },
  { id: 'ebc', displayName: '東森新聞', domains: ['news.ebc.net.tw', 'ebc.net.tw'], aliases: ['東森新聞', 'EBC東森新聞'] },
  { id: 'setn', displayName: '三立新聞', domains: ['setn.com', 'www.setn.com'], aliases: ['三立新聞網', '三立新聞網SETN.com', 'SETN'] },
  { id: 'ftv', displayName: '民視新聞', domains: ['ftvnews.com.tw', 'www.ftvnews.com.tw'], aliases: ['民視新聞網', '民視新聞'] },
  { id: 'cti', displayName: '中天新聞', domains: ['ctinews.com'], aliases: ['中天新聞網', '中天新聞'], rssUrl: 'https://ctinews.com/rss/google-news.xml' },
  { id: 'era', displayName: '年代新聞', domains: ['eracom.com.tw', 'www.eracom.com.tw'], aliases: ['年代新聞', '年代電視'] },
  { id: 'nexttv', displayName: '壹電視', domains: ['nexttv.com.tw', 'www.nexttv.com.tw'], aliases: ['壹電視', '壹新聞'], rssUrl: 'https://www.nexttv.com.tw/nRSS.xml' },
  { id: 'pts', displayName: '公視新聞', domains: ['news.pts.org.tw', 'pts.org.tw'], aliases: ['公視新聞網', '公視新聞網PNN', '公視新聞'], rssUrl: 'https://news.pts.org.tw/xml/newsfeed.xml' },
  { id: 'ttv', displayName: '台視新聞', domains: ['news.ttv.com.tw', 'ttv.com.tw'], aliases: ['台視新聞網', '台視新聞', '台視'] },
  { id: 'cts', displayName: '華視新聞', domains: ['news.cts.com.tw', 'cts.com.tw'], aliases: ['華視新聞網', '華視新聞', '華視'] },
  { id: 'udn', displayName: 'UDN', domains: ['udn.com', 'www.udn.com'], aliases: ['聯合新聞網', 'UDN'] },
  { id: 'ltn', displayName: '自由時報', domains: ['news.ltn.com.tw', 'ltn.com.tw', 'ec.ltn.com.tw'], aliases: ['自由時報', '自由電子報', '自由財經'], rssUrl: 'https://news.ltn.com.tw/rss/all.xml' },
  { id: 'cna', displayName: '中央社', domains: ['cna.com.tw', 'www.cna.com.tw'], aliases: ['中央社', '中央通訊社', '中央社 CNA', '中央社－產經證券', '中央社產經證券'] },
  { id: 'moneyudn', displayName: '經濟日報', domains: ['money.udn.com'], aliases: ['經濟日報'], rssUrl: 'https://money.udn.com/rssfeed/news/1001/5590?ch=money' },
  { id: 'ctee', displayName: '工商時報', domains: ['ctee.com.tw', 'www.ctee.com.tw'], aliases: ['工商時報'] },
  { id: 'anue', displayName: '鉅亨網', domains: ['news.cnyes.com', 'cnyes.com'], aliases: ['鉅亨網', 'Anue鉅亨'], rssUrl: 'https://news.cnyes.com/rss/v1/news/category/headline' },
  { id: 'wealth', displayName: '財訊', domains: ['wealth.com.tw', 'www.wealth.com.tw'], aliases: ['財訊', '財訊雙週刊'] },
  { id: 'businessweekly', displayName: '商業週刊', domains: ['businessweekly.com.tw', 'www.businessweekly.com.tw'], aliases: ['商業周刊', '商周'] },
  { id: 'thenewslens', displayName: '關鍵評論網', domains: ['thenewslens.com', 'www.thenewslens.com'], aliases: ['關鍵評論網', 'The News Lens'], rssUrl: 'https://www.thenewslens.com/feed/feedly' },
  { id: 'reporter', displayName: '報導者', domains: ['twreporter.org', 'www.twreporter.org', 'public.twreporter.org'], aliases: ['報導者', 'The Reporter'], rssUrl: 'https://www.twreporter.org/a/rss2.xml' },
  { id: 'newtalk', displayName: '新頭殼', domains: ['newtalk.tw'], aliases: ['新頭殼', 'Newtalk新聞'], rssUrl: 'https://newtalk.tw/rss/all/' },
  { id: 'nownews', displayName: 'NOWNEWS', domains: ['nownews.com', 'www.nownews.com'], aliases: ['NOWnews今日新聞', 'NOWNEWS今日新聞', 'NOWNEWS'] },
  { id: 'nextapple', displayName: '壹蘋新聞網', domains: ['tw.nextapple.com', 'news.nextapple.com', 'nextapple.com'], aliases: ['壹蘋新聞網', '壹蘋'], rssUrl: 'https://news.nextapple.com/api/rss/category/latest' },
  { id: 'ettoday', displayName: 'ETtoday', domains: ['ettoday.net', 'www.ettoday.net'], aliases: ['ETtoday新聞雲', 'ETtoday'], rssUrl: 'https://feeds.feedburner.com/ettoday/realtime' },
  { id: 'rti', displayName: '中央廣播電臺', domains: ['rti.org.tw', 'www.rti.org.tw'], aliases: ['中央廣播電臺', '中央廣播電台', 'Rti央廣'], rssUrl: 'https://www.rti.org.tw/rss' },
  { id: 'technews', displayName: '科技新報', domains: ['technews.tw', 'finance.technews.tw'], aliases: ['科技新報', 'TechNews'], rssUrl: 'https://technews.tw/feed/' },
  { id: 'taipeitimes', displayName: 'Taipei Times', domains: ['taipeitimes.com', 'www.taipeitimes.com'], aliases: ['Taipei Times', '台北時報'], rssUrl: 'https://www.taipeitimes.com/xml/index.rss' },
  { id: 'coolloud', displayName: '苦勞網', domains: ['coolloud.org.tw', 'www.coolloud.org.tw'], aliases: ['苦勞網'], rssUrl: 'https://www.coolloud.org.tw/rss.xml' },
  { id: 'tfc', displayName: '台灣事實查核中心', domains: ['tfc-taiwan.org.tw', 'www.tfc-taiwan.org.tw'], aliases: ['台灣事實查核中心', 'Taiwan FactCheck Center'], rssUrl: 'https://tfc-taiwan.org.tw/feed/' },
  { id: 'moneydj', displayName: 'MoneyDJ 理財網', domains: ['moneydj.com', 'www.moneydj.com', 'fund.moneydj.com'], aliases: ['MoneyDJ理財網', 'MoneyDJ', '理財網'] },
  { id: 'businesstoday', displayName: '今周刊', domains: ['businesstoday.com.tw', 'www.businesstoday.com.tw'], aliases: ['今周刊', 'BusinessToday'] },
  { id: 'bnext', displayName: '數位時代', domains: ['bnext.com.tw', 'www.bnext.com.tw'], aliases: ['數位時代', 'BusinessNext', 'BNext'], rssUrl: 'https://www.bnext.com.tw/rss' },
  { id: 'managertoday', displayName: '經理人', domains: ['managertoday.com.tw', 'www.managertoday.com.tw'], aliases: ['經理人', 'ManagerToday', '經理人月刊'], rssUrl: 'https://www.managertoday.com.tw/rss' },
  { id: 'chinatimes', displayName: '中時新聞網', domains: ['chinatimes.com', 'www.chinatimes.com'], aliases: ['中時新聞網', '中國時報', '中時'] },
  { id: 'ctwant', displayName: 'CTWANT', domains: ['ctwant.com', 'www.ctwant.com'], aliases: ['CTWANT', '周刊王', 'CTWANT新聞'] },
  { id: 'mnews', displayName: '鏡新聞', domains: ['mnews.tw', 'www.mnews.tw'], aliases: ['鏡新聞', 'MNews'] },
  { id: 'mirrormedia', displayName: '鏡週刊', domains: ['mirrormedia.mg', 'www.mirrormedia.mg'], aliases: ['鏡週刊', 'Mirror Media', '鏡週刊Mirror Media'] },
  { id: 'investor', displayName: '財訊快報', domains: ['investor.com.tw', 'www.investor.com.tw'], aliases: ['財訊快報'] },
  { id: 'wantrich', displayName: '旺得富', domains: ['wantrich.chinatimes.com'], aliases: ['旺得富', '旺得富理財網'] },
  { id: 'moneylink', displayName: '富聯網', domains: ['money-link.com.tw', 'ww2.money-link.com.tw', 'www.money-link.com.tw'], aliases: ['富聯網'] },
  { id: 'watchmedia', displayName: '觀傳媒', domains: ['watchmedia01.com', 'www.watchmedia01.com'], aliases: ['觀傳媒'], rssUrl: 'https://www.watchmedia01.com/feed/' },
  { id: 'taiwantimes', displayName: '臺灣時報', domains: ['taiwantimes.com.tw', 'www.taiwantimes.com.tw'], aliases: ['臺灣時報', '台灣時報', 'Taiwan Times'] },
  { id: 'turnnews', displayName: '翻報', domains: ['turnnewsapp.com', 'www.turnnewsapp.com', 'reader.turnnewsapp.com'], aliases: ['翻報', '翻爆', '翻爆 - 翻報'] },
  { id: 'cdns', displayName: '中華日報', domains: ['cdns.com.tw', 'www.cdns.com.tw'], aliases: ['中華日報', '中華新聞雲'], rssUrl: 'https://www.cdns.com.tw/feed' },
  { id: 'yesmedia', displayName: '是新聞 YesMedia', domains: ['yesmedia.com.tw', 'www.yesmedia.com.tw'], aliases: ['是新聞', '是新聞網', 'Yes新聞', '是新聞 YesMedia', 'YesMedia'] },
  { id: 'gbyhn', displayName: '敗家達人', domains: ['gbyhn.com.tw', 'www.gbyhn.com.tw'], aliases: ['敗家達人', '敗家達人推薦'], rssUrl: 'https://www.gbyhn.com.tw/feed' },
  { id: 'thehubnews', displayName: '新頭條', domains: ['thehubnews.net', 'www.thehubnews.net'], aliases: ['新頭條', '新頭條新聞', '新頭條-TheHubNews', 'TheHubNews'], rssUrl: 'https://www.thehubnews.net/feed' },
  { id: 'uanalyze', displayName: '優分析', domains: ['uanalyze.com.tw', 'www.uanalyze.com.tw'], aliases: ['優分析', '優分析UAnalyze', 'UAnalyze'] },
  { id: 'nstock', displayName: 'nStock', domains: ['nstock.tw', 'www.nstock.tw'], aliases: ['nStock', 'nStock新聞'] },
  { id: 'leho', displayName: '樂聯網', domains: ['leho.com.tw', 'www.leho.com.tw'], aliases: ['樂聯網'], rssUrl: 'https://leho.com.tw/feed' },
  { id: 'stockltn', displayName: '財富自由', domains: ['stock.ltn.com.tw'], aliases: ['財富自由', '自由時報財富自由'] },
  { id: 'renews', displayName: '短傳媒', domains: ['re-news.tw', 'www.re-news.tw'], aliases: ['短傳媒', '短傳媒 re-news.tw'] },
  { id: 'technice', displayName: '科技島', domains: ['technice.com.tw', 'www.technice.com.tw'], aliases: ['科技島', '科技島TechNice', 'TechNice'], rssUrl: 'https://www.technice.com.tw/feed/' },
  { id: 'xfastest', displayName: 'XFastest', domains: ['news.xfastest.com', 'www.xfastest.com', 'xfastest.com'], aliases: ['XFastest', 'XFastest News', 'XFastest最夯的電腦領域'], rssUrl: 'https://news.xfastest.com/feed/' },
  { id: 'cardu', displayName: '卡優新聞網', domains: ['cardu.com.tw', 'www.cardu.com.tw'], aliases: ['卡優新聞網', '卡優新聞', '卡優'], rssUrl: 'https://www.cardu.com.tw/rss/cardurss.xml' },
  { id: 'knews', displayName: '知新聞', domains: ['knews.com.tw', 'www.knews.com.tw'], aliases: ['知新聞', 'Knews'] },
  { id: 'linetoday', displayName: 'LINE TODAY', domains: ['today.line.me'], aliases: ['LINE TODAY', 'LINE TODAY Taiwan'] },
  { id: 'yahoonews', displayName: 'Yahoo新聞', domains: ['tw.news.yahoo.com'], aliases: ['Yahoo新聞', 'Yahoo奇摩新聞', 'Yahoo奇摩新聞（即時新聞）'], rssUrl: 'https://tw.news.yahoo.com/rss', viaPages: true },
  { id: 'yahoostock', displayName: 'Yahoo股市', domains: ['tw.stock.yahoo.com'], aliases: ['Yahoo股市', 'Yahoo奇摩股市'], rssUrl: 'https://tw.stock.yahoo.com/rss', viaPages: true },
  { id: 'pchomenews', displayName: 'PChome新聞', domains: ['news.pchome.com.tw'], aliases: ['PChome新聞', 'PChome Online新聞', 'PChome Online 新聞'], rssUrl: 'https://news.pchome.com.tw/articles/Feed-Google', viaPages: true },
  { id: 'pchomestock', displayName: 'PChome股市', domains: ['stock.pchome.com.tw', 'pchome.megatime.com.tw'], aliases: ['PChome股市', 'PChome 股市', 'PChome Online 股市'] },
  { id: 'yam', displayName: '蕃新聞 yamNews', domains: ['n.yam.com'], aliases: ['蕃新聞', '蕃新聞 yamNews', 'yamNews', '蕃薯藤新聞'] },
];

// 官方 RSS 補充：來源名稱與白名單維持單一登錄，RSS 可用多個分類 feed 合併。
const OFFICIAL_RSS_AUGMENTS = {
  cna: { rssUrls: [
    'https://feeds.feedburner.com/rsscna/politics',
    'https://feeds.feedburner.com/rsscna/local',
    'https://feeds.feedburner.com/rsscna/social',
    'https://feeds.feedburner.com/rsscna/finance',
    'https://feeds.feedburner.com/rsscna/technology',
    'https://feeds.feedburner.com/rsscna/lifehealth',
  ] },
  businessweekly: { rssUrl: 'https://www.businessweekly.com.tw/feedsec.aspx?feedid=1&channelid=4' },
};
for (const source of NEWS_SOURCES) Object.assign(source, OFFICIAL_RSS_AUGMENTS[source.id]);

const normalized = (value) => String(value || '').replace(/\s+/g, '').toLocaleLowerCase('zh-TW');

export function sourceForGoogleNews(name, sourceUrl, sources = NEWS_SOURCES) {
  let hostname = '';
  try {
    hostname = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    hostname = '';
  }
  const normalizedName = normalized(name);
  // Prefer the most specific host: stock.ltn.com.tw and wantrich.chinatimes.com
  // are distinct channels even though their parent publishers are allowlisted.
  let hostMatch = null;
  let specificity = 0;
  for (const source of sources) {
    for (const domain of source.domains) {
      if ((hostname === domain || hostname.endsWith(`.${domain}`)) && domain.length > specificity) {
        hostMatch = source;
        specificity = domain.length;
      }
    }
  }
  return hostMatch || sources.find((source) =>
    source.aliases.some((alias) => normalized(alias) === normalizedName),
  ) || null;
}
