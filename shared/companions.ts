/** Local art catalogue. Character choice never changes vocabulary, evidence or review gates. */
export const companionCharacters = {
  optimus: { name: "擎天柱", englishName: "Optimus Prime", faction: 'autobot', image: "/assets/brand/optimus-mecha-v2.png", appearance: "blue antenna helmet, silver full lower-face plate, red twin truck-windshield chest and blue boots" },
  bumblebee: { name: "大黄蜂", englishName: "Bumblebee", faction: 'autobot', image: "/assets/brand/bumblebee-mecha-v2.png", appearance: "yellow-and-black car armor, silver segmented respirator mask and angular cyan optics" },
  arcee: { name: "阿尔茜", englishName: "Arcee", faction: 'autobot', image: "/assets/brand/arcee-mecha-v2.png", appearance: "pink-white vehicle armor, angular opaque silver face guard and narrow cyan visor, no doll face or eyelashes" },
  ironhide: { name: "铁皮", englishName: "Ironhide", faction: 'autobot', image: "/assets/brand/companions-v1/ironhide.png", appearance: "deep red van-body armor, broad red helmet, silver mechanical face guard, black lower legs, sturdy wheel details" },
  ratchet: { name: "救护车", englishName: "Ratchet", faction: 'autobot', image: "/assets/brand/companions-v1/ratchet.png", appearance: "white ambulance armor with strong red accents, white helmet with two red side crest blocks, segmented silver metal face guard, friendly medic posture, no cross symbols" },
  jazz: { name: "爵士", englishName: "Jazz", faction: 'autobot', image: "/assets/brand/companions-v1/jazz.png", appearance: "white sports-car body armor, black helmet, single cyan visor and silver mechanical faceplate, dark-blue glass chest, subtle red-blue accent stripes, black forearms" },
  wheeljack: { name: "千斤顶", englishName: "Wheeljack", faction: 'autobot', image: "/assets/brand/companions-v1/wheeljack.png", appearance: "white race-car armor with dark-green and red striping, two large translucent blue side ear panels, black helmet and full silver face guard" },
  prowl: { name: "警车", englishName: "Prowl", faction: 'autobot', image: "/assets/brand/companions-v1/prowl.png", appearance: "black and white car armor, red V-shaped helmet crest, white shoulder door wings, dark windshield chest and silver segmented mechanical mask, no police words" },
  hound: { name: "探长", englishName: "Hound", faction: 'autobot', image: "/assets/brand/companions-v1/hound.png", appearance: "olive green off-road jeep armor, rectangular green helmet, silver mechanical face mask, dark tire details at shoulders, sturdy olive boots" },
  mirage: { name: "幻影", englishName: "Mirage", faction: 'autobot', image: "/assets/brand/companions-v1/mirage.png", appearance: "blue and white open-wheel race-car armor, rounded blue helmet with silver mechanical mask, long white shoulder blocks, blue shins, no sponsor text" },
  sideswipe: { name: "横炮", englishName: "Sideswipe", faction: 'autobot', image: "/assets/brand/companions-v1/sideswipe.png", appearance: "vivid red sports-car armor, black helmet, silver segmented mechanical face guard, black tires on shoulders, red angular hood chest and white thighs" },
  hotrod: { name: "热破", englishName: "Hot Rod", faction: 'autobot', image: "/assets/brand/companions-v1/hotrod.png", appearance: "orange-red futuristic sports-car armor, yellow-orange flame-shaped chest panels without symbols, red helmet with angular cyan visor and silver mask, broad yellow spoiler behind shoulders" },
  ultramagnus: { name: "通天晓", englishName: "Ultra Magnus", faction: 'autobot', image: "/assets/brand/companions-v1/ultramagnus.png", appearance: "large blue-red-white car-carrier armor, tall blue helmet with white vertical antenna posts, silver full face guard, white shoulder towers, bright blue bulky boots" },
  grimlock: { name: "钢锁", englishName: "Grimlock", faction: 'autobot', image: "/assets/brand/companions-v1/grimlock.png", appearance: "robot mode, dark gray broad helmet with cyan visor and full metal mask, gold chest, gray arms, red waist, chunky black legs and silver toy dinosaur components behind back" },
  elitaone: { name: "艾丽塔", englishName: "Elita-1", faction: 'autobot', image: "/assets/brand/companions-v1/elitaone.png", appearance: "coral pink and magenta armored robot, tall magenta helmet crest, angular opaque silver mechanical face guard and cyan slit optics, rose vehicle panels, no eyelashes or human features" },
  jetfire: { name: "天火", englishName: "Jetfire", faction: 'autobot', image: "/assets/brand/companions-v1/jetfire.png", appearance: "white and red jet armor, white broad helmet with red inset crest, full silver mechanical faceplate and cyan visor, red squared backpack and white folded jet wings" },
  megatron: { name: "威震天", englishName: "Megatron", faction: 'decepticon', image: "/assets/brand/companions-v1/megatron.png", appearance: "classic G1 silver-gray armor, square silver bucket helmet and full segmented silver mechanical face guard, angular red optical slit, black torso accents and red waist details; NO arm cannon or weapons" },
  starscream: { name: "红蜘蛛", englishName: "Starscream", faction: 'decepticon', image: "/assets/brand/companions-v1/starscream.png", appearance: "classic G1 red torso, pale gray folded jet wings, blue forearms and boots, dark gray helmet with silver mechanical face guard and red slit optics, no missiles or weapons" },
  soundwave: { name: "声波", englishName: "Soundwave", faction: 'decepticon', image: "/assets/brand/companions-v1/soundwave.png", appearance: "navy blue box-shaped cassette-deck chest with dark transparent gold-outlined window, navy helmet, single red optical visor, silver full lower faceplate, white forearms and blue shins, no shoulder cannon" },
  shockwave: { name: "震荡波", englishName: "Shockwave", faction: 'decepticon', image: "/assets/brand/companions-v1/shockwave.png", appearance: "purple hard-surface robot armor, unmistakable single small glowing amber cyclops lens inside angular hexagonal head, no human face, light lavender geometric chest inset, TWO normal purple open hands; no gun-hand or cannon" },
} as const;
export type CompanionCharacter = keyof typeof companionCharacters;
export const companionIds = Object.keys(companionCharacters) as CompanionCharacter[];

