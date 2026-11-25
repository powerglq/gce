<template>
  <teleport to="body">
    <div
      v-if="open"
      class="mask gce-panel-mask--drawer gce-panel-mask"
      @click="close"
      @wheel.stop.prevent
    ></div>
    <aside
      v-if="open"
      ref="panelEl"
      class="drawer glass gce-panel gce-panel--drawer"
      :style="panelStyle"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      @click.stop
      @wheel.stop
    >
      <header class="hdr glass gce-panel-hdr gce-drag-handle" @pointerdown="onDragStart">
        <h3 class="gce-panel-title">设置</h3>
        <button
          class="gce-panel-close"
          type="button"
          aria-label="关闭"
          @click="close"
        >×</button>
      </header>

      <div class="panel">
        <nav class="side glass">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="item"
            :class="{ on: tab === t.key }"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </nav>
        <div class="content">
          <section v-show="tab === 'general'" class="sec glass">
            <h4>常规</h4>
            <div class="row">
              <label>主题</label>
              <div class="seg" role="tablist" aria-label="主题">
                <button
                  v-for="m in COLOR_SCHEMES"
                  :key="m.value"
                  type="button"
                  class="seg-item"
                  :class="{ on: s.colorScheme === m.value }"
                  role="tab"
                  :aria-selected="s.colorScheme === m.value"
                  @click="set({ colorScheme: m.value })"
                >{{ m.label }}</button>
              </div>
            </div>
            <div class="row">
              <label>打开方式</label>
              <div class="seg" role="tablist" aria-label="打开方式">
                <button
                  v-for="m in OPEN_MODES"
                  :key="m.value"
                  type="button"
                  class="seg-item"
                  :class="{ on: s.openMode === m.value }"
                  role="tab"
                  :aria-selected="s.openMode === m.value"
                  @click="set({ openMode: m.value })"
                >{{ m.label }}</button>
              </div>
            </div>
            <div class="row">
              <label>显示名称</label>
              <input type="checkbox" :checked="s.showName" @change="set({ showName: checked($event) })" />
            </div>
            <div class="row">
              <label>分类名称</label>
              <div class="seg" role="tablist" aria-label="分类名称显示方式">
                <button
                  v-for="m in GROUP_NAME_MODES"
                  :key="m.value"
                  type="button"
                  class="seg-item"
                  :class="{ on: s.groupNameMode === m.value }"
                  role="tab"
                  :aria-selected="s.groupNameMode === m.value"
                  @click="set({ groupNameMode: m.value })"
                >{{ m.label }}</button>
              </div>
            </div>
            <div class="row">
              <label>启用浮动按钮组</label>
              <input type="checkbox" :checked="fabOn" @change="onFabChange" />
              <span class="tip">{{ fabTip }}</span>
            </div>
            <div v-for="r in RANGES" :key="r.key" class="row">
              <label>{{ r.label }}</label>
              <input
                type="range"
                :min="r.min"
                :max="r.max"
                :step="r.step"
                :value="r.get()"
                @input="slide(r.key, $event)"
              />
              <span>{{ r.format(r.get()) }}</span>
              <button class="btn gce-btn gce-btn--sm reset" :title="r.resetTip" @click="set({ [r.key]: undefined })">重置</button>
            </div>
          </section>

          <section v-show="tab === 'widgets'" class="sec glass">
            <h4>小组件</h4>
            <div v-for="t in WIDGET_TOGGLES" :key="t.key" class="row">
              <label>{{ t.label }}</label>
              <input type="checkbox" :checked="s.widgets[t.key]" @change="setWidget({ [t.key]: checked($event) })" />
              <span class="tip">{{ t.tip }}</span>
            </div>
            <template v-if="s.widgets.weather">
              <div class="row">
                <label>城市</label>
                <input
                  v-model="cityQuery"
                  type="text"
                  placeholder="输入城市名，如 北京、杭州"
                  @keydown.enter="findCity"
                />
                <button class="btn gce-btn gce-btn--sm" :disabled="citySearching" @click="findCity">搜索</button>
              </div>
              <div v-if="cityResults.length" class="row">
                <label></label>
                <div class="city-list">
                  <button
                    v-for="c in cityResults"
                    :key="`${c.lat},${c.lon}`"
                    type="button"
                    class="city-item"
                    @click="pickCity(c)"
                  >{{ cityLabel(c) }}</button>
                </div>
              </div>
              <div class="row">
                <label></label>
                <span class="tip">{{ s.widgets.city ? `当前：${cityLabel(s.widgets.city)}` : '尚未选择城市' }}</span>
              </div>
              <small class="tip">
                天气数据来自 <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>（CC BY 4.0）。
                搜索时发送输入的城市名，之后只发送所选城市的经纬度，每 30 分钟最多请求一次。
              </small>
            </template>
          </section>

          <section v-show="tab === 'data'" class="sec glass">
            <h4>数据</h4>
            <div class="row">
              <div class="actions">
                <button class="btn gce-btn gce-btn--primary wide" :disabled="busy" @click="doExport">导出备份</button>
                <button class="btn gce-btn gce-btn--primary wide" :disabled="busy" @click="importInput?.click()">导入备份</button>
                <input
                  ref="importInput"
                  type="file"
                  accept="application/json,.json,.data"
                  style="display:none"
                  @change="pickImport"
                />
              </div>
              <span class="filename">{{ importFileName || '未选择任何文件' }}</span>
            </div>
            <div class="row">
              <label>站点缓存</label>
              <button class="btn gce-btn" @click="clearCache">清空站点缓存</button>
              <span class="tip">清理添加链接时缓存的网页标题与图标（7 天内有效）</span>
            </div>
            <div class="row">
              <label>清空记录</label>
              <button class="btn gce-btn" @click="openClearModal">清空数据</button>
              <span class="tip">选择要清除的本地数据</span>
            </div>
          </section>

          <section v-show="tab === 'background'" class="sec glass">
            <h4>背景</h4>
            <div class="row">
              <label>当前</label>
              <span class="bg-tip">{{ settings.background ? '已设置自定义背景' : '未设置' }}</span>
            </div>
            <div class="row tight">
              <label>来源</label>
              <div class="seg" role="tablist" aria-label="背景来源">
                <button
                  type="button"
                  class="seg-item"
                  :class="{ on: bgMode === 'upload' }"
                  role="tab"
                  :aria-selected="bgMode === 'upload'"
                  @click="bgMode = 'upload'"
                >本地图片</button>
                <button
                  type="button"
                  class="seg-item"
                  :class="{ on: bgMode === 'url' }"
                  role="tab"
                  :aria-selected="bgMode === 'url'"
                  @click="bgMode = 'url'"
                >远程图片</button>
              </div>
            </div>
            <div v-if="bgMode === 'upload'" class="row tight">
              <label>上传</label>
              <button class="btn gce-btn" :disabled="busy" @click="bgInput?.click()">选择文件</button>
              <input
                ref="bgInput"
                type="file"
                accept="image/*"
                style="display:none"
                @change="pickBg"
              />
              <span class="filename">{{ bgFileName || '未选择任何文件' }}</span>
              <button class="btn gce-btn" @click="applyBackground('')">清除背景</button>
            </div>
            <div v-else class="row tight col">
              <label>地址</label>
              <input
                v-model="bgUrl"
                class="url"
                type="text"
                placeholder="支持 data:image/... 或 http(s) 图片链接"
              />
              <div class="actions">
                <button class="btn gce-btn gce-btn--primary" :disabled="busy" @click="applyBgUrl">应用</button>
                <button class="btn gce-btn" @click="applyBackground('')">清除背景</button>
              </div>
              <small class="tip">http(s) 图片会下载一次并保存为本地数据，之后不再联网。</small>
            </div>
            <div class="row">
              <label>遮罩强度</label>
              <input
                type="range"
                min="0"
                max="0.6"
                step="0.02"
                :value="s.backgroundOverlay ?? 0"
                @input="slide('backgroundOverlay', $event)"
              />
              <span>{{ (s.backgroundOverlay ?? 0).toFixed(2) }}</span>
            </div>
            <div class="row">
              <label>模糊(px)</label>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                :value="s.backgroundBlur ?? 0"
                @input="slide('backgroundBlur', $event)"
              />
              <span>{{ s.backgroundBlur ?? 0 }}</span>
            </div>
            <div class="row">
              <label>位置</label>
              <div class="seg" role="tablist" aria-label="背景位置">
                <button
                  v-for="m in BG_POSITIONS"
                  :key="m.value"
                  type="button"
                  class="seg-item"
                  :class="{ on: (s.backgroundPosition ?? 'center') === m.value }"
                  role="tab"
                  :aria-selected="(s.backgroundPosition ?? 'center') === m.value"
                  @click="set({ backgroundPosition: m.value })"
                >{{ m.label }}</button>
              </div>
            </div>
            <div class="row">
              <label>填充</label>
              <div class="seg" role="tablist" aria-label="背景填充">
                <button
                  v-for="m in BG_SIZES"
                  :key="m.value"
                  type="button"
                  class="seg-item"
                  :class="{ on: (s.backgroundSize ?? 'cover') === m.value }"
                  role="tab"
                  :aria-selected="(s.backgroundSize ?? 'cover') === m.value"
                  @click="set({ backgroundSize: m.value })"
                >{{ m.label }}</button>
              </div>
            </div>
          </section>

          <section v-show="tab === 'about'" class="sec glass">
            <h4>关于</h4>
            <p>GCE启动器 v{{ VERSION }}</p>
            <p>数据仅保存在本机浏览器中。何时联网、发送什么数据，见项目主页中的隐私说明。</p>
            <div class="row">
              <label>检查更新</label>
              <input type="checkbox" :checked="s.checkUpdate" @change="setCheckUpdate(checked($event))" />
              <span class="tip">每天最多查询一次 GitHub 与 Gitee 上的最新版本，有新版本时提醒（不会自动安装）</span>
            </div>
            <div v-if="s.checkUpdate" class="row">
              <label></label>
              <span class="tip">{{ updateText }}</span>
              <template v-if="newRelease">
                <a
                  v-for="d in downloadLinks"
                  :key="d.label"
                  :href="d.url"
                  target="_blank"
                  rel="noopener"
                  class="btn gce-btn gce-btn--primary gce-btn--sm"
                >{{ d.label }}</a>
              </template>
              <button
                v-else
                class="btn gce-btn gce-btn--sm"
                :disabled="updateState.checking"
                @click="checkForUpdate(true)"
              >立即检查</button>
            </div>
            <p>开源协议：MIT License</p>
            <p>
              <a
                :href="REPO_URL"
                target="_blank"
                rel="noopener"
                class="btn gce-btn gce-btn--primary wide"
              >项目主页 / 反馈问题</a>
            </p>
          </section>
        </div>
      </div>
    </aside>

    <!-- 导入预览 -->
    <div v-if="importPreview" class="imp-mask" @click="cancelImport"></div>
    <div v-if="importPreview" class="imp-panel" @click.stop>
      <header class="imp-hdr">
        <div class="imp-ttl">导入预览</div>
        <button class="close" @click="cancelImport">✖</button>
      </header>
      <div class="imp-body">
        <label class="imp-row imp-all">
          <input type="checkbox" :checked="allChecked(importChecks)" @change="setAll(importChecks, checked($event))" />
          <span class="imp-label">全选</span>
        </label>
        <div class="imp-sep"></div>
        <label v-for="c in IMPORT_ROWS" :key="c.key" class="imp-row">
          <input v-model="importChecks[c.key]" type="checkbox" />
          <span class="imp-label">{{ c.label }}</span>
          <span class="imp-count">{{ c.count(importPreview) }}</span>
        </label>
        <div class="imp-sep"></div>
        <div class="imp-file">来源: {{ importFileName }}</div>
        <div class="imp-file">重复的条目（相同 id）以备份为准；与现有链接网址相同的书签会被跳过。</div>
      </div>
      <footer class="imp-ftr">
        <button class="btn gce-btn" @click="cancelImport">取消</button>
        <button class="btn gce-btn gce-btn--primary" :disabled="busy" @click="confirmImport">导入</button>
      </footer>
    </div>

    <!-- 清空数据 -->
    <div v-if="showClear" class="imp-mask" @click="showClear = false"></div>
    <div v-if="showClear" class="imp-panel" @click.stop>
      <header class="imp-hdr">
        <div class="imp-ttl">清空数据</div>
        <button class="close" @click="showClear = false">✖</button>
      </header>
      <div class="imp-body">
        <label class="imp-row imp-all">
          <input type="checkbox" :checked="allChecked(clearChecks)" @change="setAll(clearChecks, checked($event))" />
          <span class="imp-label">全选</span>
        </label>
        <div class="imp-sep"></div>
        <label v-for="c in CLEAR_ROWS" :key="c.key" class="imp-row">
          <input v-model="clearChecks[c.key]" type="checkbox" />
          <span class="imp-label">{{ c.label }}</span>
          <span class="imp-count">{{ c.count() }}</span>
        </label>
      </div>
      <footer class="imp-ftr">
        <button class="btn gce-btn" @click="showClear = false">取消</button>
        <button class="btn gce-btn gce-btn--danger" :disabled="busy" @click="confirmClear">确认清空</button>
      </footer>
    </div>
  </teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useSettings } from '../../core/store/useSettings';
