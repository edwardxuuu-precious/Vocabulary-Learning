import type { BadgeAward, BadgeMetric, GrowthBadge } from './contracts.ts';
import configuredIncentives from './badge-incentives.json';

export interface BadgeDefinition extends Omit<GrowthBadge, 'current' | 'progress' | 'remaining' | 'unlocked' | 'recordedAt' | 'incentive'> {}
const wordTargets = [1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000];
const dayTargets = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];
const practiceTargets = [1, 3, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000];
type Series = { metric: BadgeMetric; title: string; prefix: string; color: string; targets: number[]; icons: string[]; names: string[]; evidence: string };
export const badgeSeries: Series[] = [
  { metric: 'days', title: '坚持足迹', prefix: 'D', color: '#3f9971', targets: dayTargets,
    icons: ['🌱','🍃','🌼','☀️','🌈','☁️','🌻','🌳','🏞️','⛰️','🌊','🌠','🌙','🌌','🌍','⭐'],
    names: ['冒险启程','春风嫩叶','小花绽放','阳光伙伴','七日探索家','晴空飞云','向阳花园','小树成林','坚持小队长','远山行者','碧海漫游','流星旅途','月夜守望','星空漫步','环游地球','周年星耀'], evidence: '累计学习打卡' },
  { metric: 'practicedWords', title: '练词旅程', prefix: 'P', color: '#dd8842', targets: practiceTargets,
    icons: ['🥚','🐣','🐧','🐇','🦊','🐱','🐶','🐼','🐨','🐯','🦁','🐘','🦒','🐬','🐳','🐉'],
    names: ['词汇小蛋','破壳出发','企鹅踏步','小兔快跑','灵狐探路','猫咪巡游','小狗侦察','熊猫竹林','考拉树屋','猛虎山林','雄狮草原','大象远足','长颈眺望','海豚跃浪','蓝鲸远航','神龙探险'], evidence: '练习过的英文词达到' },
  { metric: 'verifiedWords', title: '会词实力', prefix: 'W', color: '#586bd2', targets: wordTargets,
    icons: ['🛴','🚲','🛹','🛼','🚗','🚎','🚂','🚤','⛵','🚢','✈️','🚁','🚀','🛸','🛰️','🛶'],
    names: ['会词第一步','双轮起航','滑板小队','旱冰巡航','单词小队员','词汇巴士','蒸汽列车','词汇探索家','词汇小队长','远洋巨轮','词汇领航员','天空机长','火箭先锋','飞碟探员','卫星领航','千词探险家'], evidence: '四项独立通过的英文词达到' },
  { metric: 'stableWords', title: '跨天巩固', prefix: 'C', color: '#a273cc', targets: wordTargets,
    icons: ['🧱','🏠','🏡','🏘️','🏕️','🏫','🏢','🏬','🏭','🌉','🏯','🏰','🗼','🗽','🏔️','🌋'],
    names: ['记忆基石','记忆小屋','花园之家','记忆小镇','露营基地','知识学堂','记忆高楼','词汇商厦','记忆工坊','跨日长桥','记忆古堡','云端城堡','高塔守望','自由灯塔','雪峰守护','火山恒心'], evidence: '不同日期四项都通过的英文词达到' },
  { metric: 'look', title: '看词辨义', prefix: 'L', color: '#2199a3', targets: wordTargets,
    icons: ['🦋','🐞','🐝','🐢','🐠','🐙','🦀','🐚','🐌','🐸','🦉','🦜','🦚','🦄','🦕','🦩'],
    names: ['彩蝶识词','瓢虫点点','蜜蜂寻义','小龟稳步','彩鱼觅词','章鱼巧辨','小蟹巡岸','贝壳寻宝','蜗牛细看','青蛙慧眼','夜枭洞察','鹦鹉辨义','孔雀开屏','独角慧光','恐龙识界','火烈鸟远望'], evidence: '看英文认意思独立通过的词达到' },
  { metric: 'read', title: '独立朗读', prefix: 'R', color: '#cf6d8d', targets: wordTargets,
    icons: ['🎵','🎤','🎧','📻','🎸','🎹','🎺','🎻','🥁','🎷','🔔','📯','🎼','🎚️','🎛️','🎙️'],
    names: ['第一枚音符','小小麦克风','耳机练声','朗读电台','吉他拨弦','钢琴奏词','小号嘹亮','提琴轻吟','鼓点朗读','萨克斯之声','清亮铃声','号角响起','词语乐谱','声音调音师','朗读控制台','星光播音员'], evidence: '家长确认独立朗读通过的词达到' },
  { metric: 'en-zh', title: '英译中', prefix: 'E', color: '#d06848', targets: wordTargets,
    icons: ['🍎','🍌','🍊','🍋','🍓','🍒','🍑','🍐','🥝','🍉','🍇','🍍','🥭','🥥','🫐','🍈'],
    names: ['苹果小译员','香蕉小译员','橘子寻义','柠檬清译','草莓译园','樱桃成双','蜜桃知意','香梨译者','奇异果洞察','西瓜译场','葡萄词串','菠萝慧译','芒果领译','椰岛翻译家','蓝莓智译','蜜瓜大译师'], evidence: '家长确认英译中独立通过的词达到' },
  { metric: 'zh-en', title: '中译英', prefix: 'Z', color: '#3f83bd', targets: wordTargets,
    icons: ['🧭','🎒','🔍','🔑','🪁','🎈','🧩','🪀','🎨','📷','🔭','🔬','💡','💎','🏆','👑'],
    names: ['开口指南针','英语小背包','寻词放大镜','开口金钥匙','词语风筝','英语气球','译词拼图','开口悠悠球','语言调色盘','词语照相机','译词望远镜','语言显微镜','灵光小译员','钻石开口者','译词冠军','千词领译王'], evidence: '家长确认中译英独立通过的词达到' },
];

