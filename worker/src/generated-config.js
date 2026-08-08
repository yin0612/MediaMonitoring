// 自動產生檔，請勿手改。來源：config/ 下的 watch_terms.yml、entities.yml、sentiment.yml；重跑 `npm run gen-config`。
export const WATCH_TERMS = [
  {
    "id": "tsmc",
    "display": "台積電",
    "anyOf": [
      "台積電",
      "台積",
      "TSMC",
      "護國神山"
    ],
    "exclude": []
  },
  {
    "id": "legislature",
    "display": "立法院",
    "anyOf": [
      "立法院",
      "立院",
      "朝野協商"
    ],
    "exclude": []
  },
  {
    "id": "typhoon",
    "display": "颱風",
    "anyOf": [
      "颱風",
      "熱帶低壓",
      "颱風假",
      "停班停課"
    ],
    "exclude": []
  },
  {
    "id": "power_price",
    "display": "電價",
    "anyOf": [
      "電價",
      "電費",
      "台電"
    ],
    "exclude": []
  },
  {
    "id": "exchange_rate",
    "display": "台幣匯率",
    "anyOf": [
      "台幣",
      "新台幣",
      "匯率"
    ],
    "exclude": []
  },
  {
    "id": "housing",
    "display": "房價",
    "anyOf": [
      "房價",
      "房市",
      "打房"
    ],
    "exclude": []
  },
  {
    "id": "cabinet",
    "display": "行政院",
    "anyOf": [
      "行政院",
      "政院",
      "閣揆",
      "行政院長"
    ],
    "exclude": []
  },
  {
    "id": "president",
    "display": "總統府",
    "anyOf": [
      "總統府",
      "總統宣布",
      "國安高層"
    ],
    "exclude": []
  },
  {
    "id": "election",
    "display": "選舉",
    "anyOf": [
      "選舉",
      "選情",
      "民調",
      "罷免",
      "參選"
    ],
    "exclude": []
  },
  {
    "id": "budget",
    "display": "中央預算",
    "anyOf": [
      "總預算",
      "中央預算",
      "預算案",
      "追加預算"
    ],
    "exclude": []
  },
  {
    "id": "cross_strait",
    "display": "兩岸關係",
    "anyOf": [
      "兩岸",
      "對岸",
      "中共",
      "國台辦",
      "陸委會"
    ],
    "exclude": []
  },
  {
    "id": "defense",
    "display": "國防安全",
    "anyOf": [
      "國防部",
      "共軍",
      "軍演",
      "漢光",
      "國軍"
    ],
    "exclude": []
  },
  {
    "id": "diplomacy",
    "display": "外交",
    "anyOf": [
      "外交部",
      "邦交",
      "訪台",
      "出訪"
    ],
    "exclude": []
  },
  {
    "id": "stock_market",
    "display": "台股",
    "anyOf": [
      "台股",
      "加權指數",
      "集中市場"
    ],
    "exclude": []
  },
  {
    "id": "ai_tech",
    "display": "AI 產業",
    "anyOf": [
      "人工智慧",
      "生成式AI",
      "AI晶片",
      "輝達",
      "NVIDIA"
    ],
    "exclude": []
  },
  {
    "id": "tariff",
    "display": "關稅貿易",
    "anyOf": [
      "關稅",
      "貿易戰",
      "對等關稅",
      "出口管制"
    ],
    "exclude": []
  },
  {
    "id": "labor",
    "display": "勞工權益",
    "anyOf": [
      "勞動部",
      "基本工資",
      "勞保",
      "缺工"
    ],
    "exclude": []
  },
  {
    "id": "health",
    "display": "醫療衛生",
    "anyOf": [
      "衛福部",
      "健保",
      "疫苗",
      "流感",
      "疫情"
    ],
    "exclude": []
  },
  {
    "id": "education",
    "display": "教育",
    "anyOf": [
      "教育部",
      "學費",
      "校園",
      "課綱"
    ],
    "exclude": []
  },
  {
    "id": "food_safety",
    "display": "食安",
    "anyOf": [
      "食安",
      "食品安全",
      "違規添加",
      "農藥殘留"
    ],
    "exclude": []
  },
  {
    "id": "transport",
    "display": "交通",
    "anyOf": [
      "交通部",
      "國道",
      "高鐵",
      "台鐵",
      "車禍"
    ],
    "exclude": []
  },
  {
    "id": "energy",
    "display": "能源",
    "anyOf": [
      "核電",
      "核三",
      "綠電",
      "光電",
      "供電"
    ],
    "exclude": []
  },
  {
    "id": "disaster",
    "display": "地震與災害",
    "anyOf": [
      "地震",
      "豪雨",
      "淹水",
      "土石流",
      "停水"
    ],
    "exclude": []
  },
  {
    "id": "crime",
    "display": "治安與司法",
    "anyOf": [
      "檢方",
      "起訴",
      "詐騙",
      "毒品",
      "判刑"
    ],
    "exclude": []
  }
];