import { useBookmarks } from '../../core/store/useBookmarks';
import { useEngines } from '../../core/store/useEngines';
import { useNotebook } from '../../core/store/useNotebook';
import { useSharedItems } from '../../core/store/useSharedItems';
import { notifyError, confirmSaved } from '../../core/store/useStorage';
import { useDraggablePanel } from '../../core/composables/useDraggablePanel';
import { exportBackup, importBackup, parseBackup, clearData } from '../../core/utils/backup';
import type { BackupCategory, BackupPreview, ClearOptions } from '../../core/utils/backup';
import { prepareBackground } from '../../core/utils/image';
import { clearSiteCache, hasSiteCache } from '../../core/utils/siteCache';
import { BACKGROUND_SOURCE_MAX_BYTES } from '../../core/config';
import { ICON_PX } from '../../../shared/model.js';
import { hasAllSites, requestAllSites, removeAllSites } from '../../../shared/sitePermission.js';
import { applyAll } from '../appInit';
import { toast, confirm } from '../../core/utils/feedback';
import type { Settings, WeatherCity, Widgets } from '../../core/types/model';
import { searchCity, cityLabel } from '../../core/utils/weather';
import { updateState, checkForUpdate, availableUpdate } from '../../core/utils/update';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const settings = useSettings();
const bm = useBookmarks();
const engines = useEngines();
const notebook = useNotebook();
const shared = useSharedItems();

