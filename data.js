/*
 * Curated dictionary of common Chinese characters.
 * Each entry: character -> { pinyin, meaning, examples: [{ word, pinyin, meaning }] }
 *
 * "examples" are common words the character is *used alongside* — the vocabulary
 * that the character lives inside. Pinyin uses tone marks.
 *
 * When a typed character is not in this dictionary, the app falls back to
 * pinyin-pro for the pronunciation and still lets you hear the audio.
 */
window.VOCAB_DATA = {
  "你": { pinyin: "nǐ", meaning: "you", examples: [
    { word: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
    { word: "你们", pinyin: "nǐ men", meaning: "you (plural)" },
    { word: "谢谢你", pinyin: "xiè xiè nǐ", meaning: "thank you" } ] },
  "好": { pinyin: "hǎo", meaning: "good; well", examples: [
    { word: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
    { word: "好吃", pinyin: "hǎo chī", meaning: "delicious" },
    { word: "好看", pinyin: "hǎo kàn", meaning: "good-looking" } ] },
  "我": { pinyin: "wǒ", meaning: "I; me", examples: [
    { word: "我们", pinyin: "wǒ men", meaning: "we; us" },
    { word: "我的", pinyin: "wǒ de", meaning: "my; mine" } ] },
  "他": { pinyin: "tā", meaning: "he; him", examples: [
    { word: "他们", pinyin: "tā men", meaning: "they (male)" },
    { word: "他的", pinyin: "tā de", meaning: "his" } ] },
  "她": { pinyin: "tā", meaning: "she; her", examples: [
    { word: "她们", pinyin: "tā men", meaning: "they (female)" },
    { word: "她的", pinyin: "tā de", meaning: "her; hers" } ] },
  "是": { pinyin: "shì", meaning: "to be; is/am/are", examples: [
    { word: "是的", pinyin: "shì de", meaning: "yes; that's right" },
    { word: "不是", pinyin: "bù shì", meaning: "is not; no" },
    { word: "是不是", pinyin: "shì bù shì", meaning: "is it or not?" } ] },
  "不": { pinyin: "bù", meaning: "no; not", examples: [
    { word: "不是", pinyin: "bù shì", meaning: "is not" },
    { word: "不要", pinyin: "bù yào", meaning: "don't want; don't" },
    { word: "不错", pinyin: "bù cuò", meaning: "not bad; pretty good" } ] },
  "好久": { pinyin: "hǎo jiǔ", meaning: "a long time", examples: [
    { word: "好久不见", pinyin: "hǎo jiǔ bù jiàn", meaning: "long time no see" } ] },
  "中": { pinyin: "zhōng", meaning: "middle; center; China", examples: [
    { word: "中国", pinyin: "zhōng guó", meaning: "China" },
    { word: "中文", pinyin: "zhōng wén", meaning: "Chinese (language)" },
    { word: "中午", pinyin: "zhōng wǔ", meaning: "noon" } ] },
  "国": { pinyin: "guó", meaning: "country; nation", examples: [
    { word: "中国", pinyin: "zhōng guó", meaning: "China" },
    { word: "国家", pinyin: "guó jiā", meaning: "country; state" },
    { word: "美国", pinyin: "měi guó", meaning: "United States" } ] },
  "人": { pinyin: "rén", meaning: "person; people", examples: [
    { word: "中国人", pinyin: "zhōng guó rén", meaning: "Chinese person" },
    { word: "人们", pinyin: "rén men", meaning: "people" },
    { word: "大人", pinyin: "dà rén", meaning: "adult" } ] },
  "学": { pinyin: "xué", meaning: "to study; to learn", examples: [
    { word: "学生", pinyin: "xué shēng", meaning: "student" },
    { word: "学校", pinyin: "xué xiào", meaning: "school" },
    { word: "学习", pinyin: "xué xí", meaning: "to study; to learn" } ] },
  "生": { pinyin: "shēng", meaning: "to be born; life; raw", examples: [
    { word: "学生", pinyin: "xué shēng", meaning: "student" },
    { word: "生日", pinyin: "shēng rì", meaning: "birthday" },
    { word: "先生", pinyin: "xiān shēng", meaning: "mister; sir" } ] },
  "老": { pinyin: "lǎo", meaning: "old", examples: [
    { word: "老师", pinyin: "lǎo shī", meaning: "teacher" },
    { word: "老人", pinyin: "lǎo rén", meaning: "elderly person" },
    { word: "老板", pinyin: "lǎo bǎn", meaning: "boss" } ] },
  "师": { pinyin: "shī", meaning: "teacher; master", examples: [
    { word: "老师", pinyin: "lǎo shī", meaning: "teacher" },
    { word: "师父", pinyin: "shī fu", meaning: "master" } ] },
  "大": { pinyin: "dà", meaning: "big; large", examples: [
    { word: "大学", pinyin: "dà xué", meaning: "university" },
    { word: "大家", pinyin: "dà jiā", meaning: "everyone" },
    { word: "大人", pinyin: "dà rén", meaning: "adult" } ] },
  "小": { pinyin: "xiǎo", meaning: "small; little", examples: [
    { word: "小孩", pinyin: "xiǎo hái", meaning: "child" },
    { word: "小时", pinyin: "xiǎo shí", meaning: "hour" },
    { word: "小心", pinyin: "xiǎo xīn", meaning: "be careful" } ] },
  "水": { pinyin: "shuǐ", meaning: "water", examples: [
    { word: "水果", pinyin: "shuǐ guǒ", meaning: "fruit" },
    { word: "喝水", pinyin: "hē shuǐ", meaning: "to drink water" },
    { word: "水平", pinyin: "shuǐ píng", meaning: "level; standard" } ] },
  "火": { pinyin: "huǒ", meaning: "fire", examples: [
    { word: "火车", pinyin: "huǒ chē", meaning: "train" },
    { word: "火锅", pinyin: "huǒ guō", meaning: "hot pot" } ] },
  "山": { pinyin: "shān", meaning: "mountain", examples: [
    { word: "爬山", pinyin: "pá shān", meaning: "to climb a mountain" },
    { word: "山水", pinyin: "shān shuǐ", meaning: "landscape; scenery" } ] },
  "月": { pinyin: "yuè", meaning: "moon; month", examples: [
    { word: "月亮", pinyin: "yuè liàng", meaning: "the moon" },
    { word: "一月", pinyin: "yī yuè", meaning: "January" },
    { word: "月饼", pinyin: "yuè bǐng", meaning: "mooncake" } ] },
  "日": { pinyin: "rì", meaning: "sun; day", examples: [
    { word: "生日", pinyin: "shēng rì", meaning: "birthday" },
    { word: "日本", pinyin: "rì běn", meaning: "Japan" },
    { word: "今日", pinyin: "jīn rì", meaning: "today" } ] },
  "天": { pinyin: "tiān", meaning: "sky; day", examples: [
    { word: "今天", pinyin: "jīn tiān", meaning: "today" },
    { word: "明天", pinyin: "míng tiān", meaning: "tomorrow" },
    { word: "天气", pinyin: "tiān qì", meaning: "weather" } ] },
  "年": { pinyin: "nián", meaning: "year", examples: [
    { word: "今年", pinyin: "jīn nián", meaning: "this year" },
    { word: "去年", pinyin: "qù nián", meaning: "last year" },
    { word: "新年", pinyin: "xīn nián", meaning: "New Year" } ] },
  "爱": { pinyin: "ài", meaning: "to love; love", examples: [
    { word: "爱情", pinyin: "ài qíng", meaning: "romantic love" },
    { word: "喜爱", pinyin: "xǐ ài", meaning: "to like; to be fond of" },
    { word: "爱好", pinyin: "ài hào", meaning: "hobby" } ] },
  "家": { pinyin: "jiā", meaning: "home; family", examples: [
    { word: "大家", pinyin: "dà jiā", meaning: "everyone" },
    { word: "家人", pinyin: "jiā rén", meaning: "family members" },
    { word: "国家", pinyin: "guó jiā", meaning: "country" } ] },
  "吃": { pinyin: "chī", meaning: "to eat", examples: [
    { word: "吃饭", pinyin: "chī fàn", meaning: "to eat (a meal)" },
    { word: "好吃", pinyin: "hǎo chī", meaning: "delicious" },
    { word: "吃饱", pinyin: "chī bǎo", meaning: "to eat one's fill" } ] },
  "喝": { pinyin: "hē", meaning: "to drink", examples: [
    { word: "喝水", pinyin: "hē shuǐ", meaning: "to drink water" },
    { word: "喝茶", pinyin: "hē chá", meaning: "to drink tea" } ] },
  "茶": { pinyin: "chá", meaning: "tea", examples: [
    { word: "喝茶", pinyin: "hē chá", meaning: "to drink tea" },
    { word: "绿茶", pinyin: "lǜ chá", meaning: "green tea" },
    { word: "奶茶", pinyin: "nǎi chá", meaning: "milk tea" } ] },
  "饭": { pinyin: "fàn", meaning: "cooked rice; meal", examples: [
    { word: "吃饭", pinyin: "chī fàn", meaning: "to eat a meal" },
    { word: "米饭", pinyin: "mǐ fàn", meaning: "cooked rice" },
    { word: "早饭", pinyin: "zǎo fàn", meaning: "breakfast" } ] },
  "谢": { pinyin: "xiè", meaning: "to thank", examples: [
    { word: "谢谢", pinyin: "xiè xiè", meaning: "thank you" },
    { word: "感谢", pinyin: "gǎn xiè", meaning: "to be grateful" } ] },
  "请": { pinyin: "qǐng", meaning: "please; to invite", examples: [
    { word: "请问", pinyin: "qǐng wèn", meaning: "may I ask" },
    { word: "请客", pinyin: "qǐng kè", meaning: "to treat (someone)" } ] },
  "问": { pinyin: "wèn", meaning: "to ask", examples: [
    { word: "请问", pinyin: "qǐng wèn", meaning: "may I ask" },
    { word: "问题", pinyin: "wèn tí", meaning: "question; problem" },
    { word: "问好", pinyin: "wèn hǎo", meaning: "to send regards" } ] },
  "说": { pinyin: "shuō", meaning: "to speak; to say", examples: [
    { word: "说话", pinyin: "shuō huà", meaning: "to speak; to talk" },
    { word: "说明", pinyin: "shuō míng", meaning: "to explain" } ] },
  "话": { pinyin: "huà", meaning: "words; speech", examples: [
    { word: "说话", pinyin: "shuō huà", meaning: "to speak" },
    { word: "电话", pinyin: "diàn huà", meaning: "telephone" },
    { word: "普通话", pinyin: "pǔ tōng huà", meaning: "Mandarin" } ] },
  "电": { pinyin: "diàn", meaning: "electricity", examples: [
    { word: "电话", pinyin: "diàn huà", meaning: "telephone" },
    { word: "电脑", pinyin: "diàn nǎo", meaning: "computer" },
    { word: "电影", pinyin: "diàn yǐng", meaning: "movie" } ] },
  "脑": { pinyin: "nǎo", meaning: "brain", examples: [
    { word: "电脑", pinyin: "diàn nǎo", meaning: "computer" },
    { word: "脑子", pinyin: "nǎo zi", meaning: "brain; mind" } ] },
  "影": { pinyin: "yǐng", meaning: "shadow; image", examples: [
    { word: "电影", pinyin: "diàn yǐng", meaning: "movie" },
    { word: "影响", pinyin: "yǐng xiǎng", meaning: "influence" } ] },
  "书": { pinyin: "shū", meaning: "book", examples: [
    { word: "看书", pinyin: "kàn shū", meaning: "to read a book" },
    { word: "书店", pinyin: "shū diàn", meaning: "bookshop" },
    { word: "图书馆", pinyin: "tú shū guǎn", meaning: "library" } ] },
  "看": { pinyin: "kàn", meaning: "to look; to watch; to read", examples: [
    { word: "看书", pinyin: "kàn shū", meaning: "to read a book" },
    { word: "好看", pinyin: "hǎo kàn", meaning: "good-looking" },
    { word: "看见", pinyin: "kàn jiàn", meaning: "to see" } ] },
  "听": { pinyin: "tīng", meaning: "to listen; to hear", examples: [
    { word: "听说", pinyin: "tīng shuō", meaning: "to hear (that)" },
    { word: "听音乐", pinyin: "tīng yīn yuè", meaning: "to listen to music" } ] },
  "写": { pinyin: "xiě", meaning: "to write", examples: [
    { word: "写字", pinyin: "xiě zì", meaning: "to write characters" },
    { word: "写作", pinyin: "xiě zuò", meaning: "writing; to compose" } ] },
  "字": { pinyin: "zì", meaning: "character; word", examples: [
    { word: "写字", pinyin: "xiě zì", meaning: "to write characters" },
    { word: "汉字", pinyin: "hàn zì", meaning: "Chinese character" },
    { word: "名字", pinyin: "míng zì", meaning: "name" } ] },
  "名": { pinyin: "míng", meaning: "name", examples: [
    { word: "名字", pinyin: "míng zì", meaning: "name" },
    { word: "有名", pinyin: "yǒu míng", meaning: "famous" } ] },
  "汉": { pinyin: "hàn", meaning: "Han; Chinese", examples: [
    { word: "汉字", pinyin: "hàn zì", meaning: "Chinese character" },
    { word: "汉语", pinyin: "hàn yǔ", meaning: "Chinese language" } ] },
  "语": { pinyin: "yǔ", meaning: "language", examples: [
    { word: "汉语", pinyin: "hàn yǔ", meaning: "Chinese language" },
    { word: "英语", pinyin: "yīng yǔ", meaning: "English" },
    { word: "语言", pinyin: "yǔ yán", meaning: "language" } ] },
  "文": { pinyin: "wén", meaning: "writing; culture; language", examples: [
    { word: "中文", pinyin: "zhōng wén", meaning: "Chinese language" },
    { word: "英文", pinyin: "yīng wén", meaning: "English" },
    { word: "文化", pinyin: "wén huà", meaning: "culture" } ] },
  "好吃": { pinyin: "hǎo chī", meaning: "delicious", examples: [] },
  "爸": { pinyin: "bà", meaning: "dad", examples: [
    { word: "爸爸", pinyin: "bà ba", meaning: "father; dad" } ] },
  "妈": { pinyin: "mā", meaning: "mom", examples: [
    { word: "妈妈", pinyin: "mā ma", meaning: "mother; mom" } ] },
  "哥": { pinyin: "gē", meaning: "older brother", examples: [
    { word: "哥哥", pinyin: "gē ge", meaning: "older brother" } ] },
  "姐": { pinyin: "jiě", meaning: "older sister", examples: [
    { word: "姐姐", pinyin: "jiě jie", meaning: "older sister" },
    { word: "小姐", pinyin: "xiǎo jiě", meaning: "Miss; young lady" } ] },
  "弟": { pinyin: "dì", meaning: "younger brother", examples: [
    { word: "弟弟", pinyin: "dì di", meaning: "younger brother" } ] },
  "妹": { pinyin: "mèi", meaning: "younger sister", examples: [
    { word: "妹妹", pinyin: "mèi mei", meaning: "younger sister" } ] },
  "朋": { pinyin: "péng", meaning: "friend", examples: [
    { word: "朋友", pinyin: "péng yǒu", meaning: "friend" } ] },
  "友": { pinyin: "yǒu", meaning: "friend", examples: [
    { word: "朋友", pinyin: "péng yǒu", meaning: "friend" },
    { word: "友好", pinyin: "yǒu hǎo", meaning: "friendly" } ] },
  "去": { pinyin: "qù", meaning: "to go", examples: [
    { word: "去年", pinyin: "qù nián", meaning: "last year" },
    { word: "回去", pinyin: "huí qù", meaning: "to go back" } ] },
  "来": { pinyin: "lái", meaning: "to come", examples: [
    { word: "回来", pinyin: "huí lái", meaning: "to come back" },
    { word: "起来", pinyin: "qǐ lái", meaning: "to get up; to rise" },
    { word: "本来", pinyin: "běn lái", meaning: "originally" } ] },
  "回": { pinyin: "huí", meaning: "to return", examples: [
    { word: "回家", pinyin: "huí jiā", meaning: "to go home" },
    { word: "回来", pinyin: "huí lái", meaning: "to come back" } ] },
  "买": { pinyin: "mǎi", meaning: "to buy", examples: [
    { word: "买东西", pinyin: "mǎi dōng xi", meaning: "to go shopping" },
    { word: "购买", pinyin: "gòu mǎi", meaning: "to purchase" } ] },
  "东": { pinyin: "dōng", meaning: "east", examples: [
    { word: "东西", pinyin: "dōng xi", meaning: "thing; stuff" },
    { word: "东方", pinyin: "dōng fāng", meaning: "the East" } ] },
  "西": { pinyin: "xī", meaning: "west", examples: [
    { word: "东西", pinyin: "dōng xi", meaning: "thing; stuff" },
    { word: "西方", pinyin: "xī fāng", meaning: "the West" } ] },
  "钱": { pinyin: "qián", meaning: "money", examples: [
    { word: "多少钱", pinyin: "duō shǎo qián", meaning: "how much money?" },
    { word: "零钱", pinyin: "líng qián", meaning: "small change" } ] },
  "多": { pinyin: "duō", meaning: "many; much", examples: [
    { word: "多少", pinyin: "duō shǎo", meaning: "how many; how much" },
    { word: "很多", pinyin: "hěn duō", meaning: "a lot; many" } ] },
  "少": { pinyin: "shǎo", meaning: "few; little", examples: [
    { word: "多少", pinyin: "duō shǎo", meaning: "how many" },
    { word: "很少", pinyin: "hěn shǎo", meaning: "rarely; very few" } ] },
  "很": { pinyin: "hěn", meaning: "very", examples: [
    { word: "很好", pinyin: "hěn hǎo", meaning: "very good" },
    { word: "很多", pinyin: "hěn duō", meaning: "a lot" } ] },
  "爱好": { pinyin: "ài hào", meaning: "hobby", examples: [] },
  "开": { pinyin: "kāi", meaning: "to open; to start", examples: [
    { word: "开心", pinyin: "kāi xīn", meaning: "happy" },
    { word: "打开", pinyin: "dǎ kāi", meaning: "to open" },
    { word: "开始", pinyin: "kāi shǐ", meaning: "to begin" } ] },
  "心": { pinyin: "xīn", meaning: "heart; mind", examples: [
    { word: "开心", pinyin: "kāi xīn", meaning: "happy" },
    { word: "小心", pinyin: "xiǎo xīn", meaning: "be careful" },
    { word: "中心", pinyin: "zhōng xīn", meaning: "center" } ] },
  "工": { pinyin: "gōng", meaning: "work; labor", examples: [
    { word: "工作", pinyin: "gōng zuò", meaning: "job; to work" },
    { word: "工人", pinyin: "gōng rén", meaning: "worker" } ] },
  "作": { pinyin: "zuò", meaning: "to do; to make", examples: [
    { word: "工作", pinyin: "gōng zuò", meaning: "job; to work" },
    { word: "作业", pinyin: "zuò yè", meaning: "homework" } ] },
  "时": { pinyin: "shí", meaning: "time; hour", examples: [
    { word: "时间", pinyin: "shí jiān", meaning: "time" },
    { word: "小时", pinyin: "xiǎo shí", meaning: "hour" },
    { word: "时候", pinyin: "shí hòu", meaning: "moment; time" } ] },
  "间": { pinyin: "jiān", meaning: "between; room", examples: [
    { word: "时间", pinyin: "shí jiān", meaning: "time" },
    { word: "房间", pinyin: "fáng jiān", meaning: "room" },
    { word: "中间", pinyin: "zhōng jiān", meaning: "in the middle" } ] },
  "上": { pinyin: "shàng", meaning: "up; on; above", examples: [
    { word: "上午", pinyin: "shàng wǔ", meaning: "morning" },
    { word: "上课", pinyin: "shàng kè", meaning: "to attend class" },
    { word: "早上", pinyin: "zǎo shàng", meaning: "early morning" } ] },
  "下": { pinyin: "xià", meaning: "down; below; next", examples: [
    { word: "下午", pinyin: "xià wǔ", meaning: "afternoon" },
    { word: "下课", pinyin: "xià kè", meaning: "class dismissed" },
    { word: "下面", pinyin: "xià miàn", meaning: "below; underneath" } ] },
  "爱心": { pinyin: "ài xīn", meaning: "compassion; loving heart", examples: [] }
};