export const AUTO_TERMS = {
  "maxTerms": 30,
  "minDocs": 3,
  "minSources": 3,
  "minLength": 2,
  "stopwords": [
    "快訊",
    "影",
    "圖",
    "獨家",
    "直播",
    "專訪",
    "報導",
    "新聞",
    "今日",
    "昨日",
    "記者",
    "表示",
    "指出",
    "一名",
    "民眾",
    "台灣",
    "相關",
    "最新",
    "曝光",
    "關鍵",
    "國際",
    "速報",
    "快報",
    "影音",
    "直擊",
    "盤點",
    "回顧",
    "完整",
    "一次看",
    "懶人包",
    "網友",
    "這些",
    "竟然",
    "台北",
    "北市",
    "北市府",
    "台北市",
    "新北",
    "新北市",
    "台中",
    "中市",
    "中市府",
    "台南",
    "南市",
    "高雄",
    "高市",
    "高市府",
    "桃園",
    "桃市",
    "新竹",
    "竹市",
    "竹縣",
    "基隆",
    "基市",
    "宜蘭",
    "花蓮",
    "台東",
    "屏東",
    "嘉義",
    "彰化",
    "南投",
    "雲林",
    "苗栗",
    "縣府",
    "市府",
    "全台",
    "全縣",
    "全市",
    "台灣",
    "國內",
    "國外",
    "中央",
    "地方",
    "政治",
    "社會",
    "生活",
    "財經",
    "體育",
    "娛樂",
    "天氣",
    "地方",
    "健康",
    "調查",
    "宣布",
    "證實",
    "回應",
    "分析",
    "沒有",
    "因為",
    "可能",
    "日報",
    "時報",
    "週刊",
    "電子報",
    "雜誌",
    "目標價",
    "評等",
    "除息",
    "除權",
    "開盤",
    "收盤",
    "早盤",
    "盤中",
    "盤後",
    "法人",
    "外資",
    "個股",
    "選股",
    "今彩",
    "威力彩",
    "大樂透",
    "雙贏彩",
    "樂合彩",
    "三星彩",
    "四星彩",
    "開獎",
    "中獎",
    "頭獎",
    "獎號",
    "部落",
    "網紅",
    "經濟",
    "政院",
    "半年",
    "上半",
    "下半",
    "今年",
    "明年",
    "去年",
    "億元",
    "萬元",
    "美元",
    "台幣",
    "新台幣",
    "億美",
    "億台幣",
    "百萬",
    "千萬",
    "近億",
    "月營收",
    "營收",
    "年增",
    "月增",
    "季增",
    "累積營收",
    "獲利",
    "淨利",
    "毛利率",
    "營業額",
    "財報",
    "盈餘",
    "每股盈餘",
    "每股",
    "EPS",
    "稅後",
    "新高",
    "新低",
    "創下",
    "暴漲",
    "暴跌",
    "飆漲",
    "重挫",
    "漲停",
    "跌停",
    "大漲",
    "大跌",
    "亮眼",
    "表現",
    "挑戰",
    "突破",
    "衝破",
    "雙增",
    "三增",
    "亮麗",
    "股價",
    "概念股",
    "法說會",
    "投信",
    "自營商",
    "買超",
    "賣超",
    "籌碼"
  ]
};