const s = computed(() => settings.settings);
const manifest = chrome.runtime.getManifest();
const VERSION = manifest.version;
const REPO_URL = manifest.homepage_url;

// ============ 检查更新 ============

const newRelease = computed(() => availableUpdate());
/** 两个来源分别给出下载按钮（访问不了 GitHub 的用户可用 Gitee） */
const downloadLinks = computed(() => {
  const d = newRelease.value?.downloads ?? {};
  return [
    ...(d.github ? [{ label: 'GitHub 下载', url: d.github }] : []),
    ...(d.gitee ? [{ label: 'Gitee 下载', url: d.gitee }] : []),
  ];
});
const updateText = computed(() => {
  // 先返回的来源已发现新版本时直接显示，不必等另一个来源
  if (newRelease.value) return `发现新版本 v${newRelease.value.version}，下载后替换原扩展文件夹，再在扩展管理页点「重新加载」`;
  if (updateState.checking) return '正在检查…';
  if (updateState.error) return `检查失败：${updateState.error}`;
  return updateState.checked ? '已是最新版本' : '尚未检查';
});

function setCheckUpdate(on: boolean) {
  set({ checkUpdate: on });
  if (on) void checkForUpdate(true);
}

type TabKey = 'general' | 'widgets' | 'data' | 'background' | 'about';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'general', label: '常规设置' },
  { key: 'widgets', label: '小组件' },
  { key: 'data', label: '数据' },
  { key: 'background', label: '背景' },
  { key: 'about', label: '关于' },
];
const TAB_STORAGE_KEY = 'gce_settings_tab';
const tab = ref<TabKey>((localStorage.getItem(TAB_STORAGE_KEY) as TabKey) || 'general');
watch(tab, (v) => localStorage.setItem(TAB_STORAGE_KEY, v));

