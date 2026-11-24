/**
 * 数据类型定义
 *
 * 运行时的默认值与清洗逻辑在 shared/model.js（newtab 页与 background SW 共用），
 * 这里只声明类型。两者必须同步修改。
 */
export interface PanelPos {
  left: number;
  top: number;
}

export interface Settings {
  openMode: 'current' | 'newtab';
  /** 书签图标像素大小（16~60） */
  iconPx: number;
  showName: boolean;
  /** 圆角半径 px（0~28） */
  radius: number;
  /** 卡片透明度（0.2~1），缺省时按主题默认 */
  cardOpacity?: number;
  /** 卡片内边距（2~30） */
  cardPadding: number;
  defaultSearchId: string;
  /** Dock 固定的书签 id（顺序即展示顺序） */
  dockIds: string[];
  backgroundOverlay?: number;
  backgroundBlur?: number;
  backgroundPosition?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  backgroundSize?: 'cover' | 'contain' | 'auto' | 'tile';
  settingsPanelPos?: PanelPos;
  sharedItemsPanelPos?: PanelPos;
  notebookPanelSize?: { w: number; h: number };
  /** 记事本字号 px（12~28） */
  notebookFontSize: number;
  /** 记事本字体键 */
  notebookFontFamily: 'system' | 'hei' | 'song' | 'kai' | 'mono';
  /** 当前选中的笔记 */
  notebookCurrentId?: string;
  /** 分组侧栏中分类名称：始终显示 / 鼠标悬停时显示 */
  groupNameMode: 'always' | 'hover';
  /** 主题：深色 / 浅色 / 跟随系统 */
  colorScheme: ColorScheme;
  /** 搜索框上方的小组件 */
  widgets: Widgets;
}

/** 天气小组件选定的地点（来自 Open-Meteo 地理编码） */
export interface WeatherCity {
  name: string;
  /** 省 / 州，用于区分同名城市 */
  admin?: string;
  country?: string;
  lat: number;
  lon: number;
}

export interface Widgets {
  clock: boolean;
  /** 时钟使用 24 小时制 */
  clock24: boolean;
  date: boolean;
  lunar: boolean;
  weather: boolean;
  city: WeatherCity | null;
}

export type ColorScheme = 'dark' | 'light' | 'system';

/** 悬浮按钮位置：贴靠左/右边缘的距离 + 垂直方向比例（0=顶，1=底） */
export interface FabPlacement {
  side: 'left' | 'right';
  x: number;
  y: number;
}

export interface FabState {
  enabled: boolean;
  placement: FabPlacement;
}

export interface SearchEngine {
  id: string;
  name: string;
  /** 包含 %s 的搜索模板 */
  template: string;
  builtin?: boolean;
  /** 图标 dataURL */
  icon?: string;
  /** 上次尝试抓取图标的时间（失败也记录，避免每次打开新标签页都重试） */
  iconCheckedAt?: number;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  icon?: string;
  color?: string;
  /** 所属分组（始终指向存在的分组） */
  groupId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  order: number;
  icon?: string;
}

export interface NotebookImage {
  id: string;
  /** 仅存在于旧数据与备份文件中；存储中图片本体在 IndexedDB */
  dataUrl?: string;
  name?: string;
  size: number;
  mime?: string;
  createdAt: number;
}

export interface NotebookEntry {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  panelPos?: PanelPos;
  images: NotebookImage[];
}

export interface SharedItem {
  id: number;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  source: string;
  /** url / text / wechat */
  contentType: string;
  createdAt: number;
}

/** 内存中的完整数据（每个字段对应 chrome.storage.local 的一个 key） */
export interface StoreData {
  settings: Settings;
  /** 自定义背景图 dataURL，'' 表示未设置 */
  background: string;
  fab: FabState;
  groups: Group[];
  bookmarks: Bookmark[];
  engines: SearchEngine[];
  notebooks: NotebookEntry[];
  sharedItems: SharedItem[];
}

export type StoreField = keyof StoreData;