export const ENTITY_LEXICON = [
  {
    "name": "總統府",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "行政院",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "立法院",
    "aliases": [
      "立院"
    ],
    "type": "ORG"
  },
  {
    "name": "司法院",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "監察院",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "考試院",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "國防部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "外交部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "內政部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "經濟部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "財政部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "交通部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "教育部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "勞動部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "法務部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "環境部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "文化部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "數位發展部",
    "aliases": [
      "數發部"
    ],
    "type": "ORG"
  },
  {
    "name": "衛福部",
    "aliases": [
      "衛生福利部"
    ],
    "type": "ORG"
  },
  {
    "name": "農業部",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "陸委會",
    "aliases": [
      "大陸委員會"
    ],
    "type": "ORG"
  },
  {
    "name": "國發會",
    "aliases": [
      "國家發展委員會"
    ],
    "type": "ORG"
  },
  {
    "name": "金管會",
    "aliases": [
      "金融監督管理委員會"
    ],
    "type": "ORG"
  },
  {
    "name": "公平會",
    "aliases": [
      "公平交易委員會"
    ],
    "type": "ORG"
  },
  {
    "name": "NCC",
    "aliases": [
      "國家通訊傳播委員會"
    ],
    "type": "ORG"
  },
  {
    "name": "中選會",
    "aliases": [
      "中央選舉委員會"
    ],
    "type": "ORG"
  },
  {
    "name": "中央銀行",
    "aliases": [
      "央行"
    ],
    "type": "ORG"
  },
  {
    "name": "中央氣象署",
    "aliases": [
      "氣象署"
    ],
    "type": "ORG"
  },
  {
    "name": "疾管署",
    "aliases": [
      "疾病管制署"
    ],
    "type": "ORG"
  },
  {
    "name": "健保署",
    "aliases": [
      "中央健康保險署"
    ],
    "type": "ORG"
  },
  {
    "name": "食藥署",
    "aliases": [
      "食品藥物管理署"
    ],
    "type": "ORG"
  },
  {
    "name": "國稅局",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "警政署",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "消防署",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "海巡署",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "移民署",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "台北市政府",
    "aliases": [
      "北市府"
    ],
    "type": "ORG"
  },
  {
    "name": "新北市政府",
    "aliases": [
      "新北市府"
    ],
    "type": "ORG"
  },
  {
    "name": "台中市政府",
    "aliases": [
      "中市府"
    ],
    "type": "ORG"
  },
  {
    "name": "台南市政府",
    "aliases": [
      "南市府"
    ],
    "type": "ORG"
  },
  {
    "name": "高雄市政府",
    "aliases": [
      "高市府"
    ],
    "type": "ORG"
  },
  {
    "name": "桃園市政府",
    "aliases": [
      "桃市府"
    ],
    "type": "ORG"
  },
  {
    "name": "民進黨",
    "aliases": [
      "民主進步黨"
    ],
    "type": "ORG"
  },
  {
    "name": "國民黨",
    "aliases": [
      "中國國民黨"
    ],
    "type": "ORG"
  },
  {
    "name": "民眾黨",
    "aliases": [
      "台灣民眾黨"
    ],
    "type": "ORG"
  },
  {
    "name": "時代力量",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "台電",
    "aliases": [
      "台灣電力公司"
    ],
    "type": "ORG"
  },
  {
    "name": "中油",
    "aliases": [
      "台灣中油"
    ],
    "type": "ORG"
  },
  {
    "name": "台水",
    "aliases": [
      "台灣自來水公司"
    ],
    "type": "ORG"
  },
  {
    "name": "台鐵",
    "aliases": [
      "台灣鐵路"
    ],
    "type": "ORG"
  },
  {
    "name": "高鐵",
    "aliases": [
      "台灣高鐵"
    ],
    "type": "ORG"
  },
  {
    "name": "桃園機場",
    "aliases": [
      "桃機"
    ],
    "type": "ORG"
  },
  {
    "name": "華航",
    "aliases": [
      "中華航空"
    ],
    "type": "ORG"
  },
  {
    "name": "長榮航空",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "星宇航空",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "台積電",
    "aliases": [
      "TSMC",
      "台灣積體電路"
    ],
    "type": "ORG"
  },
  {
    "name": "鴻海",
    "aliases": [
      "Foxconn",
      "富士康"
    ],
    "type": "ORG"
  },
  {
    "name": "聯發科",
    "aliases": [
      "MediaTek"
    ],
    "type": "ORG"
  },
  {
    "name": "聯電",
    "aliases": [
      "UMC"
    ],
    "type": "ORG"
  },
  {
    "name": "日月光",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "廣達",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "緯創",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "華碩",
    "aliases": [
      "ASUS"
    ],
    "type": "ORG"
  },
  {
    "name": "宏碁",
    "aliases": [
      "acer"
    ],
    "type": "ORG"
  },
  {
    "name": "長榮海運",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "陽明海運",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "萬海",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "中華電信",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "台灣大哥大",
    "aliases": [
      "台灣大"
    ],
    "type": "ORG"
  },
  {
    "name": "遠傳",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "國泰金",
    "aliases": [
      "國泰金控"
    ],
    "type": "ORG"
  },
  {
    "name": "富邦金",
    "aliases": [
      "富邦金控"
    ],
    "type": "ORG"
  },
  {
    "name": "中信金",
    "aliases": [
      "中信金控",
      "中國信託"
    ],
    "type": "ORG"
  },
  {
    "name": "玉山金",
    "aliases": [
      "玉山銀行"
    ],
    "type": "ORG"
  },
  {
    "name": "兆豐金",
    "aliases": [
      "兆豐銀行"
    ],
    "type": "ORG"
  },
  {
    "name": "輝達",
    "aliases": [
      "NVIDIA"
    ],
    "type": "ORG"
  },
  {
    "name": "OpenAI",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "Google",
    "aliases": [
      "谷歌"
    ],
    "type": "ORG"
  },
  {
    "name": "蘋果",
    "aliases": [
      "Apple"
    ],
    "type": "ORG"
  },
  {
    "name": "微軟",
    "aliases": [
      "Microsoft"
    ],
    "type": "ORG"
  },
  {
    "name": "Meta",
    "aliases": [],
    "type": "ORG"
  },
  {
    "name": "亞馬遜",
    "aliases": [
      "Amazon"
    ],
    "type": "ORG"
  },
  {
    "name": "特斯拉",
    "aliases": [
      "Tesla"
    ],
    "type": "ORG"
  },
  {
    "name": "三星",
    "aliases": [
      "Samsung"
    ],
    "type": "ORG"
  },
  {
    "name": "英特爾",
    "aliases": [
      "Intel"
    ],
    "type": "ORG"
  },
  {
    "name": "賴清德",
    "aliases": [
      "賴總統"
    ],
    "type": "PERSON"
  },
  {
    "name": "蕭美琴",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "卓榮泰",
    "aliases": [
      "卓揆"
    ],
    "type": "PERSON"
  },
  {
    "name": "韓國瑜",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "鄭麗文",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "黃國昌",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "柯文哲",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "馬英九",
    "aliases": [
      "馬前總統"
    ],
    "type": "PERSON"
  },
  {
    "name": "蘇貞昌",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "顧立雄",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "劉世芳",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "沈伯洋",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "徐巧芯",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "王世堅",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "賴瑞隆",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "蔣萬安",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "盧秀燕",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "侯友宜",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "陳其邁",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "黃仁勳",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "魏哲家",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "郭台銘",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "馬斯克",
    "aliases": [
      "Elon Musk"
    ],
    "type": "PERSON"
  },
  {
    "name": "川普",
    "aliases": [
      "Donald Trump"
    ],
    "type": "PERSON"
  },
  {
    "name": "習近平",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "王毅",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "普丁",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "澤倫斯基",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "高市早苗",
    "aliases": [],
    "type": "PERSON"
  },
  {
    "name": "李在明",
    "aliases": [],
    "type": "PERSON"
  }
];