const COLOR_SCHEMES = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
] as const;

// ============ 小组件 ============

type WidgetToggle = 'clock' | 'clock24' | 'date' | 'lunar' | 'weather';
const WIDGET_TOGGLES: Array<{ key: WidgetToggle; label: string; tip: string }> = [
  { key: 'clock', label: '时钟', tip: '搜索框左侧显示当前时间' },
  { key: 'clock24', label: '24 小时制', tip: '关闭后显示上午 / 下午' },
  { key: 'date', label: '日期与星期', tip: '如 11月24日星期二' },
  { key: 'lunar', label: '农历', tip: '使用浏览器内置的中国历计算，不联网' },
  { key: 'weather', label: '天气', tip: '需要联网，开启后在下方选择城市' },
];

function setWidget(patch: Partial<Widgets>) {
  set({ widgets: { ...settings.settings.widgets, ...patch } });
}

const cityQuery = ref('');
const cityResults = ref<WeatherCity[]>([]);
const citySearching = ref(false);

async function findCity() {
  const q = cityQuery.value.trim();
  // 地理编码接口：单个字符不返回结果
  if (q.length < 2) {
    toast('请至少输入 2 个字', { type: 'warning' });
    return;
  }
  citySearching.value = true;
  try {
    cityResults.value = await searchCity(q);
    if (!cityResults.value.length) toast('没有找到这个城市，换个写法试试', { type: 'warning' });
  } catch {
    toast('城市搜索失败，请检查网络', { type: 'error' });
  } finally {
    citySearching.value = false;
  }
}