const legacyIds: Record<string, string> = { 'days:1': 'first-day', 'days:7': 'seven-days', 'days:30': 'thirty-days', 'verifiedWords:1': 'first-word', 'verifiedWords:10': 'ten-words', 'verifiedWords:30': 'thirty-words', 'verifiedWords:50': 'fifty-words', 'verifiedWords:100': 'hundred-words' };
const frames: GrowthBadge['frame'][] = ['round', 'shield', 'hexagon', 'flower'];
export const badgeCatalog: BadgeDefinition[] = badgeSeries.flatMap(series => series.targets.map((target, index) => ({
  id: legacyIds[`${series.metric}:${target}`] ?? `badge-${series.metric}-${target}`,
  serial: `${series.prefix}${String(index + 1).padStart(2, '0')}`, title: series.names[index],
  description: `${series.evidence} ${target} ${series.metric === 'days' ? '天（不要求连续）' : '词'}`,
  kind: series.metric === 'days' || series.metric === 'practicedWords' ? 'practice' : 'skill', series: series.metric, seriesTitle: series.title,
  icon: series.icons[index], color: series.color, frame: frames[index % frames.length], unit: series.metric === 'days' ? '天' : '词', target,
})));
export const badgeById = new Map(badgeCatalog.map(badge => [badge.id, badge]));
export type BadgeValues = Record<BadgeMetric, number>;

export function buildBadges(values: BadgeValues, awards: BadgeAward[] = [], incentives: Record<string, string> = configuredIncentives): GrowthBadge[] {
  const earned = new Map(awards.map(award => [award.badgeId, award]));
  return badgeCatalog.map(badge => {
    const current = values[badge.series], recorded = earned.get(badge.id), unlocked = !!recorded || current >= badge.target;
    const incentive = (incentives[badge.id] ?? incentives[badge.serial])?.trim();
    return { ...badge, current, progress: Math.min(current, badge.target), remaining: unlocked ? 0 : Math.max(0, badge.target - current), unlocked,
      ...(recorded ? { recordedAt: recorded.recordedAt } : {}), ...(incentive ? { incentive } : {}) };
  });
}

/** One upcoming goal per series, so a large catalogue never hides the next attainable step. */
export function nextBadges(badges: GrowthBadge[]): GrowthBadge[] {
  return badgeSeries.flatMap(series => { const badge = badges.find(badge => badge.series === series.metric && !badge.unlocked); return badge ? [badge] : []; });
}
