/** Public Mandarin G1 collection; metadata checked against the publisher's 98-part listing. */
export const companionVideoSource = {
  bvid: 'BV1RW411E73m', platform: '哔哩哔哩', publisher: '深渊的幽灵', language: '普通话',
  checkedOn: '2026-11-14', collectionUrl: 'https://www.bilibili.com/video/BV1RW411E73m/',
  playerDocumentationUrl: 'https://player.bilibili.com/',
} as const;

export interface CompanionVideo {
  url: string; embedUrl: string; title: string; episodeNumber: number; cid: number;
  platform: string; publisher: string; language: string; checkedOn: string; note?: string;
}

function episode(number: number, cid: number, title: string): CompanionVideo {
  const source = companionVideoSource;
  const params = new URLSearchParams({ bvid: source.bvid, cid: String(cid), p: String(number), autoplay: '0', danmaku: '0' });
  return { url: `${source.collectionUrl}?p=${number}`, embedUrl: `https://player.bilibili.com/player.html?${params}`,
    title: `第${number}集 · ${title}`, episodeNumber: number, cid,
    platform: source.platform, publisher: source.publisher, language: source.language, checkedOn: source.checkedOn };
}

// Use the Mandarin collection order, which differs from some English broadcast/production listings.
export const companionEpisodes = {
  arrival: episode(1, 31925181, "第一天"),
  sky: episode(7, 31925186, "天火"),
  dinobots: episode(8, 31925187, "紧急呼叫"),
  warDinobots: episode(10, 31925189, "大战机器恐龙"),
  insects: episode(15, 31925194, "机器昆虫"),
  gears: episode(18, 31925197, "换变速箱"),
  attack: episode(20, 31925199, "汽车人的攻击"),
  traitor: episode(21, 31925200, "叛徒"),
  immobilizer: episode(22, 31925201, "静止器"),
  island: episode(30, 31925209, "恐龙岛（上）"),
  builders: episode(32, 31925211, "建筑大师"),
  alert: episode(33, 31925212, "超级武器"),
  microbots: episode(34, 31925213, "小机器人"),
  blaster: episode(39, 31925218, "蓝调录音机"),
  arthur: episode(40, 31925219, "霸天虎入侵亚瑟王朝"),
  lagoon: episode(41, 31925220, "金礁湖"),
  tracks: episode(43, 31925222, "跟踪追击"),
  survival: episode(45, 31925224, "食人株"),
  omega: episode(46, 31925225, "大力金刚的秘密"),
  gambler: episode(47, 31925226, "赌棍"),
  seaspray: episode(49, 31925228, "傍晚的星星"),
  takeover: episode(50, 31925229, "争权夺利"),
  alpha: episode(53, 31925232, "女汽车人"),
  powerglide: episode(54, 31925233, "爱上滑翔机的姑娘"),
  hollywood: episode(55, 31925234, "在好莱坞拍电影"),
  vector: episode(56, 31925235, "魔力神球（上）"),
  brigade: episode(62, 31925241, "红蜘蛛叛变"),
  cybertron: episode(69, 31925248, "五面怪（四）"),
  thief: episode(76, 31925255, "夜间盗贼"),
  fight: episode(86, 31925265, "决死一战"),
  primitives: episode(91, 31925270, "至尊太君"),
  rebirth: episode(96, 31925274, "新生（上）"),
  rebirthFinal: episode(98, 31925276, "新生（下）"),
} as const;