function pickCity(c: WeatherCity) {
  setWidget({ city: c });
  cityResults.value = [];
  cityQuery.value = '';
}

const BG_POSITIONS = [
  { value: 'center', label: '居中' },
  { value: 'top', label: '顶部' },
  { value: 'bottom', label: '底部' },
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
] as const;

const BG_SIZES = [
  { value: 'cover', label: '铺满（裁剪）' },
  { value: 'contain', label: '适应（留边）' },
  { value: 'auto', label: '原尺寸' },
  { value: 'tile', label: '平铺' },
] as const;

const OPEN_MODES = [
  { value: 'current', label: '当前标签' },
  { value: 'newtab', label: '新标签' },
] as const;

const GROUP_NAME_MODES = [
  { value: 'always', label: '始终显示' },
  { value: 'hover', label: '悬停显示' },
] as const;

type RangeKey = 'iconPx' | 'radius' | 'cardOpacity' | 'cardPadding' | 'backgroundOverlay' | 'backgroundBlur';
const RANGES: Array<{ key: RangeKey; label: string; min: number; max: number; step: number; resetTip: string; get: () => number; format: (v: number) => string }> = [
  { key: 'iconPx', label: '图标大小(px)', min: ICON_PX.min, max: ICON_PX.max, step: 1, resetTip: `恢复默认(${ICON_PX.def})`, get: () => s.value.iconPx, format: String },
  { key: 'radius', label: '圆角(px)', min: 0, max: 28, step: 1, resetTip: '恢复默认(12)', get: () => s.value.radius, format: String },
  { key: 'cardOpacity', label: '卡片透明度', min: 0.2, max: 1, step: 0.02, resetTip: '恢复默认(0.50)', get: () => s.value.cardOpacity ?? 0.5, format: (v) => v.toFixed(2) },
  { key: 'cardPadding', label: '卡片内边距', min: 2, max: 30, step: 1, resetTip: '恢复默认(12)', get: () => s.value.cardPadding, format: String },
];

const checked = (e: Event) => (e.target as HTMLInputElement).checked;

/** 本次打开期间是否改过设置（关闭时据此提示一次「已保存」） */
let changed = false;

function set(patch: Partial<Record<keyof Settings, unknown>>) {
  changed = true;
  void settings.patch(patch as Partial<Settings>);
}

/** 滑块：界面即时生效，停止拖动 400ms 后写入 */
function slide(key: RangeKey, e: Event) {
  changed = true;
  void settings.patch({ [key]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>, 400);
}

// ============ 悬浮按钮（需要「访问网站」权限，开启时申请、关闭时归还） ============

const fabGranted = ref(false);
/** 用户可能在浏览器的扩展管理页撤销权限：每次打开设置时重新查询 */
watch(
  () => props.open,
  async (v) => {
    if (v) fabGranted.value = await hasAllSites();
  },
  { immediate: true }
);
const fabOn = computed(() => settings.fab.enabled && fabGranted.value);
const fabTip = computed(() =>
  settings.fab.enabled && !fabGranted.value
    ? '访问网站的权限已被撤销，重新勾选即可授权'
    : '在其它网页右侧显示二维码 / 返回顶部 / 收藏按钮（开启时需授权访问网站）'
);

function onFabChange(e: Event) {
  const input = e.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  changed = true;
  if (!input.checked) {
    void settings.setFabEnabled(false).then(removeAllSites);
    fabGranted.value = false;
    return;
  }
  // 权限申请必须在勾选事件中同步发起，前面不能有 await
  void requestAllSites().then(async (granted) => {
    fabGranted.value = granted;
    if (granted) await settings.setFabEnabled(true);
    else input.checked = false;
  });
}

// ============ 面板 ============

const panelEl = ref<HTMLElement | null>(null);
const panel = useDraggablePanel({
  elRef: panelEl,
  fallbackSize: { w: 720, h: 520 },
  savePos: (p) => void settings.patch({ settingsPanelPos: p }),
});
const panelStyle = computed(() => panel.positionStyle.value);
const onDragStart = (e: PointerEvent) => panel.onDragStart(e);

watch(
  () => props.open,
  async (v) => {
    if (!v) return;
    changed = false;
    await nextTick();
    panel.restoreFromStore(s.value.settingsPanelPos, undefined);
  },
  { immediate: true }
);

async function close() {
  await settings.flush();
  if (changed) confirmSaved('设置已保存');
  changed = false;
  emit('close');
}

// ============ 背景 ============

const bgMode = ref<'upload' | 'url'>('upload');
const bgUrl = ref('');
const bgFileName = ref('');
const bgInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);

