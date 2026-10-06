import { fileURLToPath } from 'node:url';

export type SleepAudioKind =
  | 'ocean'
  | 'rain'
  | 'meditation'
  | 'fireplace'
  | 'cat-purr'
  | 'nature'
  | 'birds'
  | 'wind-chimes'
  | 'asmr';

export type SleepMood =
  | 'overthinking'
  | 'tired'
  | 'stressed'
  | 'restless'
  | 'calm'
  | 'sad';

export interface SleepAudioTrack {
  /** A stable identifier for code and future Agent tools. */
  id: string;
  title: string;
  kind: SleepAudioKind;
  filePath: string;
  suitableMoods: SleepMood[];
  defaultDurationMinutes: number;
  /** False means the track is available only when a user explicitly requests it. */
  recommendedByDefault: boolean;
}

const backgroundAudioDirectory = new URL('../assets/audio/background/', import.meta.url);

function backgroundAudioPath(filename: string): string {
  return fileURLToPath(new URL(filename, backgroundAudioDirectory));
}

export const sleepAudioCatalog: readonly SleepAudioTrack[] = [
  {
    id: 'ocean-waves',
    title: '大海的声音和有节奏的海浪声',
    kind: 'ocean',
    filePath: backgroundAudioPath('大海的声音和有节奏的海浪声.mp3'),
    suitableMoods: ['overthinking', 'stressed', 'restless'],
    defaultDurationMinutes: 30,
    recommendedByDefault: true,
  },
  {
    id: 'spring-rain',
    title: '春日淅沥沥的小雨声',
    kind: 'rain',
    filePath: backgroundAudioPath('春日淅沥沥的小雨声.mp3'),
    suitableMoods: ['overthinking', 'tired', 'stressed', 'restless'],
    defaultDurationMinutes: 30,
    recommendedByDefault: true,
  },
  {
    id: 'jungle-rain',
    title: '丛林雨冥想音乐',
    kind: 'rain',
    filePath: backgroundAudioPath('丛林雨冥想音乐DRSAM(雨的声音).mp3'),
    suitableMoods: ['overthinking', 'stressed', 'sad'],
    defaultDurationMinutes: 20,
    recommendedByDefault: true,
  },
  {
    id: 'tibetan-singing-bowl',
    title: '西藏颂钵冥想音效',
    kind: 'meditation',
    filePath: backgroundAudioPath('西藏颂钵冥想音效(锅的声音).mp3'),
    suitableMoods: ['overthinking', 'stressed', 'restless'],
    defaultDurationMinutes: 15,
    recommendedByDefault: true,
  },
  {
    id: 'fireplace',
    title: '壁炉燃烧的木头噼里啪啦响',
    kind: 'fireplace',
    filePath: backgroundAudioPath('壁炉燃烧的木头噼里啪啦响.mp3'),
    suitableMoods: ['tired', 'calm', 'sad'],
    defaultDurationMinutes: 30,
    recommendedByDefault: true,
  },
  {
    id: 'cat-purr',
    title: '猫咪的呼噜声',
    kind: 'cat-purr',
    filePath: backgroundAudioPath('猫咪的呼噜声(宠物的声音).mp3'),
    suitableMoods: ['tired', 'calm', 'sad'],
    defaultDurationMinutes: 20,
    recommendedByDefault: true,
  },
  {
    id: 'snowy-leaves',
    title: '雪落树叶与鸟鸣',
    kind: 'nature',
    filePath: backgroundAudioPath('室外环境雪飘落在树叶上, 一些操纵噪音, 鸟(脚步的声音).mp3'),
    suitableMoods: ['calm', 'sad'],
    defaultDurationMinutes: 20,
    recommendedByDefault: false,
  },
  {
    id: 'city-birds',
    title: '傍晚城市鸟类与环境声',
    kind: 'birds',
    filePath: backgroundAudioPath('晚春, 傍晚的城市鸟类, 麻雀, 城市隆隆噪音下午(鸟的声音).mp3'),
    suitableMoods: ['calm'],
    defaultDurationMinutes: 20,
    recommendedByDefault: false,
  },
  {
    id: 'wind-chimes',
    title: '风铃',
    kind: 'wind-chimes',
    filePath: backgroundAudioPath('风铃(无背景噪音)(风铃的声音).mp3'),
    suitableMoods: ['calm'],
    defaultDurationMinutes: 15,
    recommendedByDefault: false,
  },
  {
    id: 'asmr-microphone-biting',
    title: 'ASMR 麦克风啃咬',
    kind: 'asmr',
    filePath: backgroundAudioPath('ASMR麦克风啃咬.mp3'),
    suitableMoods: ['calm'],
    defaultDurationMinutes: 15,
    recommendedByDefault: false,
  },
];

export function findSleepAudioById(id: string): SleepAudioTrack | undefined {
  return sleepAudioCatalog.find((track) => track.id === id);
}

export function listDefaultSleepAudio(): SleepAudioTrack[] {
  return sleepAudioCatalog.filter((track) => track.recommendedByDefault);
}