/** Child-friendly introductions based on the classic G1 identities used by this catalogue. */
export const companionBiographies: Record<CompanionCharacter, string> = {
  optimus: '擎天柱是汽车人的领袖，来自遥远的机械星球塞伯坦。他最醒目的模样是红色胸甲、蓝色头盔和银色面罩，能够变成一辆大卡车。他沉稳、勇敢，做决定时总会先想到伙伴和需要保护的人。在他看来，每一种生命都值得尊重，强大的力量应该用来守护自由，而不是欺负弱小。他既能带领大家行动，也愿意听取不同的意见。遇到困难时，他常常站在最前面，承担最重的责任。伙伴们信任他，不只是因为他有本领，更因为他言出必行，始终努力让大家安全回家。',
  bumblebee: '大黄蜂是汽车人中一位勇敢又亲切的侦察伙伴，黄色装甲让他格外好认。在经典故事里，他可以变成一辆小巧的黄色汽车，灵活地穿过狭窄道路，观察周围的动静。他的个头不算大，力量也不是队伍中最强的，却很愿意尝试别人觉得困难的任务。他喜欢和人类交朋友，对地球上的新鲜事物充满好奇，也常常充当人类与汽车人之间的桥梁。面对危险，他同样会紧张，但不会轻易丢下朋友。大黄蜂让人记住的，是那份热心、忠诚，以及小个子也能勇敢担当的精神。',
  arcee: '阿尔茜是一位动作敏捷、判断果断的汽车人成员。在经典动画中，她身穿粉色和白色装甲，可以变成一辆造型流畅的未来汽车。她善于观察局势，能在复杂的环境里迅速找到行动方向，也很重视同伴之间的配合。她对朋友温暖体贴，需要保护伙伴时又会表现得十分坚定。阿尔茜并不只靠速度解决问题，她也会动脑筋、辨别危险，选择适合的方法。在团队里，她既能独立完成任务，也能照顾身边的人。勇敢、机灵和关心他人，共同组成了这位可靠伙伴的鲜明性格。',
  ironhide: '铁皮是汽车人中经验丰富的老队员，也是擎天柱十分信任的伙伴。他穿着厚实的红色装甲，在经典故事里能够变成一辆厢式汽车。他说话直接，做事干脆，遇到麻烦往往愿意先站出来，替同伴挡住危险。铁皮有时显得急躁，也不太喜欢绕弯子，但那份强硬的外表下面藏着对朋友的真心关怀。多年的经历让他积累了丰富的行动经验，知道什么时候该坚持，什么时候要保护队伍撤离。他并不追求漂亮的表现，更看重实际把事情做好，是团队里让人感到踏实的守护者。',
  ratchet: '救护车是汽车人队伍里的医护专家，白色装甲配上红色点缀，很容易让人联想到需要帮助时赶来的救援车辆。他能够变成一辆救护车，擅长检查、修理伙伴受损的机械身体，也懂得使用各种精细工具。其他队员忙着外出行动时，他常常负责让大家恢复状态，重新安全出发。他有时会因为伙伴不爱惜自己而唠叨几句，那是因为他很在意每一位队友。救护车的本领说明，团队不只需要冲在前面的成员，也需要细心照顾大家的人。耐心、知识和责任心，就是他的力量。',
  jazz: '爵士是汽车人中既能干又有活力的一员，常见的模样是白色跑车装甲、黑色头盔和一条醒目的蓝色护目镜。他很喜欢地球文化，尤其对音乐充满兴趣，性格轻松，适应新环境也很快。执行任务时，他善于观察、随机应变，能把看似复杂的事情处理得有条不紊。他经常承担需要技巧和判断力的特别任务，也是擎天柱信赖的得力伙伴。别看他平时很会享受音乐，真正需要认真时，他一点也不马虎。爵士把好奇心、专业本领和乐观态度放在一起，为队伍带来独特的节奏。',
  wheeljack: '千斤顶是汽车人中的科学家和发明家，脑袋里总装着各种新点子。他有白色赛车装甲，身上带着绿色和红色条纹，头盔两侧的面板也很有特点。在经典故事里，他擅长制造新装置、研究机械原理，常常希望用一个巧妙的发明解决难题。不过，新点子并不是每次都能成功，有些实验也会闹出意想不到的小麻烦。千斤顶仍然愿意找原因、继续改进，而不是马上放弃。他的特别之处不只在于聪明，还在于敢于提问、动手验证。好奇心和不断尝试，让他成为队里的创意来源。',
  prowl: '警车是汽车人中擅长分析和制定计划的成员，经典形象是黑白相间的汽车装甲，头盔上有醒目的红色装饰。他能够变成一辆警用汽车，做事认真，习惯先收集信息，再一步步推理出合适的办法。面对复杂任务，他很会整理路线、分配行动顺序，帮助队伍减少混乱。他不一定是最热闹的伙伴，有时还显得过于严肃，但他十分重视责任和团队安全。警车相信，准备充分、看清细节，往往能让大家少走弯路。他的故事也提醒我们，勇敢之外，冷静思考同样是一项重要本领。',
  hound: '探长是一位热爱地球自然风景的汽车人侦察员，绿色装甲和越野车外形让他很适合在野外活动。他喜欢观察山川、树林和各种生物，对人类生活也抱着友善的好奇心。执行任务时，他擅长辨认地形、寻找路线，把看到的情况告诉伙伴。在经典故事里，他还能够制造全息影像，让光影变成看起来很真实的景象，帮助队伍应对难题。探长有一份温和、细致的性格，不会只顾着赶路而错过周围的变化。他既是可靠的向导，也是懂得欣赏世界的朋友，愿意保护这个美丽的新家园。',
  mirage: '幻影是汽车人中拥有隐身本领的成员，蓝白相间的装甲来自他经典的赛车造型。他能够暂时隐藏自己的身影，因此很适合观察情况，或者完成不容易被发现的任务。他的动作灵活，做事讲究技巧，不喜欢凡事都依靠蛮力。与一些热情外向的伙伴相比，幻影有时显得安静、犹豫，也怀念在塞伯坦的生活，但这并不代表他不关心队友。关键时刻，他仍会运用自己的特殊能力帮助大家。这个角色的有趣之处，在于他并非一直充满把握，却能在思考之后作出选择，承担自己的责任。',
  sideswipe: '横炮是一位热情、勇敢、行动迅速的汽车人成员，鲜红色的跑车装甲让他看起来充满活力。他喜欢迎接挑战，遇到任务常常抢着出发，希望用漂亮的行动证明自己的本领。在经典故事里，他和同样能变成跑车的飞毛腿是双胞胎兄弟，但两人的性格各有不同。横炮擅长快速移动，也很愿意为伙伴冒险，只是有时会因为太急而忽略计划。因此，学会配合队伍、先想清楚再行动，也是他需要面对的课题。他的亮点是充沛的热情和不轻易退缩的勇气，总能给队伍带来一股冲劲。',
  hotrod: '热破是汽车人中年轻而有冲劲的一员，橙红色装甲、火焰般的胸前图案和背后的黄色尾翼，都是他的鲜明标志。他可以变成一辆未来风格的跑车，喜欢速度，也喜欢亲自尝试新鲜的事情。他心地善良，愿意帮助朋友，但有时太想立刻解决问题，反而没有充分考虑后果。在经典故事中，经历挑战的他逐渐明白，成长不只是获得更大的力量，还包括理解责任、听取建议和关心他人的安全。热破的经历像一段学习成为可靠伙伴的旅程，既保留热情，也慢慢学会更加成熟地行动。',
  ultramagnus: '通天晓是汽车人中稳重可靠的指挥官，蓝色、红色和白色组成了他厚实的装甲，经典变形形态是一辆运输汽车的大型卡车。他十分重视纪律和职责，接到任务后会认真安排，尽力保证每位伙伴知道自己该做什么。相比成为众人关注的英雄，他更愿意踏踏实实完成工作，让队伍顺利运转。通天晓也会感到压力，尤其在需要作出重大决定时，但他不会因此随意放下责任。他的长处是组织、坚持和对队友的忠诚。对他来说，可靠意味着答应的事尽力做到，并在困难时继续守住岗位。',
  grimlock: '钢锁是机器恐龙小队的领队，也是汽车人阵营中力量十分强大的成员。他的机器人形态有灰色装甲和金色胸甲，变形后则是一只威风的机械霸王龙。他性格直率、自尊心强，常常相信实际行动胜过长篇解释，也不太喜欢被别人随意指挥。在一些经典动画里，他说话简短，表现得有点倔强，有时还会闹出让人发笑的误会。不过，钢锁很看重伙伴，面对需要帮助的同伴，也会拿出勇气和力量。他的故事让人看到，外表威猛的角色也有真诚的一面，而强大的本领还需要学会配合。',
  elitaone: '艾丽塔是一位有领导能力的汽车人，粉红和玫红色装甲让她格外醒目。在经典故事里，她曾带领留在塞伯坦的伙伴坚持行动，与擎天柱一样重视自由，也愿意为保护同伴承担风险。她判断果断，能在困难环境中组织队伍，带领大家寻找继续前进的机会。艾丽塔并不是只在别人身后提供帮助的角色，她有自己的任务、想法和责任，也能够独立作出重要决定。她关心队友，同时对目标保持坚定。勇气、智慧和团队精神，让她成为值得信赖的领队，也展示了女性机器人同样出色的力量。',
  jetfire: '天火是汽车人中能够飞行的伙伴，经典造型以白色和红色为主，宽大的机翼和背部装置十分醒目。他能够变成喷气式飞行器，在空中快速移动，也具备丰富的科学知识。在经典动画里，他曾是一位探索地球的科学家，后来根据自己的判断，选择帮助汽车人，保护受到威胁的生命。天火重视事实，也愿意认真思考什么才是正确的事情。他体型高大，性格却有温和的一面，能为队友提供空中支援和运输帮助。他的经历说明，朋友不只由过去决定，也来自一个人愿意坚持怎样的选择。',
  megatron: '威震天是霸天虎的领袖，也是擎天柱在许多经典故事中的主要对手。他来自塞伯坦，常见形象是银灰色装甲、方正的头盔和红色光学镜。他很有力量，也擅长指挥，总想让所有人按照自己的意愿行动。与重视自由的汽车人不同，他经常试图用威胁和强硬手段取得控制权，因此给伙伴和其他生命带来麻烦。威震天的存在推动了许多故事中的冲突，也让我们看到，有能力并不等于做法一定正确。认识这个角色时，可以留意他的判断和选择，想一想力量应当怎样使用，才能不伤害别人。',
  starscream: '红蜘蛛是霸天虎中的空中指挥官，经典形象有红色胸甲、蓝色手臂与双腿，以及背后展开的灰色机翼。他能够变成喷气式飞机，飞行速度快，头脑也很灵活。他最明显的性格是野心很大，总觉得自己应该成为领袖，经常盘算着取代威震天。可他有时过于自信，计划一遇到变化就暴露出准备不足的问题，也因为不够真诚而难以获得同伴信任。这个角色常常为故事带来意想不到的转折。观察红蜘蛛，可以发现本领、愿望和责任是不同的事情，想带领别人，还需要诚实与可靠。',
  soundwave: '声波是霸天虎中的通信与情报专家，深蓝色装甲、红色护目镜和胸前像磁带仓一样的窗口，是他的经典标志。在早期故事里，他能够变成一台录音机，还会与激光鸟、机器狗等磁带伙伴一起行动。他善于接收、记录和分析声音信号，经常把收集到的信息报告给威震天。声波说话不多，办事沉着，对自己的阵营非常忠诚，因此在霸天虎中很受重视。不过，他也会利用情报帮助错误的计划。认识他时，可以看到观察和倾听的本领很重要，而怎样使用信息，同样需要认真判断。',
  shockwave: '震荡波是霸天虎中以科学和逻辑著称的成员，紫色装甲和头部中央的一只发光镜头，让他与其他角色很不一样。他擅长研究技术、分析问题，也常常承担管理基地或安排任务的工作。他习惯用计算和效率衡量事情，说话做事显得冷静，甚至有些冷漠。在不同故事中，他的具体经历有所变化，但过分看重结果、忽视他人感受，是常见的特点。震荡波提醒我们，科学知识本身是一种本领，使用知识的人仍要考虑责任。好的决定不仅要想清楚是否做得到，也要想一想会怎样影响别人。',
};

/** Stable per task, advancing through every character before repeating within one rotation. */
export function companionFor(seed: string, offset = 0): CompanionCharacter {
  let hash = 2166136261;
  for (const letter of seed) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  const index = ((hash >>> 0) % companionIds.length + Math.trunc(offset)) % companionIds.length;
  return companionIds[(index + companionIds.length) % companionIds.length];
}