async function applyBackground(dataUrl: string) {
  try {
    await settings.setBackground(dataUrl);
    if (!dataUrl) bgFileName.value = '';
    toast(dataUrl ? '已应用背景' : '已清除背景', { type: 'success' });
  } catch (err) {
    notifyError(err);
  }
}

async function withBusy(task: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
  } finally {
    busy.value = false;
  }
}

function pickBg(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  bgFileName.value = file.name;
  void withBusy(async () => {
    if (file.size > BACKGROUND_SOURCE_MAX_BYTES) {
      toast('图片过大，请选择 30MB 以内的图片', { type: 'warning' });
      return;
    }
    try {
      await applyBackground(await prepareBackground(file));
    } catch (err) {
      toast((err as Error).message || '处理图片失败', { type: 'error' });
    }
  });
}

function applyBgUrl() {
  const url = bgUrl.value.trim();
  if (!url) return;
  void withBusy(async () => {
    try {
      let blob: Blob;
      if (/^data:image\//i.test(url)) {
        blob = await (await fetch(url)).blob();
      } else if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
        blob = await res.blob();
      } else {
        toast('请输入 data:image/... 或 http(s) 图片地址', { type: 'warning' });
        return;
      }
      if (blob.size > BACKGROUND_SOURCE_MAX_BYTES) throw new Error('图片过大（>30MB）');
      await applyBackground(await prepareBackground(blob));
    } catch (err) {
      toast((err as Error).message || '下载图片失败', { type: 'error' });
    }
  });
}

// ============ 导出 / 导入 ============

const importInput = ref<HTMLInputElement | null>(null);
const importFileName = ref('');
const importText = ref('');
const importPreview = ref<BackupPreview | null>(null);
const importChecks = reactive<Record<BackupCategory, boolean>>({
  settings: true, engines: true, bookmarks: true, notebooks: true, sharedItems: true,
});
const IMPORT_ROWS: Array<{ key: BackupCategory; label: string; count: (p: BackupPreview) => string }> = [
  { key: 'settings', label: '设置', count: (p) => (p.hasSettings ? '含' : '无') },
  { key: 'engines', label: '搜索引擎', count: (p) => (p.hasEngines ? '含' : '无') },
  { key: 'bookmarks', label: '分组+书签', count: (p) => `${p.groups} 组 / ${p.bookmarks} 条` },
  { key: 'notebooks', label: '笔记本', count: (p) => `${p.notebooks} 条` },
  { key: 'sharedItems', label: '收纳箱', count: (p) => `${p.sharedItems} 条` },
];

function allChecked(o: Record<string, boolean>) {
  return Object.values(o).every(Boolean);
}
function setAll(o: Record<string, boolean>, v: boolean) {
  for (const k of Object.keys(o)) o[k] = v;
}