export const SENTIMENT_LEXICON = {
  "positive": [
    {
      "term": "成長",
      "weight": 1
    },
    {
      "term": "上漲",
      "weight": 1
    },
    {
      "term": "大漲",
      "weight": 2
    },
    {
      "term": "飆升",
      "weight": 2
    },
    {
      "term": "獲利",
      "weight": 1
    },
    {
      "term": "創高",
      "weight": 2
    },
    {
      "term": "新高",
      "weight": 2
    },
    {
      "term": "回升",
      "weight": 1
    },
    {
      "term": "看好",
      "weight": 1
    },
    {
      "term": "樂觀",
      "weight": 1
    },
    {
      "term": "增加",
      "weight": 1
    },
    {
      "term": "擴大投資",
      "weight": 1
    },
    {
      "term": "加薪",
      "weight": 1
    },
    {
      "term": "減稅",
      "weight": 1
    },
    {
      "term": "補助",
      "weight": 1
    },
    {
      "term": "成功",
      "weight": 1
    },
    {
      "term": "突破",
      "weight": 2
    },
    {
      "term": "奪冠",
      "weight": 2
    },
    {
      "term": "奪金",
      "weight": 2
    },
    {
      "term": "獲獎",
      "weight": 1
    },
    {
      "term": "締造",
      "weight": 1
    },
    {
      "term": "改善",
      "weight": 1
    },
    {
      "term": "進步",
      "weight": 1
    },
    {
      "term": "通過",
      "weight": 1
    },
    {
      "term": "達成",
      "weight": 1
    },
    {
      "term": "完工",
      "weight": 1
    },
    {
      "term": "啟用",
      "weight": 1
    },
    {
      "term": "復原",
      "weight": 1
    },
    {
      "term": "康復",
      "weight": 1
    },
    {
      "term": "獲救",
      "weight": 2
    },
    {
      "term": "平安",
      "weight": 1
    },
    {
      "term": "順利",
      "weight": 1
    },
    {
      "term": "肯定",
      "weight": 1
    },
    {
      "term": "支持",
      "weight": 1
    },
    {
      "term": "感謝",
      "weight": 1
    },
    {
      "term": "歡迎",
      "weight": 1
    },
    {
      "term": "合作",
      "weight": 1
    },
    {
      "term": "和解",
      "weight": 1
    },
    {
      "term": "力挺",
      "weight": 1
    },
    {
      "term": "好評",
      "weight": 1
    },
    {
      "term": "熱銷",
      "weight": 1
    },
    {
      "term": "看漲",
      "weight": 1
    },
    {
      "term": "優惠",
      "weight": 1
    },
    {
      "term": "升級",
      "weight": 1
    },
    {
      "term": "領先",
      "weight": 1
    },
    {
      "term": "奪下",
      "weight": 1
    }
  ],
  "negative": [
    {
      "term": "下跌",
      "weight": 1
    },
    {
      "term": "大跌",
      "weight": 2
    },
    {
      "term": "暴跌",
      "weight": 2
    },
    {
      "term": "重挫",
      "weight": 2
    },
    {
      "term": "虧損",
      "weight": 2
    },
    {
      "term": "衰退",
      "weight": 2
    },
    {
      "term": "下滑",
      "weight": 1
    },
    {
      "term": "減少",
      "weight": 1
    },
    {
      "term": "裁員",
      "weight": 2
    },
    {
      "term": "失業",
      "weight": 2
    },
    {
      "term": "倒閉",
      "weight": 2
    },
    {
      "term": "破產",
      "weight": 2
    },
    {
      "term": "停業",
      "weight": 1
    },
    {
      "term": "漲價",
      "weight": 1
    },
    {
      "term": "通膨",
      "weight": 1
    },
    {
      "term": "看壞",
      "weight": 1
    },
    {
      "term": "悲觀",
      "weight": 1
    },
    {
      "term": "死亡",
      "weight": 2
    },
    {
      "term": "罹難",
      "weight": 2
    },
    {
      "term": "死傷",
      "weight": 2
    },
    {
      "term": "傷亡",
      "weight": 2
    },
    {
      "term": "受傷",
      "weight": 1
    },
    {
      "term": "車禍",
      "weight": 2
    },
    {
      "term": "火警",
      "weight": 2
    },
    {
      "term": "火災",
      "weight": 2
    },
    {
      "term": "爆炸",
      "weight": 2
    },
    {
      "term": "墜落",
      "weight": 2
    },
    {
      "term": "坍塌",
      "weight": 2
    },
    {
      "term": "災情",
      "weight": 1
    },
    {
      "term": "雨彈",
      "weight": 2
    },
    {
      "term": "豪大雨",
      "weight": 2
    },
    {
      "term": "豪雨",
      "weight": 1
    },
    {
      "term": "淹水",
      "weight": 1
    },
    {
      "term": "停電",
      "weight": 1
    },
    {
      "term": "疫情",
      "weight": 1
    },
    {
      "term": "確診",
      "weight": 1
    },
    {
      "term": "中毒",
      "weight": 2
    },
    {
      "term": "致癌",
      "weight": 2
    },
    {
      "term": "汙染",
      "weight": 1
    },
    {
      "term": "危機",
      "weight": 2
    },
    {
      "term": "風險",
      "weight": 1
    },
    {
      "term": "警告",
      "weight": 1
    },
    {
      "term": "示警",
      "weight": 1
    },
    {
      "term": "爭議",
      "weight": 1
    },
    {
      "term": "抗議",
      "weight": 1
    },
    {
      "term": "批評",
      "weight": 1
    },
    {
      "term": "譴責",
      "weight": 2
    },
    {
      "term": "抨擊",
      "weight": 2
    },
    {
      "term": "質疑",
      "weight": 1
    },
    {
      "term": "衝突",
      "weight": 2
    },
    {
      "term": "詐騙",
      "weight": 2
    },
    {
      "term": "起訴",
      "weight": 2
    },
    {
      "term": "判刑",
      "weight": 2
    },
    {
      "term": "收押",
      "weight": 2
    },
    {
      "term": "貪污",
      "weight": 2
    },
    {
      "term": "弊案",
      "weight": 2
    },
    {
      "term": "違法",
      "weight": 2
    },
    {
      "term": "違規",
      "weight": 1
    },
    {
      "term": "罰款",
      "weight": 1
    },
    {
      "term": "開罰",
      "weight": 1
    },
    {
      "term": "遭控",
      "weight": 1
    },
    {
      "term": "涉嫌",
      "weight": 1
    },
    {
      "term": "侵害",
      "weight": 2
    },
    {
      "term": "霸凌",
      "weight": 2
    },
    {
      "term": "施暴",
      "weight": 2
    },
    {
      "term": "失利",
      "weight": 1
    },
    {
      "term": "落敗",
      "weight": 1
    },
    {
      "term": "延宕",
      "weight": 1
    },
    {
      "term": "停擺",
      "weight": 1
    },
    {
      "term": "反對",
      "weight": 1
    },
    {
      "term": "抵制",
      "weight": 2
    },
    {
      "term": "緊張",
      "weight": 1
    }
  ],
  "negations": [
    "不",
    "未",
    "無",
    "沒",
    "免",
    "難以",
    "並非",
    "毫無",
    "拒",
    "否認"
  ],
  "negationWindow": 4
};