function doExport() {
  void withBusy(async () => {
    try {
      const blob = await exportBackup();
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `local-gce-backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
      notifyError(err, '导出失败');
    }
  });
}

async function pickImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importFileName.value = file.name;
  try {
    const text = await file.text();
    const p = await parseBackup(text);
    importText.value = text;
    importPreview.value = p;
    Object.assign(importChecks, {
      settings: p.hasSettings,
      engines: p.hasEngines,
      bookmarks: p.bookmarks > 0 || p.groups > 0,
      notebooks: p.notebooks > 0,
      sharedItems: p.sharedItems > 0,
    });
  } catch (err) {
    toast((err as Error).message || '导入失败：文件不受支持或格式错误', { type: 'error' });
  }
}

function cancelImport() {
  importPreview.value = null;
  importText.value = '';
  importFileName.value = '';
}

function confirmImport() {
  const cats = (Object.keys(importChecks) as BackupCategory[]).filter((k) => importChecks[k]);
  if (!cats.length) {
    toast('请至少选择一项数据');
    return;
  }
  void withBusy(async () => {
    try {
      applyAll(await importBackup(importText.value, { categories: cats }));
      cancelImport();
      confirmSaved('导入完成', 0);
      emit('close');
    } catch (err) {
      notifyError(err, '导入失败');
    }
  });
}

// ============ 清空数据 ============

type ClearKey = keyof ClearOptions;
const showClear = ref(false);
const siteCacheExists = ref(false);
const clearChecks = reactive<Record<ClearKey, boolean>>({
  settings: false, engines: false, bookmarks: false, groups: false,
  notebooks: false, sharedItems: false, background: false, siteCache: false,
});
const CLEAR_ROWS: Array<{ key: ClearKey; label: string; count: () => string }> = [
  { key: 'settings', label: '设置（恢复默认）', count: () => '' },
  { key: 'engines', label: '搜索引擎（恢复内置）', count: () => `${engines.list.length} 个` },
  { key: 'bookmarks', label: '书签', count: () => `${bm.bookmarks.length} 条` },
  { key: 'groups', label: '分组（书签移入「未分组」）', count: () => `${bm.groups.length} 组` },
  { key: 'notebooks', label: '笔记本', count: () => `${notebook.entries.length} 条` },
  { key: 'sharedItems', label: '收纳箱', count: () => `${shared.count} 条` },
  { key: 'background', label: '自定义背景', count: () => (settings.background ? '已设置' : '未设置') },
  { key: 'siteCache', label: '站点缓存', count: () => (siteCacheExists.value ? '有缓存' : '无缓存') },
];

async function openClearModal() {
  setAll(clearChecks, false);
  siteCacheExists.value = await hasSiteCache();
  showClear.value = true;
}

async function confirmClear() {
  const opts = Object.fromEntries(Object.entries(clearChecks).filter(([, v]) => v)) as ClearOptions;
  if (!Object.keys(opts).length) {
    toast('请至少选择一项数据');
    return;
  }
  const ok = await confirm({ title: '清空数据', message: '所选数据将被清除且无法恢复，建议先导出备份。确定继续吗？', confirmText: '清空', variant: 'danger' });
  if (!ok) return;
  await withBusy(async () => {
    try {
      applyAll(await clearData(opts));
      showClear.value = false;
      confirmSaved('已清空选中的数据', 0);
    } catch (err) {
      notifyError(err, '清空数据失败');
    }
  });
}

async function clearCache() {
  try {
    await clearSiteCache();
    toast('已清空站点缓存', { type: 'success' });
  } catch (err) {
    notifyError(err);
  }
}
</script>
<style scoped>
  /* ===== 遮罩层 ===== */
  .mask{ position:fixed; inset:0; background:var(--scrim); z-index:var(--z-drawer) }

  /* 面板外壳 / 标题栏 / 关闭按钮已由 UI Kit（.gce-panel*）提供，此处不再重复定义 */

  /* ===== 两栏布局 ===== */
  .panel{ display:flex; min-height: 360px; }

  /* ===== 侧栏导航 ===== */
  .side{
    width: 172px;
    border-right: 1px solid rgb(var(--ink) / .08);
    background: transparent;
    padding: 10px 8px; display:flex; flex-direction:column; gap: 6px;
  }
  .side .item{
    text-align:center; height:36px; padding:0 12px; border-radius:10px; border:0;
    background: transparent; color: rgb(var(--ink) / .72);
    cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition: background .12s; font-size: 13px;
  }
  .side .item:hover{ background: rgb(var(--ink) / .07); }
  .side .item.on{ background: rgb(var(--ink) / .13); color: var(--text); }

  /* ===== 内容区 ===== */
  .content{
    flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:14px;
    background: transparent;
  }

  /* ===== 分区 ===== */
  .sec{ border:none; border-radius:14px; padding:12px; background: transparent; }
  .sec h4{
    font-size: 13px; font-weight: 700; margin: 0 0 10px 0;
    padding-bottom: 8px; border-bottom: 1px solid rgb(var(--ink) / .06);
    opacity: .9;
  }

  /* ===== 表单行 ===== */
  .row{ display:flex; align-items:center; gap:10px; margin:8px 0; flex-wrap:wrap; }
  .row.col{ align-items:flex-start; }
  .row.tight{ gap:8px; }
  .row.tight label{ width:72px; }
  .row label{ width:88px; color:var(--muted); padding-top:2px; font-size:13px; }
  .row input[type='range']{ flex:1; accent-color: var(--primary); }
  .row input[type='text']{
    flex:1; height:34px; border:1px solid var(--border); border-radius:10px;
    background:var(--card); color:var(--text); padding:0 10px;
  }
  .row input[type='text']:focus{
    outline:none; border-color: var(--primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 15%, transparent);
  }
  .row input[type='checkbox']{ width:18px; height:18px; }
  .row .url{ min-width:0; }
  .row .actions{ display:flex; gap:10px; flex-wrap:nowrap; }

  /* ===== 按钮 ===== */
  /* 危险操作按钮：原先用内联 style="background:#e74c3c" 硬编码，
     绕过了令牌与主题系统（且与全站其它危险色 #ef4444 不一致）。 */
  a.btn, a.btn:visited{ text-decoration:none; }
  a.btn:hover, a.btn:active, a.btn:focus{ text-decoration:none; }

  .tip{ opacity:.7; font-size:12px; }
  .filename{ flex:1; min-width:0; color: var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .bg-tip{ font-size:13px; color:var(--muted); }

  /* ===== 分段选择器 ===== */
  .seg{ display:inline-flex; background:var(--card); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .seg-item{
    height:30px; padding:0 12px; background:transparent; color:var(--text);
    border:0; border-right:1px solid var(--border); cursor:pointer;
    font-size:13px; transition: background .12s;
  }
  .seg-item:last-child{ border-right:0; }
  .seg-item:hover{ background: rgb(var(--ink) / .06); }
  .seg-item.on{ background: var(--primary); color:var(--on-accent); }
  .city-list{ display:flex; flex-wrap:wrap; gap:6px; flex:1; min-width:0; }
  .city-item{ height:30px; padding:0 12px; border-radius:var(--r-pill); border:1px solid var(--border); background:var(--card); color:var(--text); font-size:12px; cursor:pointer; }
  .city-item:hover{ border-color: var(--primary); }

  /* ===== 导入预览弹窗 ===== */
  .imp-mask{ position:fixed; inset:0; background:var(--scrim-strong); z-index:var(--z-drawer-dialog-mask) }
  .imp-panel{
    position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    width:min(420px, calc(100vw - 36px));
    background: var(--glass); backdrop-filter: blur(10px);
    border: 1px solid var(--border); border-radius: 14px;
    box-shadow: var(--shadow-lg);
    z-index:var(--z-drawer-dialog); display:flex; flex-direction:column; overflow:hidden;
    color: var(--text);
  }
  .imp-hdr{
    display:flex; align-items:center; justify-content:space-between;
    height:44px; padding:0 14px; border-bottom:1px solid rgb(var(--ink) / .08);
  }
  .imp-ttl{ font-size:14px; font-weight:700; letter-spacing:.5px; }
  .imp-body{ padding:14px; display:flex; flex-direction:column; gap:6px; }
  .imp-row{
    display:flex; align-items:center; gap:10px; padding:8px 10px;
    border-radius:8px; cursor:pointer; transition:background .12s;
  }
  .imp-row:hover{ background:rgb(var(--ink) / .06); }
  .imp-all{ font-weight:600; }
    .imp-label{ flex:1; font-size:13px; }
  .imp-count{ font-size:12px; opacity:.5; }
  .imp-sep{ height:1px; background:rgb(var(--ink) / .06); margin:4px 0; }

  .imp-file{ font-size:11px; opacity:.35; padding:2px 10px; }
  .imp-ftr{
    display:flex; align-items:center; justify-content:flex-end; gap:8px;
    padding:10px 14px; border-top:1px solid rgb(var(--ink) / .08);
  }

  /* ===== 移动端响应式 ===== */
  @media (max-width: 768px) {
    .panel{ flex-direction:column; }
    .side{
      width:100%; flex-direction:row; overflow-x:auto; -webkit-overflow-scrolling:touch;
      scrollbar-width:none; border-right:none; border-bottom:1px solid rgb(var(--ink) / .08);
      padding:6px; gap:4px;
    }
    .side::-webkit-scrollbar{ display:none; }
    .side .item{ white-space:nowrap; flex-shrink:0; height:32px; padding:0 14px; font-size:13px; }
    .content{ padding:10px; }
    .row{ flex-wrap:wrap; }
    .row label{ width:auto; min-width:72px; }
  }
  /* 触摸设备：扩大触摸目标 */
  @media (hover: none) and (pointer: coarse) {
    .side .item{ height: 44px; font-size: 14px; }
    .seg-item{ height: 44px; padding: 0 16px; font-size: 14px; }
    .row input[type='text']{ height: 44px; font-size: 16px; }
  }

  /* 窄屏：设置面板近乎全屏（表单控件多，420px 会挤成一团）。
     这是与其它面板的刻意差异，不是遗漏。 */
  @media (max-width: 768px) {
    .drawer { width: 96vw !important; max-width: none; left: 2vw !important; top: 5vh !important; transform: none !important; max-height: 90vh; }
  }
</style>
